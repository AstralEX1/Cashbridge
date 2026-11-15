// The aggregator proxy against a local stand-in upstream: the key is added server-side, never
// echoed back, and only the allowlisted calls get through.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { NextRequest } from 'next/server.js'

const KEY = 'sentinel-key-do-not-ship-7f3a'
const seen = []
const upstreamStatuses = []
const upstream = createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-echo-key', String(req.headers['x-api-key'])) // a careless upstream
    res.statusCode = upstreamStatuses.shift() ?? 200
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
})

let route
before(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r))
  process.env.THORCHAIN_API_KEY = KEY
  process.env.THORCHAIN_API_URL = `http://127.0.0.1:${upstream.address().port}/v1`
  route = await import('../src/app/api/thorchain/[...path]/route.ts')
})
after(() => upstream.close())

const call = (method, path, { query = '', body, headers = {} } = {}) => {
  const req = new NextRequest(`http://localhost:3000/api/thorchain/${path.join('/')}${query}`, {
    method,
    body,
    headers: { 'sec-fetch-site': 'same-origin', host: 'localhost:3000', ...headers }
  })
  return route[method](req, { params: Promise.resolve({ path }) })
}

test('an allowed call reaches the upstream with the key; the response carries no key', async () => {
  seen.length = 0
  const res = await call('POST', ['v1', 'quote'], { body: JSON.stringify({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH' }), headers: { 'x-api-key': 'browser-supplied', cookie: 'a=b' } })
  assert.equal(res.status, 200)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, '/v1/quote')
  assert.equal(seen[0].headers['x-api-key'], KEY, 'the server key, not the browser one')
  assert.equal(seen[0].headers.cookie, undefined)
  const text = await res.text()
  assert.ok(!text.includes(KEY))
  assert.equal(res.headers.get('x-echo-key'), null)
  for (const [, v] of res.headers) assert.ok(!v.includes(KEY))
})

test('a quote retries one transient gateway response before returning it to the browser', async () => {
  seen.length = 0
  upstreamStatuses.push(502, 200)
  const res = await call('POST', ['v1', 'quote'], { body: JSON.stringify({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH' }) })
  assert.equal(res.status, 200)
  assert.equal(seen.length, 2)
})

test('a persistent quote gateway failure is returned after one retry', async () => {
  seen.length = 0
  upstreamStatuses.push(502, 502)
  const res = await call('POST', ['v1', 'quote'], { body: JSON.stringify({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH' }) })
  assert.equal(res.status, 502)
  assert.equal(seen.length, 2)
})

test('only allowlisted query parameters are forwarded', async () => {
  seen.length = 0
  assert.equal((await call('GET', ['v1', 'tokens'], { query: '?provider=THORCHAIN' })).status, 200)
  assert.equal(seen[0].url, '/v1/tokens?provider=THORCHAIN')
  assert.equal((await call('GET', ['v1', 'tokens'], { query: '?provider=A&provider=B' })).status, 404)
  assert.equal((await call('GET', ['v1', 'tokens'], { query: '?url=http://evil' })).status, 404)
  assert.equal(seen.length, 1)
})

test('unknown paths, traversal, other versions and methods are refused without contacting upstream', async () => {
  seen.length = 0
  for (const path of [['v1', 'admin'], ['v1', '..', 'v2', 'quote'], ['v1', 'quote%2F..%2Fadmin'], ['v1', 'a/b'], ['v2', 'quote'], ['v1'], ['v1', 'https:', '', 'evil.example']]) {
    assert.equal((await call('GET', path)).status, 404, path.join('/'))
    assert.equal((await call('POST', path, { body: '{}' })).status, 404, path.join('/'))
  }
  assert.equal((await call('GET', ['v1', 'quote'])).status, 404, 'quote is POST only')
  assert.equal((await route.DELETE(new NextRequest('http://localhost:3000/api/thorchain/v1/quote', { method: 'DELETE' }))).status, 405)
  assert.equal(seen.length, 0)
})

test('cross-origin, oversized and non-JSON requests are refused', async () => {
  seen.length = 0
  assert.equal((await call('POST', ['v1', 'quote'], { body: '{}', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await call('POST', ['v1', 'quote'], { body: 'not json' })).status, 400)
  assert.equal((await call('POST', ['v1', 'quote'], { body: JSON.stringify({ x: 'a'.repeat(20_000) }) })).status, 413)
  assert.equal(seen.length, 0)
})

test('without a configured key the proxy fails closed', async () => {
  delete process.env.THORCHAIN_API_KEY
  seen.length = 0
  const res = await call('POST', ['v1', 'quote'], { body: '{}' })
  assert.equal(res.status, 500)
  assert.equal(seen.length, 0)
  process.env.THORCHAIN_API_KEY = KEY
})

test('on Vercel a caller-supplied cf-connecting-ip does not pick its own rate-limit bucket', async () => {
  const { clientIp } = await import('../src/lib/rate-limit.ts')
  const request = headers => new NextRequest('http://localhost/api/x', { headers })
  const previous = process.env.VERCEL
  process.env.VERCEL = '1'
  try {
    assert.equal(clientIp(request({ 'cf-connecting-ip': '6.6.6.6', 'x-vercel-forwarded-for': '1.2.3.4' })), '1.2.3.4')
    assert.equal(clientIp(request({ 'cf-connecting-ip': '6.6.6.6', 'x-real-ip': '1.2.3.4' })), '1.2.3.4')
    assert.equal(clientIp(request({ 'cf-connecting-ip': '6.6.6.6' })), 'unknown')
  } finally {
    if (previous === undefined) delete process.env.VERCEL
    else process.env.VERCEL = previous
  }
  assert.equal(clientIp(request({ 'cf-connecting-ip': '6.6.6.6', 'x-forwarded-for': '9.9.9.9, 1.2.3.4' })), '6.6.6.6')
})


test('the body limit counts UTF-8 bytes and cancels oversized streams before buffering the rest', async () => {
  seen.length = 0
  assert.equal((await call('POST', ['v1', 'quote'], { body: JSON.stringify({ x: '€'.repeat(6000) }) })).status, 413)
  let reads = 0, cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      reads++
      if (reads === 1) controller.enqueue(new Uint8Array(17000).fill(32))
      else controller.error(new Error('The oversized remainder must never be read'))
    },
    cancel() { cancelled = true }
  }, { highWaterMark: 0 })
  const req = new NextRequest('http://localhost:3000/api/thorchain/v1/quote', {
    method: 'POST', body, duplex: 'half', headers: { 'sec-fetch-site': 'same-origin' }
  })
  const response = await route.POST(req, { params: Promise.resolve({ path: ['v1', 'quote'] }) })
  assert.equal(response.status, 413)
  assert.equal(reads, 1)
  assert.equal(cancelled, true)
  assert.equal(seen.length, 0)
})


test('bounded request bodies accept exact UTF-8 limits and report interrupted reads without forwarding', async () => {
  const { readRequestBody } = await import('../src/lib/request-body.ts')
  const request = body => new Request('http://localhost', { method: 'POST', body, duplex: 'half' })
  assert.equal(await readRequestBody(request('€'), 3), '€')
  assert.equal(await readRequestBody(request(undefined), 3), '')
  const broken = new ReadableStream({ start(controller) { controller.error(new Error('synthetic stream failure')) } })
  const response = await readRequestBody(request(broken), 3)
  assert.equal(response.status, 400)
  assert.ok(!(await response.text()).includes('synthetic stream failure'))
})

test('Solana and Blockchair reject oversized streams and preserve valid POST bodies', async () => {
  const originalFetch = globalThis.fetch, previousKey = process.env.BLOCKCHAIR_API_KEY
  process.env.BLOCKCHAIR_API_KEY = KEY
  const solana = await import('../src/app/api/solana/route.ts')
  const blockchair = await import('../src/app/api/blockchair/[...path]/route.ts')
  const sent = []
  globalThis.fetch = async (_url, options) => { sent.push(options); return Response.json({ ok: true }) }
  try {
    for (const [handler, limit, path] of [[solana.POST, 100000, undefined], [blockchair.POST, 2 * 1024 * 1024, ['bitcoin', 'push', 'transaction']]]) {
      let reads = 0, cancelled = false
      const body = new ReadableStream({
        pull(controller) {
          reads++
          if (reads === 1) controller.enqueue(new Uint8Array(limit + 1))
          else controller.error(new Error('Must stop at the limit'))
        },
        cancel() { cancelled = true }
      }, { highWaterMark: 0 })
      const init = { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }
      const context = { params: Promise.resolve({ path }) }
      const rejected = await handler(new NextRequest('http://localhost/api/proxy', { ...init, body, duplex: 'half' }), context)
      assert.equal(rejected.status, 413)
      assert.equal(reads, 1)
      assert.equal(cancelled, true)
      const payload = JSON.stringify(path ? { data: '00' } : { jsonrpc: '2.0', id: 1, method: 'getBlockHeight' })
      assert.equal((await handler(new NextRequest('http://localhost/api/proxy', { ...init, body: payload }), context)).status, 200)
      assert.equal(sent.at(-1).body, payload)
      assert.equal(sent.at(-1).method, 'POST')
    }
    assert.equal(sent.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) delete process.env.BLOCKCHAIR_API_KEY
    else process.env.BLOCKCHAIR_API_KEY = previousKey
  }
})

test('Blockchair refuses cross-origin requests before reading their bodies', async () => {
  const { POST } = await import('../src/app/api/blockchair/[...path]/route.ts')
  let reads = 0
  const body = new ReadableStream({ pull(controller) { reads++; controller.error(new Error('The forbidden body must not be read')) } }, { highWaterMark: 0 })
  const req = new NextRequest('http://localhost/api/blockchair/bitcoin/push/transaction', {
    method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body, duplex: 'half'
  })
  assert.equal((await POST(req, { params: Promise.resolve({ path: ['bitcoin', 'push', 'transaction'] }) })).status, 403)
  assert.equal(reads, 0)
})
