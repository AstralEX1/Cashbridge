import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { USwapNumber } from '@tcswap/core'
import { isBridgeRoute } from '@/lib/api'
import { withLock } from '@/lib/bridge-first-leg'
import { isUserRejection } from '@/lib/errors'
import { sourceTransactionId } from '@/lib/source-transaction'
import { addressToLockingBytecode } from '@/lib/bch'
import { autoBridgeStore, type SavedAutoOrder } from '@/store/auto-bridge-store'
import { isTerminal, type PublicOrder } from '@/lib/auto-bridge-contract'

export class OrderRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const attemptKey = (id: string) => `cashbridge-auto-source-${id}`
const attemptRecorded = (reference: SavedAutoOrder) => reference.sourceAttempted ||
  (typeof window !== 'undefined' && localStorage.getItem(attemptKey(reference.id)) === 'attempted')
export const assertAutomaticSaved = (reference: SavedAutoOrder, attempted = false) => {
  if (typeof window === 'undefined') return
  try {
    const saved = JSON.parse(localStorage.getItem(`cashbridge-auto-order-${reference.id}`) ?? 'null') as SavedAutoOrder | null
    if (saved?.capability === reference.capability && (!attempted || localStorage.getItem(attemptKey(reference.id)) === 'attempted')) return
  } catch { /* A payment must not start without a durable local reference. */ }
  throw new Error('Allow browser storage before starting an automatic transfer')
}
export async function orderRequest(reference: SavedAutoOrder, method: 'GET' | 'POST', body?: unknown): Promise<PublicOrder> {
  const path = method === 'POST' && body && typeof body === 'object' && 'id' in body ? '' : `/${reference.id}`
  const response = await fetch(`/api/auto-bridge/orders${path}`, {
    method,
    headers: { Authorization: `Bearer ${reference.capability}`, ...(method === 'POST' && { 'Content-Type': 'application/json' }) },
    ...(method === 'POST' && { body: JSON.stringify(body) }), cache: 'no-store', signal: AbortSignal.timeout(30000)
  })
  const result = await response.json()
  if (!response.ok) throw new OrderRequestError(response.status, typeof result.error === 'string' ? result.error : 'Automatic bridge request failed')
  const order = result as PublicOrder
  if (order.id !== reference.id || !addressToLockingBytecode(order.depositAddress) || !/^[1-9]\d*$/.test(order.minPusd))
    throw new Error('The automatic order response is invalid')
  if (reference.intent && (order.expectedBchSats !== reference.intent.expectedBchSats ||
    addressToLockingBytecode(order.recipientAddress) !== addressToLockingBytecode(reference.intent.recipientAddress) ||
    addressToLockingBytecode(order.refundAddress) !== addressToLockingBytecode(reference.intent.refundAddress)))
    throw new Error('The automatic order does not match the confirmed transfer')
  return order
}

const creating = new Set<string>()
// The poller restores every saved order that has no server record yet, so while the create is in
// flight it leaves that order alone; otherwise both would POST it (same id, so harmless, but twice).
export async function createAutomaticOrder(reference: SavedAutoOrder): Promise<PublicOrder> {
  creating.add(reference.id)
  try { return await orderRequest(reference, 'POST', { id: reference.id, ...reference.intent }) }
  finally { creating.delete(reference.id) }
}

export async function restoreAutomaticOrder(reference: SavedAutoOrder): Promise<PublicOrder> {
  let order: PublicOrder
  try { order = await orderRequest(reference, 'GET') }
  catch (error) {
    if (!(error instanceof OrderRequestError) || error.status !== 404 || !reference.intent || attemptRecorded(reference)) throw error
    order = await orderRequest(reference, 'POST', { id: reference.id, ...reference.intent })
  }
  autoBridgeStore.getState().patch(reference.id, { order })
  return order
}

export type OrderPollSchedule = Map<string, { at: number; attempted: boolean; failed: boolean }>

export async function pollAutomaticOrders(nextPoll: OrderPollSchedule, stopped: () => boolean) {
  let failed = false
  for (const reference of autoBridgeStore.getState().orders) {
    if (stopped()) break
    if (creating.has(reference.id)) continue
    const deferred = nextPoll.get(reference.id)
    if (deferred && deferred.at > Date.now() && deferred.attempted === !!reference.sourceAttempted) {
      failed ||= deferred.failed
      continue
    }
    try {
      const order = await restoreAutomaticOrder(reference)
      const delay = isTerminal(order.state) ? 300000 : reference.sourceAttempted ? 5000 : 60000
      nextPoll.set(reference.id, { at: Date.now() + delay, attempted: !!reference.sourceAttempted, failed: false })
    } catch {
      failed = true
      nextPoll.set(reference.id, { at: Date.now() + 60000, attempted: !!reference.sourceAttempted, failed: true })
    }
  }
  return failed
}

export async function startAutomaticSource(
  reference: SavedAutoOrder,
  route: QuoteResponseRoute,
  sellAsset: string,
  execute: () => Promise<string>,
  hint: (hash: string) => Promise<unknown>,
  stillCurrent: () => boolean = () => true
) {
  if (typeof window !== 'undefined' && !navigator.locks) throw new Error('Please use an updated browser to start an automatic transfer safely')
  const hash = await withLock(`cashbridge-auto-source-${reference.id}`, async () => {
    if (typeof window !== 'undefined') await autoBridgeStore.persist?.rehydrate()
    const saved = autoBridgeStore.getState().orders.find(order => order.id === reference.id)
    const order = saved?.order
    if (!saved || attemptRecorded(saved) || !order || !isBridgeRoute(route, { sellAsset, destinationAddress: order.depositAddress }))
      throw new Error('Prepare a new executable quote for this order')
    if ((order.state && order.state !== 'awaiting_deposit') || order.sourceHash || order.inboundHash || BigInt(order.receivedSats ?? '0') > 0n || order.payoutTxid)
      throw new Error('This order already has a payment; check its status instead of sending again')
    const source = saved.intent?.source
    if (source && (source.asset !== sellAsset || !new USwapNumber(route.sellAmount).eqValue(source.amount)))
      throw new Error('The prepared transfer has changed')
    if (!stillCurrent()) throw new Error('The prepared transfer has changed')
    // A separate per-order marker cannot be erased by an older tab persisting its history.
    if (typeof window !== 'undefined') localStorage.setItem(attemptKey(reference.id), 'attempted')
    autoBridgeStore.getState().patch(reference.id, { sourceAttempted: true })
    assertAutomaticSaved(reference, true)
    try {
      const result = await execute()
      const id = sourceTransactionId(result)
      if (!id) throw new Error('The wallet response is unclear; do not send again while the transfer is checked')
      autoBridgeStore.getState().patch(reference.id, { sourceHash: id })
      await hint(id).catch(() => undefined)
      return id
    } catch (error) {
      if (isUserRejection(error)) {
        if (typeof window !== 'undefined') localStorage.removeItem(attemptKey(reference.id))
        autoBridgeStore.getState().patch(reference.id, { sourceAttempted: false })
      }
      throw error
    }
  })
  if (!hash) throw new Error('This transfer is being confirmed in another window')
  return hash
}
