import { request } from 'node:http'
import { request as secureRequest } from 'node:https'
import { NextRequest, NextResponse } from 'next/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'

// The public process has socket access, not access to the signer or its SQLite database.
export async function forwardOrder(req: NextRequest, id?: string) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  const failure = (status: number, error: string) => NextResponse.json({ error }, { status, headers })
  if (id && !/^[a-f0-9-]{36}$/.test(id)) return failure(400, 'Invalid order identifier')
  if (req.method === 'POST' && !isSameOrigin(req)) return failure(403, 'Same-origin request required')
  if (!/^Bearer [a-f0-9]{64}$/.test(req.headers.get('authorization') ?? '')) return failure(401, 'Order authorization required')
  const ip = clientIp(req)
  if (rateLimit(req, req.method === 'POST' ? 'automatic-proxy-write' : 'automatic-proxy-read', req.method === 'POST' ? 10 : 600) !== null)
    return failure(429, 'Too many order requests')
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = req.body?.getReader()
    if (reader)
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.length
        if (size > 4096) {
          await reader.cancel()
          return failure(413, 'Request body too large')
        }
        chunks.push(next.value)
      }
    const body = Buffer.concat(chunks)
    const upstreamHeaders: Record<string, string> = {
      authorization: req.headers.get('authorization')!,
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin'
    }
    if (ip) upstreamHeaders['cf-connecting-ip'] = ip
    const path = `/orders${id ? `/${id}` : ''}`
    const upstream = process.env.AUTO_BRIDGE_UPSTREAM ? new URL(process.env.AUTO_BRIDGE_UPSTREAM) : undefined
    if (upstream && (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash))
      return failure(503, 'Automatic bridge transport is not configured')
    const serviceToken = process.env.AUTO_BRIDGE_SERVICE_TOKEN
    if ((upstream && !serviceToken) || (serviceToken && !/^[A-Za-z0-9_-]{32,128}$/.test(serviceToken)))
      return failure(503, 'Automatic bridge transport is not configured')
    if (serviceToken) {
      upstreamHeaders['x-cashbridge-service-auth'] = serviceToken
    }
    if (upstream) {
      upstream.pathname = upstream.pathname.replace(/\/$/, '') + path
    }
    const response = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      const options = {
          ...(upstream ? { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined, path: upstream.pathname } : {
          socketPath: process.env.AUTO_BRIDGE_SOCKET ?? '/run/cashbridge/worker.sock',
          path
          }),
          method: req.method,
          headers: upstreamHeaders,
          timeout: 25000
        }
      const call = (upstream ? secureRequest : request)(options,
        incoming => {
          const result: Buffer[] = []
          let length = 0
          incoming.on('data', (chunk: Buffer) => {
            length += chunk.length
            if (length > 65536) call.destroy(new Error('Order response exceeded limit'))
            else result.push(chunk)
          })
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 503, body: Buffer.concat(result) }))
          incoming.on('error', reject)
        }
      )
      call.on('timeout', () => call.destroy(new Error('Worker response timed out')))
      call.on('error', reject)
      call.end(body)
    })
    return new NextResponse(response.body.toString('utf8'), { status: response.status, headers })
  } catch {
    return failure(503, 'Automatic bridge worker is unavailable')
  }
}
