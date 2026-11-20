import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { NextRequest } from 'next/server.js'
import { GET } from '../src/app/api/ipfs/[...path]/route.ts'

const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })
const cid = 'Qm' + 'a'.repeat(44)
const call = (path = [cid], headers = {}) => GET(new NextRequest(`http://localhost/api/ipfs/${path.join('/')}`, {
  headers: { 'sec-fetch-site': 'same-origin', ...headers }
}), { params: Promise.resolve({ path }) })

test('untrusted SVG remains an image and cannot script or access this origin when opened', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>'
  globalThis.fetch = async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
  const response = await call()
  assert.equal(response.status, 200)
  assert.equal(await response.text(), svg)
  const policy = response.headers.get('content-security-policy') ?? ''
  assert.match(policy, /(?:^|;)\s*sandbox\s*(?:;|$)/)
  assert.match(policy, /default-src 'none'/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('oversized icon streams are cancelled before the entire file is buffered', async () => {
  let pulls = 0, cancellations = 0
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      pulls++
      controller.enqueue(new Uint8Array(128 * 1024))
      if (pulls % 50 === 0) controller.close()
    },
    cancel() { cancellations++ }
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } })
  assert.equal((await call()).status, 502)
  assert.equal(cancellations, 3, 'each fallback must stop its oversized stream')
  assert.ok(pulls <= 15, `downloaded ${pulls} chunks despite the 512-KiB limit`)
})

test('a broken upstream body falls back to the next gateway', async () => {
  let calls = 0
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  globalThis.fetch = async () => ++calls === 1
    ? new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection reset')) } }))
    : new Response(png, { headers: { 'content-type': 'application/octet-stream' } })
  const response = await call()
  assert.equal(response.status, 200)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png)
  assert.equal(response.headers.get('content-type'), 'image/png')
})

test('cross-origin and traversal requests never contact an IPFS gateway', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected upstream') }
  assert.equal((await call([cid], { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await call([cid, '..', 'x'])).status, 400)
  assert.equal((await call([cid, 'x/y'])).status, 400)
  assert.equal(calls, 0)
})

test('gateway reads cannot bypass stream limits through Next cache buffering or redirects', async () => {
  globalThis.fetch = async (_, options) => {
    assert.equal(options.cache, 'no-store')
    assert.equal(options.redirect, 'error')
    return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'content-type': 'image/svg+xml' } })
  }
  assert.equal((await call()).status, 200)
})
