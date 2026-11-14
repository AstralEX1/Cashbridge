import { Chain, getThorFactoryAssetDenom, getThorFactoryAssetTicker } from '@tcswap/helpers'
import { QuoteResponseRoute } from '@tcswap/helpers/api'
import type { Asset } from '@/components/swap/asset'
import type { LimitSwapQueueItem, TxStatusResponse } from '@/lib/api'
import { DEFAULT_LIMIT_SWAP_MAX_AGE } from '@/lib/limit-swap'

export interface LimitSwapOrder {
  sourceAsset: string
  sourceAmount: string
  targetAsset: string
  targetAmount: string
  // Blocks left before THORChain settles the order as expired.
  blocksToExpiry?: number
}

export function createModifyLimitSwapMemoFromOrder(order: LimitSwapOrder, newAmount: string): string {
  return `m=<:${order.sourceAmount}${order.sourceAsset}:${order.targetAmount}${order.targetAsset}:${newAmount}`
}

// Factory tokens are known by two names — the bank denom ("THOR.x/ruji") and the ticker
// identifier ("THOR.RUJI"). THORNode stores the ticker form, so canonicalise before comparing.
const canonicalAsset = (asset: string) => {
  const denom = getThorFactoryAssetDenom(asset)
  const ticker = denom && getThorFactoryAssetTicker(denom)
  return (ticker ? `${Chain.THORChain}.${ticker}` : asset).toUpperCase()
}

export const sameAsset = (a?: string, b?: string) => !!a && !!b && canonicalAsset(a) === canonicalAsset(b)

// THORNode may print a cash address without its prefix and an EVM address in any case.
const canonicalAddress = (address: string) => {
  const trimmed = address.trim().toLowerCase()
  return trimmed.includes(':') ? trimmed.slice(trimmed.indexOf(':') + 1) : trimmed
}

const sameAddress = (a?: string, b?: string) => !!a && !!b && canonicalAddress(a) === canonicalAddress(b)

export interface OrderRefundTarget {
  // The order's source asset: the refund comes back in what was deposited.
  asset: string
  chain: string
  // The address that placed the order, which is where THORChain refunds it.
  recipient: string
}

// A cancelled order that had partly filled settles with both a swap payout and a refund, in any
// order. Only an outbound of the deposited asset, on its own chain, to the order's sender is the
// refund; anything else taken for it would place the replacement for the wrong amount.
export function findOrderRefund(status: TxStatusResponse | undefined, target: OrderRefundTarget): string | undefined {
  for (const out of status?.out_txs ?? []) {
    if (out.chain?.toUpperCase() !== target.chain.toUpperCase()) continue
    if (!sameAddress(out.to_address, target.recipient)) continue
    // Refunds carry `REFUND:<inbound>`; a payout (`OUT:<inbound>`) is never one, whatever its coin.
    if (out.memo && !out.memo.toUpperCase().startsWith('REFUND:')) continue
    const coin = out.coins?.find(c => sameAsset(c.asset, target.asset))
    if (coin && BigInt(coin.amount) > 0n) return coin.amount
  }
  return undefined
}

// THORNode reports the blocks an order has left directly. Older nodes measured it against the global
// max age instead of the order's own interval, so fall back to deriving it the way the node does -
// the order's interval, capped by the max age, less the blocks it has been queued for.
function blocksToExpiry(item: LimitSwapQueueItem, maxAgeBlocks: number): number | undefined {
  const reported = Number(item.time_to_expiry_blocks ?? NaN)
  if (Number.isFinite(reported)) return Math.max(0, reported)

  const interval = Number(item.swap?.state?.interval ?? 0)
  const sinceCreated = Number(item.blocks_since_created ?? NaN)
  if (!Number.isFinite(sinceCreated)) return undefined

  const lifetime = interval > 0 && interval <= maxAgeBlocks ? interval : maxAgeBlocks
  return Math.max(0, lifetime - sinceCreated)
}

// THORNode prints inbound hashes upper-case and without the EVM `0x`.
const canonicalTxId = (id: string) => id.trim().replace(/^0x/i, '').toUpperCase()

// THORNode indexes an open limit swap by its exact source coin and trade target, so a modify
// memo built from the rounded amounts we display will not match anything and the cancellation
// is silently dropped. Read the open order back from the swap queue instead - by the inbound
// hash that placed it. Two orders on the same pair can share a target, and cancelling the wrong
// one is worse than not cancelling at all, so an order that is not found is not replaced by another.
export function findLimitSwapOrder(
  items: LimitSwapQueueItem[],
  orderTxId: string | undefined,
  sourceAsset: Asset,
  targetAsset: Asset,
  maxAgeBlocks: number = DEFAULT_LIMIT_SWAP_MAX_AGE
): LimitSwapOrder | undefined {
  if (!orderTxId?.trim()) return undefined
  const txId = canonicalTxId(orderTxId)

  const item = items.find(i => !!i.swap?.tx?.id && canonicalTxId(i.swap.tx.id) === txId)
  const coin = item?.swap.tx.coins?.[0]
  if (!item || !coin || !item.swap.target_asset || !item.swap.trade_target) return undefined
  // The hash is the order; the pair is a sanity check that it is the order this dialog shows.
  if (!sameAsset(coin.asset, sourceAsset.identifier) || !sameAsset(item.swap.target_asset, targetAsset.identifier)) return undefined

  return {
    sourceAsset: coin.asset,
    sourceAmount: coin.amount,
    targetAsset: item.swap.target_asset,
    targetAmount: item.swap.trade_target,
    blocksToExpiry: blocksToExpiry(item, maxAgeBlocks)
  }
}

export function modifyMemoForLimitSwap(memo: string, priceAtomic: string, expiryBlocks?: number): string {
  if (!memo.startsWith('=:')) return memo

  const parts = memo.split(':')
  // parts:
  // [0] "="
  // [1] ASSET (eg ETH.USDT)
  // [2] destination address
  // [3] limit/interval/qty (optional)

  if (parts.length < 3) throw new Error('Invalid memo')

  const asset = parts[1]
  const affiliate = parts[2]

  const interval = expiryBlocks || 1
  const qty = 0

  return `=<:${asset}:${affiliate}:${priceAtomic}/${interval}/${qty}`
}

export function prepareQuoteForLimitSwap(quote: QuoteResponseRoute, limitBuyAmount?: string, expiryBlocks?: number): QuoteResponseRoute {
  if (!quote.memo || !limitBuyAmount) return quote

  return {
    ...quote,
    memo: modifyMemoForLimitSwap(quote.memo, limitBuyAmount, expiryBlocks)
  }
}
