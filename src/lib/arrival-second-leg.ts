import { checkUnspent } from '@/lib/bch'
import { clearArrival, loadArrival } from '@/lib/arrival-session'
import { buildArrivalReturn, completeArrivalTrade, type ArrivalTradeStatus } from '@/lib/arrival-trade'
import { generateId } from '@/lib/utils'
import type { ArrivalLeg, BridgeOperation, SecondLeg } from '@/store/transaction-store'

export const arrivalSoftMessageKey = (status: ArrivalTradeStatus): string | undefined => {
  switch (status.kind) {
    case 'Waiting':
      return 'arrival.waiting'
    case 'BelowFloor':
      return 'arrival.belowFloor'
    case 'FeeShortfall':
      return 'arrival.feeShortfall'
    case 'BroadcastConflict':
      return 'arrival.broadcastConflict'
    case 'TradeLayoutError':
      return undefined
    default:
      return undefined
  }
}

export type ArrivalLegUpdate = Partial<BridgeOperation>

export const arrivalCompletedUpdate = (status: Extract<ArrivalTradeStatus, { kind: 'Swapped' }>, category: string): ArrivalLegUpdate => {
  const attempt = generateId()
  const secondLeg: SecondLeg = {
    attempt,
    category,
    sellSats: status.soldSats.toString(),
    minOutput: status.tokens.toString(),
    tokenOut: status.tokens.toString(),
    routerFeeSats: '0',
    minerFeeSats: '0',
    txid: status.txid,
    signedHex: status.signedHex,
    confirmations: 0
  }
  return { stage: 'completed', error: undefined, secondLeg }
}

export const runArrivalSwap = async ({
  op,
  broadcast,
  signal
}: {
  op: BridgeOperation
  broadcast: boolean
  signal?: AbortSignal
}): Promise<{ status: ArrivalTradeStatus; update?: ArrivalLegUpdate; clearAddress?: string }> => {
  if (!op.arrival) throw new Error('Not an arrival operation')
  const funding = (op.received ?? []).map(o => ({ txid: o.txid, vout: o.vout, value: o.value }))
  if (funding.length === 0) return { status: { kind: 'Waiting', reason: 'no_coin' } }

  const checked = await checkUnspent(op.binding.lockingBytecode, funding)
  if (checked.some(o => !o.unspent)) throw new Error('Funding already spent')

  const session = await loadArrival(op.binding.cashAddress)
  if (!session) throw new Error('Arrival trade key missing from this browser')

  const status = await completeArrivalTrade({
    terms: op.arrival.terms,
    tradePrivateKeyHex: session.tradePrivateKeyHex,
    coins: funding,
    broadcast,
    signal
  })

  if (status.kind === 'Swapped' && broadcast) {
    return {
      status,
      update: arrivalCompletedUpdate(status, op.arrival.terms.category),
      clearAddress: op.binding.cashAddress
    }
  }

  const arrival: ArrivalLeg = { ...op.arrival, status: status.kind }
  return { status, update: { arrival } }
}

export const runArrivalRelease = async (op: BridgeOperation): Promise<{ status: ArrivalTradeStatus; update?: ArrivalLegUpdate; clearAddress?: string }> => {
  if (!op.arrival || !(op.received ?? []).length) throw new Error('Nothing to release')
  const session = await loadArrival(op.binding.cashAddress)
  if (!session) throw new Error('Arrival trade key missing from this browser')
  const coin = [...(op.received ?? [])].sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1))[0]
  const status = await buildArrivalReturn({
    terms: op.arrival.terms,
    tradePrivateKeyHex: session.tradePrivateKeyHex,
    coin: { txid: coin.txid, vout: coin.vout, value: coin.value },
    mode: 'release',
    broadcast: true
  })
  if (status.kind === 'Released') {
    return { status, update: { stage: 'kept_bch', error: undefined }, clearAddress: op.binding.cashAddress }
  }
  return { status, update: { arrival: { ...op.arrival, status: status.kind } } }
}

export { clearArrival }
