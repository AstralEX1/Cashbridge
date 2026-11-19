import { encodeTransaction, hexToBin, binToHex, type Transaction } from '@bitauth/libauth'
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize'
import { ProviderName } from '@tcswap/helpers'
import { BridgeConfig } from '@/config'
import { getInboundAddresses, getQuotes, isBridgeRoute } from '@/lib/api'
import { createAutomaticOrder } from '@/lib/auto-bridge-client'
import type { OrderIntent } from '@/lib/auto-bridge-contract'
import { addressToLockingBytecode, listWalletCoins, normalizeTxid, type BchBinding, type ScriptUtxo } from '@/lib/bch'
import type { Signable } from '@/lib/bch-signing'
import { formatBaseUnits, minOutputFor } from '@/lib/bridge'
import { quoteToken } from '@/lib/cauldron'
import type { CauldronToken } from '@/lib/cauldron-tokens'
import { checkDepositMemo, checkInbound, DEPOSIT_FEE_RESERVE, DepositError, type InboundAddress } from '@/lib/thorchain-deposit'
import { blockHeight, destinationChainOf } from '@/lib/reverse-bridge'
import type { SavedAutoOrder } from '@/store/auto-bridge-store'
import { REFUND_AFTER_SECONDS } from '@/lib/router-contract'

// A transfer back from BCH through the Cashbridge Router: the BCH wallet signs one transaction that sends the tokens to
// the order's sale contract (src/lib/router-contract.ts), which lets the Router only sell them and deposit the BCH to
// THORChain with this order's memo, or send them back.

// BCH the token coin carries, so the contract can return it as it came and still pay that transaction's fee.
export const SALE_COIN_SATS = 2_000n
const TOKEN_CHANGE_SATS = 1_000n
const CHANGE_DUST = 546n
const P2PKH_UNLOCK_BYTES = 100
// The Router's floor may sit at most this far under the page's own sale quote.
const FLOOR_TOLERANCE_BPS = 300

// Largest first, until `need` is covered.
const pick = <T,>(coins: T[], amountOf: (c: T) => bigint, need: bigint) => {
  const chosen: T[] = []
  let total = 0n
  for (const coin of [...coins].sort((a, b) => (amountOf(b) > amountOf(a) ? 1 : amountOf(b) < amountOf(a) ? -1 : 0))) {
    if (total >= need) break
    chosen.push(coin)
    total += amountOf(coin)
  }
  return total >= need ? chosen : undefined
}

// `amount` of the token from the bound address to `to` in one output, the token and BCH change back to the address.
export const buildTokenSend = (utxos: ScriptUtxo[], binding: BchBinding, token: Pick<CauldronToken, 'category' | 'ticker'>, amount: bigint, to: string): Signable & { feeSats: bigint } => {
  const own = hexToBin(binding.lockingBytecode)
  const tokenCoins = pick(utxos.filter(u => u.token?.category === token.category && !u.token.nft), u => u.token!.amount, amount)
  if (!tokenCoins) throw new DepositError(`The BCH wallet holds less ${token.ticker} than this amount at the connected address`)
  const tokenChange = tokenCoins.reduce((sum, u) => sum + u.token!.amount, 0n) - amount
  const plain = utxos.filter(u => !u.hasToken).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
  const category = hexToBin(token.category)
  const outputs: Transaction['outputs'] = [
    { lockingBytecode: hexToBin(to), valueSatoshis: SALE_COIN_SATS, token: { category, amount } },
    ...(tokenChange > 0n ? [{ lockingBytecode: own, valueSatoshis: TOKEN_CHANGE_SATS, token: { category, amount: tokenChange } }] : [])
  ]
  const paid = outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
  const coins = [...tokenCoins]
  for (let next = 0; ; next++) {
    const inputs = coins.map(u => ({ outpointTransactionHash: hexToBin(normalizeTxid(u.txid)), outpointIndex: u.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }))
    const have = coins.reduce((sum, u) => sum + u.value, 0n)
    const assemble = (change: bigint): Transaction => ({ version: 2, locktime: 0, inputs, outputs: change > 0n ? [...outputs, { lockingBytecode: own, valueSatoshis: change }] : outputs })
    const feeOf = (tx: Transaction) => BigInt(encodeTransaction(tx).length + P2PKH_UNLOCK_BYTES * inputs.length)
    const change = have - paid - feeOf(assemble(1n))
    const tx = change >= CHANGE_DUST ? assemble(change) : have - paid >= feeOf(assemble(0n)) ? assemble(0n) : undefined
    if (tx) {
      return {
        unsignedHex: binToHex(encodeTransaction(tx)),
        sourceOutputs: tx.inputs.map((input, i) =>
          sourceOutputToRelay({
            ...input,
            lockingBytecode: own,
            valueSatoshis: coins[i].value,
            ...(coins[i].token && { token: { category: hexToBin(coins[i].token!.category), amount: coins[i].token!.amount } })
          })
        ),
        ownIndexes: tx.inputs.map((_, i) => i),
        feeSats: have - tx.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
      }
    }
    if (next >= plain.length) throw new DepositError('The BCH wallet needs a little plain BCH for the network fee')
    coins.push(plain[next])
  }
}

export interface PreparedRouterSale {
  reference: SavedAutoOrder
  send: Signable & { feeSats: bigint }
  // The tokens sent, as the pools can take them.
  sellTokens: bigint
  // The quoted BCH from the sale, the Router's floor for it, and what THORChain is quoted to pay.
  bchOut: bigint
  minSats: bigint
  expectedOut: string
  // The destination chain's THORChain router and the block to look for the payout from.
  payoutRouter?: string
  startBlock?: number
}

// Quotes the sale and the THORChain deposit, opens the Router order and checks its contract, then builds the send.
export const prepareRouterSale = async ({
  token,
  units,
  binding,
  buyAsset,
  shortCode,
  destination,
  slippage
}: {
  token: CauldronToken
  units: bigint
  binding: BchBinding
  buyAsset: string
  shortCode?: string
  destination: string
  slippage: number
}): Promise<PreparedRouterSale> => {
  const sale = await quoteToken({ category: token.category, side: 'sell', amount: units })
  const inbounds = (await getInboundAddresses()) as unknown as InboundAddress[]
  const chain = destinationChainOf(buyAsset)
  const routes = await getQuotes({
    sellAsset: BridgeConfig.buyAsset,
    buyAsset,
    sellAmount: formatBaseUnits(sale.output - DEPOSIT_FEE_RESERVE, 8),
    slippage,
    providers: [ProviderName.THORCHAIN],
    sourceAddress: binding.cashAddress,
    destinationAddress: destination,
    refundAddress: binding.cashAddress
  })
  const route = routes.find(r => r.providers[0] === ProviderName.THORCHAIN_STREAMING) ?? routes.find(r => r.providers[0] === ProviderName.THORCHAIN)
  if (!route?.memo || !route.inboundAddress) throw new DepositError('THORChain has no route for this amount right now')
  if (!isBridgeRoute(route, { sellAsset: BridgeConfig.buyAsset, buyAsset, destinationAddress: destination })) throw new DepositError('The quote is not for this bridge')
  checkDepositMemo(route.memo, { buyAsset, destination, shortCode })
  const { router } = checkInbound(inbounds, route.inboundAddress, chain)

  const intent: OrderIntent = {
    recipientAddress: binding.tokenAddress,
    refundAddress: binding.tokenAddress,
    expectedBchSats: sale.output.toString(),
    sale: { category: token.category, tokenAmount: sale.sell.toString(), buyAsset, destination, memo: route.memo, vaultAddress: route.inboundAddress }
  }
  const reference: SavedAutoOrder = { id: crypto.randomUUID(), capability: (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', ''), createdAt: Date.now(), intent, token }
  // The order request checks the echoed terms and that the deposit is the sale contract of exactly these terms.
  const order = await createAutomaticOrder(reference)
  // The contract's own return path must open on time, so the tokens are never held longer than the Router promises.
  if (!order.contract || order.contract.refundAfter > Date.now() / 1000 + REFUND_AFTER_SECONDS + 600) throw new DepositError('The Cashbridge Router order returns the tokens later than it should')
  const minSats = BigInt(order.minPusd)
  if (minSats < minOutputFor(sale.output, FLOOR_TOLERANCE_BPS)) throw new DepositError('The Cashbridge Router offered a lower minimum than this quote')
  const to = addressToLockingBytecode(order.depositAddress)
  if (!to) throw new DepositError('The Cashbridge Router order has no deposit address')
  const { utxos } = await listWalletCoins(binding.lockingBytecode)
  return {
    reference: { ...reference, order },
    send: buildTokenSend(utxos, binding, token, sale.sell, to),
    sellTokens: sale.sell,
    bchOut: sale.output,
    minSats,
    expectedOut: route.expectedBuyAmount,
    payoutRouter: router,
    startBlock: await blockHeight(chain).catch(() => undefined)
  }
}
