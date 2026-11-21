import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'
import { readRequestBody } from '@/lib/request-body'
import { SOLANA_RPC_URLS } from '@/lib/endpoints'
import { markDown, markUp, ordered, refused, retriable } from '@/lib/fallback'

// Server-side proxy for the Solana JSON-RPC calls the SDK's toolbox makes. No
// free endpoint works from a browser: api.mainnet-beta.solana.com answers a
// server fine but returns 403 to anything carrying an `Origin` header,
// publicnode blocks `getTokenAccountsByOwner` (half of what a balance asks
// for), and the rest want a key. Coming from our own origin sidesteps both, and
// keeps the key server-side when SOLANA_RPC_URL points at a paid endpoint.
const CONFIGURED_UPSTREAM = process.env.SOLANA_RPC_URL
// The configured node first, then the free ones; a node that fails, rate-limits or refuses a method passes the call on.
const UPSTREAMS = [...new Set([CONFIGURED_UPSTREAM, ...SOLANA_RPC_URLS].filter((url): url is string => !!url))]

// A stalled node would otherwise hold the handler — and the swap UI — open indefinitely.
const UPSTREAM_TIMEOUT_MS = 8_000

// A batch of balance calls is a few KB; anything beyond this is not the toolbox.
const MAX_BODY_BYTES = 100_000

// Enough for the 30s balance refresh plus a swap in flight, per client per the
// limiter's 10-minute window.
const RATE_LIMIT = 600

// The default upstream limits per IP, and behind this proxy every visitor shares
// the server's one — fine for development, quietly throttled in production. Say
// so once rather than leaving empty balances to be diagnosed from nothing.
let warnedAboutDefaultUpstream = false

function warnIfUnconfigured() {
  if (CONFIGURED_UPSTREAM || warnedAboutDefaultUpstream) return
  warnedAboutDefaultUpstream = true

  console.warn(
    'SOLANA_RPC_URL is not set, so Solana RPC calls go to the free public nodes, which rate limit per IP. ' +
      'Every visitor of this deployment shares that one bucket -- point SOLANA_RPC_URL at a dedicated endpoint.'
  )
}

// web3.js does not batch; a few calls per request is plenty, and the limiter charges each one.
const MAX_BATCH = 10

// Whole-chain scans that no balance, swap or status check here makes; one of them can cost a paid
// endpoint more than thousands of reads.
const HEAVY_METHODS = new Set(['getProgramAccounts', 'getLargestAccounts', 'getSignaturesForAddress', 'getBlock', 'getBlocks', 'getBlocksWithLimit'])

// Every other JSON-RPC method stays allowed -- pinning the list down would break a
// swap the day the SDK reaches for one more -- but the shape is checked so this
// cannot be used to POST arbitrary bodies at the upstream.
const isCall = (payload: unknown) => {
  const method = (payload as { method?: unknown } | null)?.method
  return !!payload && typeof payload === 'object' && !Array.isArray(payload) && typeof method === 'string' && !HEAVY_METHODS.has(method)
}

// The number of upstream calls in a request, or 0 when it is not an allowed JSON-RPC request or flat batch.
function callCount(payload: unknown): number {
  if (!Array.isArray(payload)) return isCall(payload) ? 1 : 0
  return payload.length > 0 && payload.length <= MAX_BATCH && payload.every(isCall) ? payload.length : 0
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return apiError(
      403,
      'forbidden',
      'Cross-origin requests are not allowed',
      'This proxy only serves the Cash Bridge frontend. Use your own Solana RPC endpoint instead.'
    )
  }

  const body = await readRequestBody(req, MAX_BODY_BYTES)
  if (typeof body !== 'string') return body

  let calls = 0
  try {
    calls = callCount(JSON.parse(body))
  } catch {}
  if (!calls) {
    return apiError(
      400,
      'bad_request',
      'Invalid JSON-RPC request',
      `The body must be a JSON-RPC request object, or an array of at most ${MAX_BATCH}; whole-chain scans are not served.`
    )
  }

  const retryAfter = rateLimit(req, 'solana', RATE_LIMIT, calls)
  if (retryAfter !== null) {
    return apiError(429, 'rate_limited', 'Too many requests', `Retry after ${retryAfter} seconds (see the Retry-After header).`, {
      'Retry-After': String(retryAfter)
    })
  }

  warnIfUnconfigured()

  let answer: { status: number; type: string; payload: string } | undefined
  for (const url of ordered(UPSTREAMS)) {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    }).catch(() => null)
    if (!upstream) {
      markDown(url)
      continue
    }
    answer = { status: upstream.status, type: upstream.headers.get('content-type') ?? 'application/json', payload: await upstream.text() }
    let parsed: unknown
    try {
      parsed = JSON.parse(answer.payload)
    } catch {}
    if (!retriable(answer.status) && parsed !== undefined && !refused(parsed)) {
      markUp(url)
      break
    }
    markDown(url)
  }

  if (!answer) {
    return apiError(
      502,
      'upstream_unreachable',
      'The Solana RPC is unreachable',
      `No Solana node responded within ${UPSTREAM_TIMEOUT_MS / 1000} seconds. Retry in a moment.`
    )
  }

  return new NextResponse(answer.payload, {
    status: answer.status,
    headers: { 'Content-Type': answer.type, 'Cache-Control': 'no-store' }
  })
}

export const GET = methodNotAllowed(['POST'])
export const PUT = methodNotAllowed(['POST'])
export const PATCH = methodNotAllowed(['POST'])
export const DELETE = methodNotAllowed(['POST'])
