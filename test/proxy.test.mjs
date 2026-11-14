// The aggregator proxy against a local stand-in upstream: the key is added server-side, never
// echoed back, and only the allowlisted calls get through.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { NextRequest } from 'next/server.js'

const KEY = 'sentinel-key-do-not-ship-7f3a'
const seen = []
const upstream = createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-echo-key', String(req.headers['x-api-key'])) // a careless upstream
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
