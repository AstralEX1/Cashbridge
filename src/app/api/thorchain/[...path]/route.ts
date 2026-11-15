import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'
import { readRequestBody } from '@/lib/request-body'

// Server-side proxy for the hosted THORChain aggregator (api.thorchain.org/v1), so the
// x-api-key stays on the server instead of shipping in the client bundle. The SDK and
// src/lib/api.ts point their aggregator base URL here (see aggregatorApiUrl) and send no
// key of their own; this route adds THORCHAIN_API_KEY. Only the calls the swap flow makes
// are forwarded - it is not a general proxy for the aggregator.
const DEFAULT_UPSTREAM = 'https://api.thorchain.org/v1'

const UPSTREAM_TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 16 * 1024
const RETRYABLE_UPSTREAM_STATUSES = new Set([502, 503, 504])

type Endpoint = { method: 'GET' | 'POST'; path: RegExp; query?: string[] }

const ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: /^providers$/ },
  { method: 'GET', path: /^tokens$/, query: ['provider'] },
  { method: 'GET', path: /^balance$/, query: ['chain', 'address', 'identifier'] },
  { method: 'POST', path: /^quote$/ },
  { method: 'POST', path: /^track$/ },
  // The referral click-through ping (src/lib/referral.ts); carries no body.
  { method: 'POST', path: /^referral\/[a-z0-9_-]{1,64}\/visit$/i }
]

// Headers the browser may pass through. Nothing that could carry a credential.
const FORWARDED_HEADERS = ['x-referral-code']

function resolve(method: string, fullPath: string[], search: URLSearchParams) {
  // Served at /api/thorchain/v1/*, mirroring the upstream's versioned base.
  const [version, ...path] = fullPath
  if (version !== 'v1') return null

  // Next decodes catch-all segments, so an encoded slash or dot-segment would walk out of
  // the allowlisted path once fetch normalises the URL.
  if (path.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) return null

  const joined = path.join('/')
  const endpoint = ENDPOINTS.find(e => e.method === method && e.path.test(joined))
  if (!endpoint) return null

  const query = new URLSearchParams()
  for (const [key, value] of search) {
    if (!endpoint.query?.includes(key) || query.has(key) || value.length > 256) return null
    query.set(key, value)
  }

  return { path: path.map(encodeURIComponent).join('/'), query: query.toString() }
}

async function forward(req: NextRequest, path: string[], method: 'GET' | 'POST') {
  if (!isSameOrigin(req)) {
    return apiError(403, 'forbidden', 'Cross-origin requests are not allowed', 'This proxy only serves this site. Use api.thorchain.org with your own API key.')
  }

  const retryAfter = rateLimit(req, 'thorchain-aggregator', 600)
  if (retryAfter !== null) {
    return apiError(429, 'rate_limited', 'Too many requests', `Retry after ${retryAfter} seconds (see the Retry-After header).`, {
      'Retry-After': String(retryAfter)
    })
  }

  const target = resolve(method, path, req.nextUrl.searchParams)
  if (!target) return apiError(404, 'not_found', 'Unsupported aggregator path', 'This proxy only forwards the providers, tokens, balance, quote and track calls.')

  const apiKey = process.env.THORCHAIN_API_KEY
  if (!apiKey) {
    return apiError(500, 'server_misconfigured', 'Server misconfiguration', 'THORCHAIN_API_KEY is not set on the server.')
  }

  let body: string | undefined
  if (method === 'POST') {
    const payload = await readRequestBody(req, MAX_BODY_BYTES)
    if (typeof payload !== 'string') return payload
    body = payload
    if (body) {
      try {
        JSON.parse(body)
      } catch {
        return apiError(400, 'bad_request', 'Body must be JSON', 'Send a JSON request body.')
      }
    }
  }

  const headers: Record<string, string> = { 'x-api-key': apiKey }
  if (body) headers['Content-Type'] = 'application/json'
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name)
    if (value && /^[a-z0-9_-]{1,64}$/i.test(value)) headers[name] = value
  }

  const upstreamBase = (process.env.THORCHAIN_API_URL || DEFAULT_UPSTREAM).replace(/\/$/, '')
  const url = `${upstreamBase}/${target.path}${target.query ? `?${target.query}` : ''}`

  const fetchUpstream = () => fetch(url, {
    method,
    headers,
    body,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  })

  let upstream = await fetchUpstream().catch(() => null)

  // Quotes and balances are read-only, so retry one explicit gateway failure before the SDK logs it
  // as an error. A timed-out or unreachable upstream is not retried, keeping the request within its current bound.
  const readOnly = (method === 'POST' && target.path === 'quote') || (method === 'GET' && target.path === 'balance')
  if (readOnly && upstream && RETRYABLE_UPSTREAM_STATUSES.has(upstream.status)) {
    const firstResponse = upstream
    const retry = await fetchUpstream().catch(() => null)
    if (retry) {
      await firstResponse.body?.cancel().catch(() => {})
      upstream = retry
    }
  }

  if (!upstream) {
    return apiError(502, 'upstream_unreachable', 'THORChain aggregator is unreachable', 'The upstream API did not respond. Retry in a moment.')
  }

  // Only the body and status go back: no upstream headers, which could echo request details.
  const payload = await upstream.text()
  return new NextResponse(payload, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type')?.startsWith('application/json') ? 'application/json' : 'text/plain',
      'Cache-Control': 'no-store'
    }
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, 'GET')
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path, 'POST')
}

export const PUT = methodNotAllowed(['GET', 'POST'])
export const PATCH = methodNotAllowed(['GET', 'POST'])
export const DELETE = methodNotAllowed(['GET', 'POST'])
