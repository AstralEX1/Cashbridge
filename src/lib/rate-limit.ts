import { NextRequest } from 'next/server'

const WINDOW_MS = 10 * 60 * 1000
const MAX_TRACKED_CLIENTS = 10_000

const hits = new Map<string, number[]>()

/**
 * The caller's IP as seen by the proxy in front of this app.
 *
 * Never the *first* `x-forwarded-for` hop: Cloudflare appends the real client
 * IP to whatever the caller sent, so the leftmost entry is attacker-controlled
 * and rotating it hands out an unlimited number of buckets. `cf-connecting-ip`
 * is set by the edge and overwrites any client-supplied copy; the last
 * forwarded hop is the equivalent fallback for any other single proxy.
 */
export function clientIp(req: NextRequest) {
  // Vercel has no Cloudflare in front: a caller can send its own `cf-connecting-ip`, while Vercel
  // overwrites `x-vercel-forwarded-for` and `x-real-ip` with the address it saw.
  if (process.env.VERCEL) return req.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip')?.trim() || 'unknown'

  const edgeIp = req.headers.get('cf-connecting-ip')?.trim()
  if (edgeIp) return edgeIp

  const forwarded = req.headers.get('x-forwarded-for')
  if (!forwarded) return 'unknown'

  const hops = forwarded.split(',')
  return hops[hops.length - 1].trim() || 'unknown'
}

function sweep(now: number) {
  for (const [key, timestamps] of hits) {
    if (timestamps[timestamps.length - 1] <= now - WINDOW_MS) hits.delete(key)
  }
}

/**
 * In-memory sliding-window limiter, sufficient for the single-instance
 * standalone deployment. Returns seconds to wait when the limit is hit,
 * or null when the request is allowed. `cost` charges one request for
 * several units of work, all or nothing.
 */
export function rateLimit(req: NextRequest, scope: string, limit: number, cost = 1): number | null {
  if (cost <= 0) return null
  const now = Date.now()
  if (hits.size > MAX_TRACKED_CLIENTS) sweep(now)

  const key = `${scope}:${clientIp(req)}`
  const recent = (hits.get(key) ?? []).filter(ts => ts > now - WINDOW_MS)

  if (recent.length + cost > limit) {
    hits.set(key, recent)
    // Wait until enough of the oldest hits have aged out to make room for this cost.
    const freed = recent[recent.length + cost - limit - 1]
    return Math.ceil(((freed ?? now) + WINDOW_MS - now) / 1000)
  }

  for (let i = 0; i < cost; i++) recent.push(now)
  hits.set(key, recent)
  return null
}
