import { existsSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { sourceTransactionId, sameSourceTransaction } from '@/lib/source-transaction'
import { minOutputFor, secondLegSellAmount } from '@/lib/bridge'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'
import { OrderError, orderCategory, positiveAmount, type OrderIntent } from '@/server/auto-bridge/types'
import type { OrderStore } from '@/server/auto-bridge/store'

type Service = { store: OrderStore; quote: (sats: bigint, category: string) => Promise<{ output: bigint }>; admit?: () => boolean }
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
const errorReply = (error: unknown) =>
  reply(
    { error: error instanceof OrderError ? error.message : 'Automatic bridge temporarily unavailable' },
    error instanceof OrderError ? error.status : 503
  )
const token = (req: NextRequest) => {
  const value = req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!value) throw new OrderError(401, 'Order authorization required')
  return value
}
const body = async (req: NextRequest) => {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new OrderError(415, 'JSON request required')
  const reader = req.body?.getReader()
  if (!reader) throw new OrderError(400, 'Request body required')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > 4096) {
        await reader.cancel()
        throw new OrderError(413, 'Request body too large')
      }
      chunks.push(next.value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof OrderError) throw error
    throw new OrderError(400, 'Invalid JSON request')
  }
}
const guard = (req: NextRequest, mutation: boolean) => {
  if (mutation && !isSameOrigin(req)) throw new OrderError(403, 'Same-origin request required')
  if (rateLimit(req, mutation ? 'automatic-order-write' : 'automatic-order-read', mutation ? 10 : 600) !== null)
    throw new OrderError(429, 'Too many order requests')
}

export async function createOrder(req: NextRequest, service: Service) {
  try {
    guard(req, true)
    const cap = token(req),
      input = await body(req)
    if (
      typeof input.id !== 'string' ||
      typeof input.recipientAddress !== 'string' ||
      typeof input.refundAddress !== 'string' ||
      input.recipientAddress.length > 200 ||
      input.refundAddress.length > 200
    )
      throw new OrderError(400, 'Order identifier and recipient addresses are required')
    const intent: OrderIntent = {
      recipientAddress: input.recipientAddress.trim(),
      refundAddress: input.refundAddress.trim(),
      expectedBchSats: positiveAmount(input.expectedBchSats)
    }
    if (input.category !== undefined) {
      if (typeof input.category !== 'string' || !/^[0-9a-f]{64}$/.test(input.category)) throw new OrderError(400, 'Invalid token category')
      intent.category = input.category
    }
    if (input.source !== undefined) {
      const source = input.source as Record<string, unknown>
      if (!source || typeof source !== 'object' ||
        !['chain', 'asset', 'amount', 'address'].every(key => typeof source[key] === 'string' && (source[key] as string).length > 0 && (source[key] as string).length <= 256) ||
        !/^\d+(?:\.\d+)?$/.test(source.amount as string)) throw new OrderError(400, 'Invalid source intent')
      intent.source = { chain: source.chain as string, asset: source.asset as string, amount: source.amount as string, address: source.address as string }
    }
    const { store, quote, admit } = service
    const old = store.get(input.id)
    if (old) {
      store.create(input.id, cap, intent, old.minPusd)
      return reply(store.public(input.id, cap))
    }
    const open = admit ? admit() : process.env.AUTO_BRIDGE_ADMISSION !== 'false' &&
      !(process.env.AUTO_BRIDGE_ADMISSION_PAUSE_FILE && existsSync(process.env.AUTO_BRIDGE_ADMISSION_PAUSE_FILE))
    if (!open) throw new OrderError(503, 'New automatic orders are paused')
    store.assertWritable()
    if (BigInt(intent.expectedBchSats) > store.limits.maxOrderSats) throw new OrderError(400, 'Amount exceeds the order limit')
    const amount = secondLegSellAmount(BigInt(intent.expectedBchSats))
    if (amount <= 0n) throw new OrderError(400, 'Amount is too small for the automatic bridge')
    const floor = minOutputFor((await quote(amount, orderCategory(intent))).output)
    if (floor <= 0n) throw new OrderError(400, 'No executable token quote for this amount')
    const order = store.create(input.id, cap, intent, floor.toString())
    return reply(store.public(order.id, cap), 201)
  } catch (error) {
    return errorReply(error)
  }
}

export async function getOrder(req: NextRequest, id: string, service: Service) {
  try {
    guard(req, false)
    return reply(service.store.public(id, token(req)))
  } catch (error) {
    return errorReply(error)
  }
}

export async function attachSource(req: NextRequest, id: string, service: Service) {
  try {
    guard(req, true)
    const cap = token(req),
      input = await body(req)
    const sourceHash = sourceTransactionId(input.sourceHash)
    if (!sourceHash)
      throw new OrderError(400, 'Invalid source transaction identifier')
    const store = service.store,
      order = store.authorized(id, cap)
    if (order.sourceHash && !sameSourceTransaction(order.sourceHash, sourceHash) && !sameSourceTransaction(order.inboundHash, sourceHash)) throw new OrderError(409, 'Order already has a source transaction')
    if (order.inboundHash && !sameSourceTransaction(order.inboundHash, sourceHash)) throw new OrderError(409, 'Source transaction does not match the observed order')
    if (!store.update(id, order.version, { sourceHash })) throw new OrderError(409, 'Order changed; retry the source hint')
    return reply(store.public(id, cap))
  } catch (error) {
    return errorReply(error)
  }
}
