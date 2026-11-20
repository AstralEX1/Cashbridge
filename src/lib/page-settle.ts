// The customer's page settles its own forward order, as soon as the bridge's BCH reaches the order's contract
// (mempool included): it buys the token on Cauldron with the one-use key that the version 2 contract accepts next to
// the Router's. The contract lets that key pay only the customer, and the Router settles the same coin when the page
// is closed, so nothing here can strand or misdirect the BCH.
import { binToHex, encodeTransaction, generatePrivateKey, generateSigningSerializationBch, hash256, hexToBin, secp256k1 } from '@bitauth/libauth'
import { decodeTx, listWalletCoins } from '@/lib/bch'
import { broadcastBchTransaction, buildTokenTrade, checkPoolCovenants, checkSigned, reviewBuild, sourcesOf } from '@/lib/cauldron'
import { coinFloor, orderBinding, orderRedeemScript, orderUnlock, parseOrderUnlock } from '@/lib/router-contract'
import { orderTermsOf } from '@/lib/auto-bridge-order'
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

// Buys the order's token with the one coin at its contract and broadcasts the trade; answers its txid, or undefined
// when there is nothing to settle yet. Two coins are left to the Router, which sends them back.
export async function settleFromPage(
  order: PublicOrder,
  secret: string,
  { coinsOf = listWalletCoins, trade = buildTokenTrade, send = broadcastBchTransaction }: { coinsOf?: typeof listWalletCoins; trade?: typeof buildTokenTrade; send?: (hex: string, txid: string) => Promise<string> } = {}
): Promise<string | undefined> {
  if (!pageCanSettle(order, secret)) return
  const terms = orderTermsOf(order)
  const contract = orderBinding(terms, 0)
  if (contract.cashAddress !== order.depositAddress) throw new Error('The order address is not its contract')
  const coins = (await coinsOf(contract.lockingBytecode)).utxos.filter(coin => !coin.hasToken)
  if (coins.length !== 1) return
  const [coin] = coins
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
  const key = hexToBin(secret)
  try {
    for (const inputIndex of reviewed.ownIndexes) {
      const preimage = generateSigningSerializationBch(
        { inputIndex, sourceOutputs, transaction },
        { coveredBytecode: orderRedeemScript(terms), signingSerializationType: Uint8Array.of(0x61) }
      )
      const signature = secp256k1.signMessageHashSchnorr(key, hash256(preimage))
      if (typeof signature === 'string') throw new Error('BCH signing failed')
      transaction.inputs[inputIndex].unlockingBytecode = orderUnlock(terms, 'convert', Uint8Array.from([...signature, 0x61]), pageKey)
    }
  } finally {
    key.fill(0)
  }
  const hex = binToHex(encodeTransaction(transaction))
  // The same review the Router runs: only our inputs signed, by the page key, and the whole transaction verifies.
  const txid = checkSigned(reviewed.unsignedHex, hex, reviewed.ownIndexes, sourceOutputs, pageKey, parseOrderUnlock(terms))
  return send(hex, txid)
}
