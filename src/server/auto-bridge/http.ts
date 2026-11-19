import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { dirname, isAbsolute } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { attachSource, createOrder, getOrder, listOrders } from '@/server/auto-bridge/api'
import type { OrderStore } from '@/server/auto-bridge/store'
import type { InboundAddress } from '@/lib/thorchain-deposit'

export const socketPath = () => process.env.AUTO_BRIDGE_SOCKET ?? '/run/cashbridge/worker.sock'

export async function startOrderServer(
  store: OrderStore,
  quote: (amount: bigint, category: string, side?: 'buy' | 'sell') => Promise<{ output: bigint }>,
  path = socketPath(),
  inbound?: () => Promise<InboundAddress[]>
) {
  if (!isAbsolute(path)) throw new Error('Worker socket path must be absolute')
  mkdirSync(dirname(path), { recursive: true, mode: 0o750 })
  if (existsSync(path)) {
    if (!lstatSync(path).isSocket()) throw new Error('Worker socket path is occupied')
    await new Promise<void>((resolve, reject) => {
      const connection = createConnection(path)
      connection.once('connect', () => {
        connection.destroy()
        reject(new Error('Worker socket is already active'))
      })
      connection.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') {
          if (existsSync(path)) unlinkSync(path)
          resolve()
        } else reject(new Error('Worker socket is unavailable'))
      })
      connection.setTimeout(1000, () => {
        connection.destroy()
        reject(new Error('Worker socket probe timed out'))
      })
    })
  }
  const service = { store, quote, inbound }
  const server = createServer(async (incoming, outgoing) => {
    try {
      const serviceToken = process.env.AUTO_BRIDGE_SERVICE_TOKEN
      if (serviceToken) {
        const supplied = incoming.headers['x-cashbridge-service-auth']
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(serviceToken) || typeof supplied !== 'string' ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(serviceToken) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(serviceToken))) {
          outgoing.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'Service authorization required' }))
          return
        }
      }
      const method = incoming.method,
        path = incoming.url ?? ''
      const match = path.match(/^\/orders(?:\/([a-f0-9-]{36}))?$/)
      if (!match || !['GET', 'POST'].includes(method ?? '')) {
        outgoing.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of incoming) {
        length += chunk.length
        if (length > 4096) {
          outgoing.writeHead(413).end()
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const headers = new Headers()
      for (const name of ['authorization', 'content-type', 'sec-fetch-site', 'cf-connecting-ip', 'referer', 'host']) {
        const value = incoming.headers[name]
        if (typeof value === 'string') headers.set(name, value)
      }
      const req = new NextRequest(`http://localhost${path}`, { method, headers, ...(method === 'POST' && { body: Buffer.concat(chunks) }) })
      const response = match[1]
        ? method === 'GET'
          ? await getOrder(req, match[1], service)
          : await attachSource(req, match[1], service)
        : method === 'GET'
          ? await listOrders(req, service)
          : await createOrder(req, service)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Automatic bridge temporarily unavailable' }))
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  chmodSync(path, 0o660)
  return server
}
