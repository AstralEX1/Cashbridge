import { encodeTransaction, hexToBin, binToHex, type Transaction } from '@bitauth/libauth'
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize'
import { BridgeConfig } from '@/config'
import { ROUTE_MEMO, type SaleIntent, type SaleRoute } from '@/lib/auto-bridge-contract'
import { normalizeTxid, type BchBinding, type ScriptUtxo } from '@/lib/bch'
import type { Signable } from '@/lib/bch-signing'
import { formatBaseUnits, minOutputFor } from '@/lib/bridge'
import type { CauldronToken } from '@/lib/cauldron-tokens'
import { getNearQuote, nearLegOf, nearSlippageBps } from '@/lib/near-intents'
import { REFUND_FEE_CAP, SALE_FLOOR_TOLERANCE_BPS, shapeShiftSaleSats } from '@/lib/router-contract'
import { getShapeShiftBridgeRoute } from '@/lib/shapeshift'
import { DepositError } from '@/lib/thorchain-deposit'
import type { NearLeg } from '@/store/transaction-store'

// The parts of a Router sale that hold no browser state, shared by the page and the MCP server: the token send into the
// sale contract, and the NEAR Intents or ShapeShift deposit a routed sale pays.

// BCH the token coin carries, so the contract can return it as it came and still pay that transaction's fee.
export const SALE_COIN_SATS = 2_000n
const TOKEN_CHANGE_SATS = 1_000n
const CHANGE_DUST = 546n
const P2PKH_UNLOCK_BYTES = 100

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

export type DepositLeg = { sale: Pick<SaleIntent, 'memo' | 'vaultAddress' | 'route' | 'depositSats' | 'quoteId'>; expectedOut: string; payoutRouter?: string; near?: NearLeg }

// A one-use NEAR Intents deposit address paying `destination` and refunding the customer's BCH address, quoted for
// the least BCH the Router is sure to deposit: the floor under this quote, less the miner fee cap (and for ShapeShift's
// exact amount, the change back too). The Router checks the same quote at 1Click before it takes the order.
export const routedDeposit = async ({ route, bchOut, binding, buyAsset, buyDecimals, destination, slippage }: { route: SaleRoute; bchOut: bigint; binding: BchBinding; buyAsset: string; buyDecimals?: number; destination: string; slippage: number }): Promise<DepositLeg> => {
  const floor = minOutputFor(bchOut, SALE_FLOOR_TOLERANCE_BPS)
  if (route === 'near') {
    const quoted = await getNearQuote({
      sellAsset: BridgeConfig.buyAsset,
      buyAsset,
      sellAmount: formatBaseUnits(floor - REFUND_FEE_CAP, 8),
      recipient: destination,
      refundTo: binding.cashAddress,
      dry: false,
      flexible: true,
      slippageBps: nearSlippageBps(slippage)
    })
    if (!quoted?.near.quote.depositAddress) throw new DepositError('NEAR Intents does not carry this asset')
    return { sale: { memo: ROUTE_MEMO, vaultAddress: quoted.near.quote.depositAddress, route }, expectedOut: quoted.expectedBuyAmount, near: nearLegOf(quoted) }
  }
  if (buyDecimals === undefined) throw new DepositError('The asset’s decimals are unknown')
  const depositSats = shapeShiftSaleSats(bchOut)
  if (depositSats <= 0n) throw new DepositError('The amount is too small for the Cashbridge Router')
  const quoted = await getShapeShiftBridgeRoute({
    sellAsset: BridgeConfig.buyAsset,
    buyAsset,
    sellAmount: formatBaseUnits(depositSats, 8),
    sellDecimals: 8,
    buyDecimals,
    slippage,
    sourceAddress: binding.cashAddress,
    destinationAddress: destination
  })
  const near = quoted?.shapeshift.near
  if (!quoted || !near) throw new DepositError('ShapeShift does not carry this asset')
  if (near.amountIn !== depositSats.toString()) throw new DepositError('ShapeShift quoted another amount')
  return {
    sale: { memo: ROUTE_MEMO, vaultAddress: near.depositAddress, route, depositSats: near.amountIn, ...(quoted.shapeshift.quoteId && { quoteId: quoted.shapeshift.quoteId }) },
    expectedOut: quoted.expectedBuyAmount,
    near
  }
}
