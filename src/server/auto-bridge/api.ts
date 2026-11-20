import { existsSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { sourceTransactionId, sameSourceTransaction } from '@/lib/source-transaction'
import { minOutputFor, secondLegSellAmount } from '@/lib/bridge'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'
import { BCH_DUST_THRESHOLD, checkInbound, type InboundAddress } from '@/lib/thorchain-deposit'
import { REFUND_FEE_CAP } from '@/lib/router-contract'
import { OrderError, orderCategory, positiveAmount, type OrderIntent } from '@/server/auto-bridge/types'
import { SALE_KEYS, SALE_ROUTE_KEYS, isScanAddress, type SaleIntent } from '@/lib/auto-bridge-contract'
import { addressToLockingBytecode } from '@/lib/bch'
import { findNearToken, getNearStatus, getNearTokens, submitNearDeposit, type NearStatusResponse, type OneClickToken } from '@/lib/near-intents'
import { SALE_ROUTE_OPEN_MS, saleRouteProblem } from '@/server/auto-bridge/sale-route'
import type { OrderStore } from '@/server/auto-bridge/store'

type Service = {
  store: OrderStore
  // What `amount` buys of the token (sats in, token units out), or with side 'sell' what that many tokens sell for in sats.
  quote: (amount: bigint, category: string, side?: 'buy' | 'sell') => Promise<{ output: bigint }>
  // THORNode's inbound addresses, which a sale's vault must match when given.
  inbound?: () => Promise<InboundAddress[]>
  // 1Click's status of a deposit address and its token list, which a routed sale's quote must match.
  near?: NearService
  admit?: () => boolean
}
export type NearService = {
  status: (depositAddress: string) => Promise<NearStatusResponse | undefined>
  tokens: () => Promise<OneClickToken[]>
  // 1Click's deposit notice (POST /v0/deposit/submit): optional, it only makes the solvers pick the deposit up sooner.
  submit?: (depositAddress: string, txHash: string) => Promise<boolean>
}
const defaultNear: NearService = { status: depositAddress => getNearStatus(depositAddress), tokens: getNearTokens, submit: submitNearDeposit }
// The hash as the source chain writes it: stored EVM hashes lose their 0x, and an EVM deposit address is 0x + 40 hex.
const nearTxHash = (depositAddress: string, hash: string) =>
  /^0x[0-9a-f]{40}$/i.test(depositAddress) && /^[0-9a-f]{64}$/.test(hash) ? `0x${hash}` : hash.replace(/-\d+$/, '')
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
    if (input.pageKey !== undefined) {
      if (typeof input.pageKey !== 'string' || !/^0[23][0-9a-f]{64}$/.test(input.pageKey)) throw new OrderError(400, 'Invalid page key')
      intent.pageKey = input.pageKey
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
    if (input.sale !== undefined) {
      const sale = input.sale as Record<string, unknown>
      const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256
      if (!sale || typeof sale !== 'object' || Array.isArray(sale) || !SALE_KEYS.every(key => text(sale[key])))
        throw new OrderError(400, 'Invalid sale intent')
      const route = SALE_ROUTE_KEYS.filter(key => sale[key] !== undefined)
      if (!route.every(key => text(sale[key]))) throw new OrderError(400, 'Invalid sale intent')
      intent.sale = Object.fromEntries([...SALE_KEYS, ...route].map(key => [key, sale[key]])) as unknown as SaleIntent
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
    let floor: bigint
    if (intent.sale) {
      const { sale } = intent
      // The contract's floor is the least BCH the sale may bring; it must still make a deposit after its fee.
      if (!sale.route && service.inbound) {
        try {
          checkInbound(await service.inbound(), sale.vaultAddress, sale.buyAsset.split('.')[0].toUpperCase())
        } catch {
          throw new OrderError(409, 'THORChain is not taking BCH at this vault; get a fresh quote')
        }
      }
      const output = (await quote(BigInt(positiveAmount(sale.tokenAmount)), sale.category, 'sell')).output
      if (output > store.limits.maxOrderSats) throw new OrderError(400, 'Amount exceeds the order limit')
      floor = minOutputFor(output)
      if (floor < BCH_DUST_THRESHOLD + REFUND_FEE_CAP) throw new OrderError(400, 'Amount is too small for the automatic bridge')
      if (sale.route) {
        if (!store.saleRoutes) throw new OrderError(400, 'Transfers back from BCH through NEAR Intents or ShapeShift are not available through the Cashbridge Router')
        const near = service.near ?? defaultNear
        const refundScript = addressToLockingBytecode(intent.refundAddress)
        const [status, tokens] = await Promise.all([near.status(sale.vaultAddress), near.tokens()]).catch(() => {
          throw new OrderError(503, 'NEAR Intents is unavailable; try again shortly')
        })
        const problem = saleRouteProblem(status, sale, { refundScript: refundScript ?? '', minSats: floor }, Date.now() + SALE_ROUTE_OPEN_MS, findNearToken(tokens, sale.buyAsset)?.assetId ?? '')
        if (problem) throw new OrderError(409, `${problem}; get a fresh quote`)
      }
    } else {
      const amount = secondLegSellAmount(BigInt(intent.expectedBchSats))
      if (amount <= 0n) throw new OrderError(400, 'Amount is too small for the automatic bridge')
      floor = minOutputFor((await quote(amount, orderCategory(intent))).output)
      if (floor <= 0n) throw new OrderError(400, 'No executable token quote for this amount')
    }
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

// The newest orders for the public scanner; the same chain facts anyone can read, so no order capability.
// `?address=` narrows them to one wallet's orders, and the answer names that address so a caller can tell
// a filtered list from an older Router that ignores the filter.
export async function listOrders(req: NextRequest, service: Service) {
  try {
    guard(req, false)
    const address = req.nextUrl.searchParams.get('address')
    if (address === null) return reply({ orders: service.store.feed() })
    if (!isScanAddress(address)) throw new OrderError(400, 'Invalid address')
    return reply({ orders: service.store.feed(40, address), address })
  } catch (error) {
    return errorReply(error)
  }
}

export async function attachSource(req: NextRequest, id: string, service: Service) {
  try {
    guard(req, true)
    const cap = token(req),
      input = await body(req)
    const near = input.nearDepositAddress
    // TON deposit addresses are base64url (UQ…, with - and _).
    if (near !== undefined && (typeof near !== 'string' || !/^[0-9A-Za-z:_-]{20,120}$/.test(near))) throw new OrderError(400, 'Invalid NEAR Intents deposit address')
    // ShapeShift quoted that NEAR Intents address; its id only lets the customer find the swap there.
    const quoteId = input.shapeshiftQuoteId
    if (quoteId !== undefined && (near === undefined || typeof quoteId !== 'string' || !/^[0-9A-Za-z-]{1,100}$/.test(quoteId)))
      throw new OrderError(400, 'Invalid ShapeShift quote id')
    // The NEAR deposit address may come alone, before the wallet sends: the worker then finds the payout without the hash.
    const sourceHash = sourceTransactionId(input.sourceHash)
    if (!sourceHash && (input.sourceHash !== undefined || near === undefined))
      throw new OrderError(400, 'Invalid source transaction identifier')
    const store = service.store,
      order = store.authorized(id, cap)
    if (near !== undefined && near !== order.nearDepositAddress) {
      if (!store.nearOrders) throw new OrderError(400, 'NEAR Intents is not available through the Cashbridge Router')
      // Set once, on a forward order nothing has paid yet. 1Click pays q… and p… addresses, the contract's P2SH20 one too.
      if (order.nearDepositAddress || order.sale || order.state !== 'awaiting_deposit' || order.sourceHash || order.inboundHash)
        throw new OrderError(409, 'Order already has a source route')
    }
    if (sourceHash) {
      if (order.sourceHash && !sameSourceTransaction(order.sourceHash, sourceHash) && !sameSourceTransaction(order.inboundHash, sourceHash)) throw new OrderError(409, 'Order already has a source transaction')
      if (order.inboundHash && !sameSourceTransaction(order.inboundHash, sourceHash)) throw new OrderError(409, 'Source transaction does not match the observed order')
    }
    if (near !== undefined && near === order.nearDepositAddress && quoteId !== order.shapeshiftQuoteId && (quoteId !== undefined || order.shapeshiftQuoteId !== undefined))
      throw new OrderError(409, 'Order already has a source route')
    const route = near !== undefined && near !== order.nearDepositAddress ? { nearDepositAddress: near, ...(quoteId && { shapeshiftQuoteId: quoteId }) } : {}
    if (!store.update(id, order.version, { ...(sourceHash && { sourceHash }), ...route }))
      throw new OrderError(409, 'Order changed; retry the source hint')
    // The page tells 1Click too; this covers a page that closed first and hashes from agents. A failure only slows the swap.
    const deposit = near ?? order.nearDepositAddress
    if (sourceHash && deposit && !order.sourceHash) void (service.near ?? defaultNear).submit?.(deposit, nearTxHash(deposit, sourceHash)).catch(() => false)
    return reply(store.public(id, cap))
  } catch (error) {
    return errorReply(error)
  }
}
