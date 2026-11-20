import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'

// Same-origin proxy for BCMR / Cauldron token icons that live on IPFS. Browsers block
// ipfs.io with Cross-Origin-Resource-Policy; serving the bytes from this host keeps
// <img> loads working without relaxing CORP on a third-party gateway.
const UPSTREAM = 'https://ipfs.io/ipfs'
const UPSTREAM_TIMEOUT_MS = 15_000
const MAX_BYTES = 512 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'])

// CIDv0 (Qm…) or CIDv1 (bafy… / bafk…), optionally followed by a short nested path.
const IPFS_PATH = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{20,})(?:\/[A-Za-z0-9._~-]{1,128}){0,6}$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!isSameOrigin(req)) {
    return apiError(403, 'forbidden', 'Cross-origin requests are not allowed', 'This proxy only serves this site.')
  }

  const retryAfter = rateLimit(req, 'ipfs-icon', 120)
  if (retryAfter !== null) {
    return apiError(429, 'rate_limited', 'Too many requests', `Retry after ${retryAfter} seconds.`, {
      'Retry-After': String(retryAfter)
    })
  }

  const segments = (await params).path
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) {
    return apiError(400, 'bad_request', 'Invalid IPFS path', 'Path segments must be a CID and optional nested names.')
  }
  const joined = segments.map(encodeURIComponent).join('/')
  if (!IPFS_PATH.test(decodeURIComponent(joined))) {
    return apiError(400, 'bad_request', 'Invalid IPFS path', 'Only CIDv0/CIDv1 icon paths are forwarded.')
  }

  let upstream: Response
  try {
    upstream = await fetch(`${UPSTREAM}/${joined}`, {
      cache: 'force-cache',
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: 'image/*,*/*;q=0.8' }
    })
  } catch {
    return apiError(502, 'upstream_unreachable', 'IPFS gateway unreachable', 'Retry in a moment.')
  }

  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {})
    return apiError(upstream.status === 404 ? 404 : 502, 'upstream_error', 'Icon not found', 'The IPFS gateway did not return this icon.')
  }

  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_TYPES.has(type)) {
    await upstream.body?.cancel().catch(() => {})
    return apiError(502, 'upstream_error', 'Unexpected content type', 'Only image responses are proxied.')
  }

  const buffer = Buffer.from(await upstream.arrayBuffer())
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    return apiError(502, 'upstream_error', 'Icon too large or empty', 'Icons must be under 512 KiB.')
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Cross-Origin-Resource-Policy': 'same-origin'
    }
  })
}

export const POST = methodNotAllowed(['GET'])
export const PUT = methodNotAllowed(['GET'])
export const PATCH = methodNotAllowed(['GET'])
export const DELETE = methodNotAllowed(['GET'])
