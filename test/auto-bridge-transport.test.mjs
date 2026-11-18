import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:https'
import { createServer as createHttpServer, request } from 'node:http'
import { NextRequest } from 'next/server.js'
import { deriveHdPrivateNodeFromSeed, encodeHdPrivateKey } from '@bitauth/libauth'
import { WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { startOrderServer } from '../src/server/auto-bridge/http.ts'
import { bindingFromPubkey } from '../src/lib/bch.ts'
import { pubkey } from './fixtures/bridge-fixtures.mjs'

test('Vercel proxy reaches the authenticated worker through verified HTTPS and preserves the order contract', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-tls-'))
  const socket = join(directory, 'worker.sock'), key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem')
  const oldToken = process.env.AUTO_BRIDGE_SERVICE_TOKEN
  const serviceToken = randomBytes(32).toString('base64url')
  process.env.AUTO_BRIDGE_SERVICE_TOKEN = serviceToken
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const store = new OrderStore(':memory:', signer.xpub, { maxOrderSats: 10000000n, maxPendingSats: 100000000n, maxOpenOrders: 20 })
  let worker, tls
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' })
    worker = await startOrderServer(store, async () => ({ output: 1000n }), socket)
    const seen = []
    tls = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
      seen.push({ path: incoming.url, authorized: incoming.headers['x-cashbridge-service-auth'] === serviceToken,
        ip: incoming.headers['cf-connecting-ip'], leaked: !!incoming.headers.cookie })
      const upstream = request({ socketPath: socket, path: incoming.url, method: incoming.method, headers: incoming.headers }, response => {
        outgoing.writeHead(response.statusCode, response.headers)
        response.pipe(outgoing)
      })
      upstream.on('error', () => outgoing.writeHead(503).end())
      incoming.pipe(upstream)
    })
    await new Promise(resolve => tls.listen(0, 'localhost', resolve))
    const input = { id: randomUUID(), recipientAddress: bindingFromPubkey(pubkey, 0).cashAddress,
      refundAddress: bindingFromPubkey(pubkey, 0).cashAddress, expectedBchSats: '1000000' }
    const capability = randomBytes(32).toString('hex')
    const script = `
      import { NextRequest } from 'next/server.js';
      import { forwardOrder } from './src/server/auto-bridge/proxy.ts';
      const input = JSON.parse(process.env.TEST_ORDER);
      const headers = { authorization: 'Bearer ' + process.env.TEST_CAPABILITY, 'content-type': 'application/json',
        'sec-fetch-site': 'same-origin', 'x-vercel-forwarded-for': '192.0.2.10', 'cf-connecting-ip': 'spoofed', cookie: 'private=not-forwarded' };
      const create = await forwardOrder(new NextRequest('https://bridge.example/api/auto-bridge/orders', { method: 'POST', headers, body: JSON.stringify(input) }));
      const created = await create.json();
      const get = await forwardOrder(new NextRequest('https://bridge.example/api/auto-bridge/orders/' + input.id, { headers }), input.id);
      process.env.AUTO_BRIDGE_SERVICE_TOKEN = 'incorrect_service_token_for_fixture_only';
      const denied = await forwardOrder(new NextRequest('https://bridge.example/api/auto-bridge/orders/' + input.id, { headers }), input.id);
      process.stdout.write(JSON.stringify({ create: create.status, get: get.status, denied: denied.status,
        min: created.minPusd, noStore: create.headers.get('cache-control'), private: 'binding' in created || 'capability' in created }));
    `
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--no-warnings', '--import', './test/register-ts-alias.mjs', '--input-type=module', '-e', script], {
        env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: cert, VERCEL: '1', AUTO_BRIDGE_UPSTREAM: `https://localhost:${tls.address().port}`,
          AUTO_BRIDGE_SERVICE_TOKEN: serviceToken, TEST_ORDER: JSON.stringify(input), TEST_CAPABILITY: capability }
      })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.resume()
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error('Synthetic HTTPS proxy child failed')))
    })
    assert.deepEqual(result, { create: 201, get: 200, denied: 401, min: '980', noStore: 'no-store', private: false })
    assert.ok(seen.slice(0, 2).every(row => row.authorized && row.ip === '192.0.2.10' && !row.leaked))
    assert.ok(seen.every(row => !row.path.includes(capability)))
  } finally {
    if (tls) await new Promise(resolve => tls.close(resolve))
    if (worker) await new Promise(resolve => worker.close(resolve))
    store.close()
    if (oldToken === undefined) delete process.env.AUTO_BRIDGE_SERVICE_TOKEN; else process.env.AUTO_BRIDGE_SERVICE_TOKEN = oldToken
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a worker that accepts the request but never answers ends in a JSON 503 at the proxy deadline', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-hang-'))
  const socket = join(directory, 'worker.sock')
  const hung = createHttpServer(() => {})
  await new Promise(resolve => hung.listen(socket, resolve))
  const saved = { socket: process.env.AUTO_BRIDGE_SOCKET, upstream: process.env.AUTO_BRIDGE_UPSTREAM, token: process.env.AUTO_BRIDGE_SERVICE_TOKEN }
  process.env.AUTO_BRIDGE_SOCKET = socket
  delete process.env.AUTO_BRIDGE_UPSTREAM
  delete process.env.AUTO_BRIDGE_SERVICE_TOKEN
  const deadlines = []
  // Stand-in for the real 12 s wait: the deadline asked for is recorded, a short one is used.
  t.mock.method(AbortSignal, 'timeout', ms => {
    deadlines.push(ms)
    const abort = new AbortController()
    setTimeout(() => abort.abort(new DOMException('timed out', 'TimeoutError')), 200)
    return abort.signal
  })
  try {
    const { forwardOrder } = await import('../src/server/auto-bridge/proxy.ts')
    const id = randomUUID()
    const response = await forwardOrder(new NextRequest(`https://bridge.example/api/auto-bridge/orders/${id}`, {
      headers: { authorization: `Bearer ${randomBytes(32).toString('hex')}` }
    }), id)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Cashbridge Router is unavailable' })
    assert.deepEqual(deadlines, [12000])
  } finally {
    await new Promise(resolve => { hung.closeAllConnections(); hung.close(resolve) })
    for (const [key, value] of [['AUTO_BRIDGE_SOCKET', saved.socket], ['AUTO_BRIDGE_UPSTREAM', saved.upstream], ['AUTO_BRIDGE_SERVICE_TOKEN', saved.token]])
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    rmSync(directory, { recursive: true, force: true })
  }
})
