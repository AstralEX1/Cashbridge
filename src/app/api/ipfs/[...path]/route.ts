import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'
import { IPFS_GATEWAYS } from '@/lib/endpoints'

// Same-origin proxy for BCMR / Cauldron token icons that live on IPFS. Browsers block
// public gateways with Cross-Origin-Resource-Policy; serving the bytes from this host keeps
// <img> loads working without relaxing CORP on a third-party gateway.
const UPSTREAMS = IPFS_GATEWAYS
const UPSTREAM_TIMEOUT_MS = 12_000
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

  let payload: ArrayBuffer | undefined
  let type = ''
  for (const base of UPSTREAMS) {
    let upstream: Response
    try {
      upstream = await fetch(`${base}/${joined}`, {
        // Next's fetch cache buffers a clone before our size check; cache only the bounded response.
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { Accept: 'image/*,*/*;q=0.8' }
      })
    } catch {
      continue
    }
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {})
      continue
    }
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    // Some gateways omit content-type or send octet-stream; sniff later.
    if ((contentType && contentType !== 'application/octet-stream' && !ALLOWED_TYPES.has(contentType)) || Number(upstream.headers.get('content-length')) > MAX_BYTES) {
      await upstream.body?.cancel().catch(() => {})
      continue
    }
    const reader = upstream.body?.getReader()
    if (!reader) continue
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        length += next.value.byteLength
        if (length > MAX_BYTES) break
        chunks.push(next.value)
      }
    } catch {
      continue
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (!length || length > MAX_BYTES) continue
    const bytes = Uint8Array.from(Buffer.concat(chunks))
    const sniffed = contentType && contentType !== 'application/octet-stream' ? contentType : sniffImageType(bytes)
    if (!sniffed || !ALLOWED_TYPES.has(sniffed)) continue
    payload = bytes.buffer
    type = sniffed
    break
  }

  if (!payload || !type) {
    return apiError(502, 'upstream_unreachable', 'IPFS gateway unreachable', 'Retry in a moment.')
  }

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      // SVG is untrusted active content when opened directly, even when <img> cannot run it.
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin'
    }
  })
}

function sniffImageType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return 'image/webp'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif'
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trimStart()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml'
  return undefined
}

export const POST = methodNotAllowed(['GET'])
export const PUT = methodNotAllowed(['GET'])
export const PATCH = methodNotAllowed(['GET'])
export const DELETE = methodNotAllowed(['GET'])
