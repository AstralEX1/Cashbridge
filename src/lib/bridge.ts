import { BridgeConfig } from '@/config'
import type { MidgardAction, TxStatusResponse } from '@/lib/api'
import { addressPaysScript, normalizeTxid } from '@/lib/bch'
import type { BridgeRefund, FirstLegResult } from '@/store/transaction-store'

// Pure decisions of the bridge, kept apart from React so they can be tested on fixtures.

// Decimal string (as the aggregator returns amounts) to integer base units. Throws rather than
// rounds: an amount with more precision than the asset has is not a valid amount.
export const toBaseUnits = (amount: string, decimals: number): bigint => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) throw new Error(`Not a decimal amount: ${amount}`)
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  if (fraction.length > decimals) throw new Error(`More than ${decimals} decimals: ${amount}`)
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

export const formatBaseUnits = (value: bigint | string, decimals: number) => {
  const v = BigInt(value)
  const negative = v < 0n
  const abs = negative ? -v : v
  const unit = 10n ** BigInt(decimals)
  const fraction = (abs % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${abs / unit}${fraction ? `.${fraction}` : ''}`
}

// BCH kept back from the second leg's sale to pay its miner fee, the router fee output and the
// dust the PUSD and change outputs carry. A failed build is retried with a larger reserve.
export const SECOND_LEG_BASE_RESERVE = 5_000n
export const secondLegReserve = (totalSats: bigint, attempt = 0) => (SECOND_LEG_BASE_RESERVE + (totalSats * 20n) / 10_000n) * 2n ** BigInt(attempt)
export const secondLegSellAmount = (totalSats: bigint, attempt = 0) => {
  const sell = totalSats - secondLegReserve(totalSats, attempt)
  return sell > 0n ? sell : 0n
}

export const minOutputFor = (quoted: bigint, slippageBps = BridgeConfig.pusdSlippageBps) => (quoted * BigInt(10_000 - slippageBps)) / 10_000n

// --- THORChain first leg -----------------------------------------------------------------------

export type FirstLegView =
  | { kind: 'pending'; result: FirstLegResult; refunds: BridgeRefund[]; detail?: string }
  | { kind: 'outbound'; result: FirstLegResult; refunds: BridgeRefund[]; outbound: { txid: string; amountSats: string }[] }
  | { kind: 'refunded'; refunds: BridgeRefund[] }
  | { kind: 'invalid'; reason: string }

const isBchCoin = (coin?: { asset: string }) => coin?.asset?.toUpperCase() === BridgeConfig.buyAsset

// Reads THORNode's /thorchain/tx/status for the source transaction. BCH counts as received only
// through an executed outbound (out_txs) with an OUT memo paying the bound script; a planned
// outbound is only "pending". Refunds are told apart from swap outbounds by their REFUND memo.
export const interpretTxStatus = (status: TxStatusResponse, lockingBytecode: string): FirstLegView => {
  const outs = status.out_txs ?? []
  const planned = status.planned_out_txs ?? []
  const stages = status.stages ?? {}

  const refunds: BridgeRefund[] = outs
    .filter(o => o.memo?.toUpperCase().startsWith('REFUND:'))
    .map(o => ({ asset: o.coins?.[0]?.asset ?? '', amount: o.coins?.[0]?.amount ?? '0', txid: o.id, pending: false }))
  const executedRefunds = refunds.length
  planned
    .filter(p => p.refund)
    .slice(executedRefunds)
    .forEach(p => refunds.push({ asset: p.coin.asset, amount: p.coin.amount, pending: true }))

  const swapOuts = outs.filter(o => o.memo?.toUpperCase().startsWith('OUT:'))
  for (const out of swapOuts) {
    if (out.chain !== 'BCH' || !out.coins?.every(isBchCoin)) return { kind: 'invalid', reason: 'THORChain paid out an asset other than BCH' }
    if (!addressPaysScript(out.to_address, lockingBytecode)) return { kind: 'invalid', reason: 'THORChain paid a different BCH address' }
  }
  for (const p of planned.filter(p => !p.refund)) {
    if (p.chain !== 'BCH' || !isBchCoin(p.coin)) return { kind: 'invalid', reason: 'THORChain plans to pay out an asset other than BCH' }
    if (!addressPaysScript(p.to_address, lockingBytecode)) return { kind: 'invalid', reason: 'THORChain plans to pay a different BCH address' }
  }

  const swapping = stages.swap_status?.pending === true || (stages.swap_status === undefined && stages.swap_finalised?.completed === false)
  const pendingRefund = refunds.some(r => r.pending)
  const plannedSwapOuts = planned.filter(p => !p.refund).length
  const outboundsDone = !swapping && swapOuts.length >= plannedSwapOuts

  if (swapOuts.length > 0 && outboundsDone) {
    return {
      kind: 'outbound',
      result: refunds.length ? (pendingRefund ? 'refund_pending' : 'partial') : 'swapped',
      refunds,
      outbound: swapOuts.map(o => ({ txid: normalizeTxid(o.id), amountSats: o.coins.reduce((sum, c) => sum + BigInt(c.amount), 0n).toString() }))
    }
  }

  if (!swapping && plannedSwapOuts === 0 && refunds.length > 0) {
    return pendingRefund ? { kind: 'pending', result: 'refund_pending', refunds } : { kind: 'refunded', refunds }
  }

  return {
    kind: 'pending',
    result: refunds.length ? 'refund_pending' : 'pending',
    refunds,
    detail: stages.outbound_delay && !stages.outbound_delay.completed ? `Outbound delayed ~${stages.outbound_delay.remaining_delay_seconds ?? '?'}s` : undefined
  }
}

// Midgard fallback: only refunds are concluded from it. BCH receipt always goes through THORNode's
// executed outbound and the on-chain check, never Midgard alone.
export const interpretMidgard = (actions: MidgardAction[]): FirstLegView | undefined => {
  const refund = actions.find(a => a.type === 'refund')
  if (!refund) return undefined
  const refunds = refund.out.map(o => ({ asset: o.coins[0]?.asset ?? '', amount: o.coins[0]?.amount ?? '0', txid: o.txID || undefined, pending: refund.status !== 'success' }))
  return refund.status === 'success' ? { kind: 'refunded', refunds } : { kind: 'pending', result: 'refund_pending', refunds }
}

// The source transaction a user typed in after a lost wallet response must be this operation's:
// a THORChain swap to BCH.BCH paying the bound address (memo `=:BCH.BCH:<address>:...` or a short form).
export const inboundMatchesBinding = (status: TxStatusResponse, lockingBytecode: string) => {
  const memo = status.tx?.memo ?? ''
  const [action, asset, ...rest] = memo.split(':')
  if (!['=', 's', 'swap'].includes((action ?? '').toLowerCase())) return false
  if (!['BCH.BCH', 'BCH', 'C'].includes((asset ?? '').toUpperCase())) return false
  // The memo's field separator is also the cashaddr prefix separator, so rejoin a prefixed address.
  const destination = rest[0]?.toLowerCase() === 'bitcoincash' ? `${rest[0]}:${rest[1] ?? ''}` : rest[0]
  return addressPaysScript(destination ?? '', lockingBytecode)
}
