// The customer's page settles its own forward order, as soon as the bridge's BCH reaches the order's contract
// (mempool included): it buys the token on Cauldron with the one-use key that the version 2 contract accepts next to
// the Router's. The contract checks only the coin's own output (the customer's token payout of at least the coin's share
// of the minimum), so the rest of the trade is what this code builds and checks; the Router settles the same coin when
// the page is closed.
import { binToHex, encodeTransaction, generatePrivateKey, generateSigningSerializationBch, hash256, hexToBin, secp256k1, type Output, type Transaction } from '@bitauth/libauth'
import { decodeTx, listWalletCoins, txidOf } from '@/lib/bch'
import { broadcastBchTransaction, buildTokenTrade, checkPoolCovenants, checkSigned, reviewBuild, sourcesOf } from '@/lib/cauldron'
import { coinFloor, MIN_ORDER_COIN_SATS, orderBinding, orderRedeemScript, orderUnlock, parseOrderUnlock, REFUND_FEE_CAP, saleBinding, saleUnlock, settlingCoin, type OrderTerms } from '@/lib/router-contract'
import { orderTermsOf, saleTermsOf } from '@/lib/auto-bridge-order'
import { isTerminal, type PublicOrder } from '@/lib/auto-bridge-contract'

// A one-use key pair for a new order: the secret stays in this browser with the order, the public key goes to the Router.
export const newPageKey = () => {
  const secret = generatePrivateKey()
  return { secret: binToHex(secret), pubkey: binToHex(secp256k1.derivePublicKeyCompressed(secret) as Uint8Array) }
}

// Whether the page holds the key of this order's contract and the order may still need settling.
export const pageCanSettle = (order: PublicOrder | undefined, secret: string | undefined): order is PublicOrder =>
  !!order &&
  !!secret &&
  !order.sale &&
  order.contract?.version === 2 &&
  !isTerminal(order.state) &&
  !order.payoutTxid &&
  binToHex(secp256k1.derivePublicKeyCompressed(hexToBin(secret)) as Uint8Array) === order.contract.pageKey

// Buys the order's token with the largest coin at its contract and broadcasts the trade; answers its txid, or undefined
// when there is nothing to settle yet. Any other coin goes back once the order is done.
export async function settleFromPage(
  order: PublicOrder,
  secret: string,
  { coinsOf = listWalletCoins, trade = buildTokenTrade, send = broadcastBchTransaction }: { coinsOf?: typeof listWalletCoins; trade?: typeof buildTokenTrade; send?: (hex: string, txid: string) => Promise<string> } = {}
): Promise<string | undefined> {
  if (!pageCanSettle(order, secret)) return
  const terms = orderTermsOf(order)
  const contract = orderBinding(terms, 0)
  if (contract.cashAddress !== order.depositAddress) throw new Error('The order address is not its contract')
  const coin = settlingCoin((await coinsOf(contract.lockingBytecode)).utxos.filter(coin => !coin.hasToken), order.expectedBchSats)
  if (!coin) return
  const pageKey = terms.pageKey!
  const { build, intent } = await trade({
    category: terms.category,
    side: 'buy',
    funding: [{ txid: coin.txid, vout: coin.vout, value: coin.value.toString() }],
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: order.recipientAddress,
    cashAddress: order.refundAddress,
    payout: { tokenScript: terms.recipientScript, changeScript: terms.refundScript },
    sell: coin.value,
    minOutput: coinFloor(terms, coin.value),
    ownUnlockBytes: orderUnlock(terms, 'convert', new Uint8Array(65), pageKey).length + 2
  })
  const reviewed = reviewBuild(build, intent)
  checkPoolCovenants(reviewed)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  signWithPage(terms, secret, transaction, sourceOutputs, reviewed.ownIndexes, 'convert')
  const hex = binToHex(encodeTransaction(transaction))
  // The same review the Router runs: only our inputs signed, by the page key, and the whole transaction verifies.
  const txid = checkSigned(reviewed.unsignedHex, hex, reviewed.ownIndexes, sourceOutputs, pageKey, parseOrderUnlock(terms))
  return send(hex, txid)
}

// Signs `indexes` of the order's contract with the page's key.
function signWithPage(terms: OrderTerms, secret: string, transaction: Transaction, sourceOutputs: Output[], indexes: number[], fn: 'convert' | 'giveBack') {
  const key = hexToBin(secret)
  try {
    for (const inputIndex of indexes) {
      const preimage = generateSigningSerializationBch(
        { inputIndex, sourceOutputs, transaction },
        { coveredBytecode: orderRedeemScript(terms), signingSerializationType: Uint8Array.of(0x61) }
      )
      const signature = secp256k1.signMessageHashSchnorr(key, hash256(preimage))
      if (typeof signature === 'string') throw new Error('BCH signing failed')
      transaction.inputs[inputIndex].unlockingBytecode = orderUnlock(terms, fn, Uint8Array.from([...signature, 0x61]), terms.pageKey)
    }
  } finally {
    key.fill(0)
  }
}

// Whether coins may still sit at the order's contract for the page to send back: whatever is there once the refund time
// has passed (a stopped Router must not strand it), and before that a coin the Router reports left after a forward order
// settled, which the page's own key can return at once. A sale has no page key, so its coins wait for the refund time.
// An order under review waits for the operator.
export const pageMayReturn = (order: PublicOrder | undefined, secret: string | undefined, now = Date.now()): order is PublicOrder => {
  if (!order?.contract || order.state === 'manual_review') return false
  const done = isTerminal(order.state)
  if (done && !(BigInt(order.recoverySats ?? '0') > 0n)) return false
  return now >= order.contract.refundAfter * 1000 || (done && ownsKey(order, secret))
}

// Whether the page's key has nothing left to sign: the order is done and the Router reports no BCH at its contract. BCH
// that turns up later still goes back through the Router or `expire`. Under review the operator may still need the page.
export const pageKeySpent = (order: PublicOrder) =>
  ['completed', 'refunded', 'source_refunded'].includes(order.state) && !(BigInt(order.recoverySats ?? '0') > 0n)

const ownsKey = (order: PublicOrder, secret: string | undefined) =>
  !!secret && !order.sale && order.contract?.version === 2 && binToHex(secp256k1.derivePublicKeyCompressed(hexToBin(secret)) as Uint8Array) === order.contract.pageKey

// Sends the coins at the order's contract back to the customer's BCH address, each coin at its own index as the contract
// requires: the BCH of a forward order, or a sale's tokens as they came (or the BCH of their sale, or of a bridge refund).
// With the page's key when it has it, else through `expire` once the chain's median time passes the refund time (a node
// refuses it before then; the next poll tries again). Answers the txid, or undefined with nothing to send.
export async function returnFromPage(
  order: PublicOrder,
  secret: string | undefined,
  { coinsOf = listWalletCoins, send = broadcastBchTransaction, now = Date.now() }: { coinsOf?: typeof listWalletCoins; send?: (hex: string, txid: string) => Promise<string>; now?: number } = {}
): Promise<string | undefined> {
  if (!pageMayReturn(order, secret, now)) return
  const sale = order.sale ? saleTermsOf(order) : undefined
  const terms = orderTermsOf(order)
  const contract = sale ? saleBinding(sale, 0) : orderBinding(terms, 0)
  if (contract.cashAddress !== order.depositAddress) throw new Error('The order address is not its contract')
  // A sale returns its fungible tokens too; an NFT there is not the customer's, and its commitment is not listed anyway.
  const coins = (await coinsOf(contract.lockingBytecode)).utxos.filter(coin =>
    coin.token ? !!sale && !coin.token.nft : !coin.hasToken && coin.value >= MIN_ORDER_COIN_SATS
  )
  if (!coins.length) return
  const keyed = ownsKey(order, secret)
  const tokenOf = (coin: (typeof coins)[number]) => coin.token && { token: { category: hexToBin(coin.token.category), amount: coin.token.amount } }
  const transaction: Transaction = {
    version: 2,
    locktime: keyed ? 0 : order.contract!.refundAfter,
    inputs: coins.map(coin => ({ outpointTransactionHash: hexToBin(coin.txid), outpointIndex: coin.vout, sequenceNumber: keyed ? 0xffffffff : 0xfffffffe, unlockingBytecode: new Uint8Array() })),
    outputs: coins.map(coin => ({ lockingBytecode: hexToBin(terms.refundScript), valueSatoshis: coin.value, ...tokenOf(coin) }))
  }
  const unlock = keyed ? orderUnlock(terms, 'giveBack', new Uint8Array(65), terms.pageKey) : sale ? saleUnlock(sale, 'expire') : orderUnlock(terms, 'expire')
  // One sat per byte, shared by the coins; the contract lets each leave at most REFUND_FEE_CAP.
  const fee = BigInt(encodeTransaction(transaction).length + coins.length * (unlock.length + 2))
  const share = (fee + BigInt(coins.length) - 1n) / BigInt(coins.length)
  if (share > REFUND_FEE_CAP || transaction.outputs.some(output => output.valueSatoshis - share < (output.token ? TOKEN_DUST : 546n))) return
  transaction.outputs.forEach(output => (output.valueSatoshis -= share))
  const sourceOutputs = coins.map(coin => ({ lockingBytecode: hexToBin(contract.lockingBytecode), valueSatoshis: coin.value, ...tokenOf(coin) }))
  if (keyed) signWithPage(terms, secret!, transaction, sourceOutputs, coins.map((_, index) => index), 'giveBack')
  else transaction.inputs.forEach(input => (input.unlockingBytecode = unlock))
  const hex = binToHex(encodeTransaction(transaction))
  return send(hex, txidOf(hex))
}

// The least BCH a relay node takes on an output that carries a CashToken.
const TOKEN_DUST = 800n
