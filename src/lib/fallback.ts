// Rotation over equivalent public endpoints (lists in src/lib/endpoints.ts). An endpoint that fails, times out or
// rate-limits is asked last for a minute, so one that answers stays first; its answer, whatever it says, is final.

const COOLDOWN_MS = 60_000
const downUntil = new Map<string, number>()

export const ordered = (urls: readonly string[]) => {
  const now = Date.now()
  return [...urls].sort((a, b) => Number((downUntil.get(a) ?? 0) > now) - Number((downUntil.get(b) ?? 0) > now))
}
export const markDown = (url: string) => void downUntil.set(url, Date.now() + COOLDOWN_MS)
export const markUp = (url: string) => void downUntil.delete(url)

// Statuses that say "not here, ask another": auth walls (keyed plans, Cloudflare blocks), timeouts, rate limits and
// server errors. A 404 or 400 is the endpoint's real answer about the request.
export const retriable = (status: number) => status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500

// A JSON-RPC error that is a plan limit or rate limit, not the chain's verdict ("execution reverted" stays an answer).
const REFUSAL = /rate.?limit|too many|limit exceeded|exceeded the|capacity|not available on|upgrade|unauthori[sz]ed|forbidden|api.?key|blocked|not allowed|cannot fulfill|header not found|\brange\b|timeout|timed out/i
export const refused = (body: unknown) =>
  (Array.isArray(body) ? body : [body]).some(item => {
    const error = (item as { error?: { message?: unknown } } | null)?.error
    const message = typeof error === 'object' ? String(error?.message ?? '') : String(error)
    return !!error && REFUSAL.test(message) && !/revert/i.test(message)
  })

type Init = RequestInit & { timeoutMs?: number }

// The first acceptable response for `path` on any of `bases`. A caller's abort stops the rotation.
export async function fetchFirst(bases: readonly string[], path = '', { timeoutMs = 15_000, signal, ...init }: Init = {}): Promise<Response> {
  let lastError: unknown = new Error('No endpoint configured')
  for (const base of ordered(bases)) {
    if (signal?.aborted) break
    try {
      const response = await fetch(base + path, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) })
      if (!retriable(response.status)) {
        markUp(base)
        return response
      }
      await response.body?.cancel().catch(() => {})
      lastError = new Error(`${new URL(base).host} answered ${response.status}`)
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
    }
    markDown(base)
  }
  throw signal?.aborted ? signal.reason : lastError
}

// Nodes that refuse a browser's CORS preflight (Monad, X Layer) still answer a simple request: no JSON content type.
const simple = new Set<string>()

const post = async (url: string, body: string, timeoutMs: number) => {
  const send = (plain: boolean) =>
    fetch(url, { method: 'POST', headers: plain ? {} : { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(timeoutMs) })
  if (simple.has(url)) return send(true)
  try {
    return await send(false)
  } catch (error) {
    // A browser reports a refused preflight as a TypeError; servers never need the simple form.
    if (typeof window === 'undefined' || !(error instanceof TypeError)) throw error
    const response = await send(true)
    simple.add(url)
    return response
  }
}

// One JSON-RPC exchange (a request or a batch) on the first endpoint that serves it. `accept` can rule a node out first.
export async function rpcFirst(urls: readonly string[], payload: unknown, { timeoutMs = 10_000, accept }: { timeoutMs?: number; accept?: (url: string) => Promise<boolean> } = {}): Promise<unknown> {
  const body = JSON.stringify(payload)
  let lastError: unknown = new Error('No RPC configured')
  for (const url of ordered(urls)) {
    try {
      if (accept && !(await accept(url))) {
        lastError = new Error(`${new URL(url).host} did not prove it serves this chain`)
        markDown(url)
        continue
      }
      const response = await post(url, body, timeoutMs)
      const answer = await response.json().catch(() => undefined)
      if (!retriable(response.status) && answer !== undefined && !refused(answer)) {
        markUp(url)
        return answer
      }
      lastError = new Error(`${new URL(url).host} answered ${response.status}${answer === undefined ? ' without JSON' : ''}`)
    } catch (error) {
      lastError = error
    }
    markDown(url)
  }
  throw lastError
}
