// The public MCP endpoint: batches are bounded, run a few at a time, and every tool call is charged.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NextRequest } from 'next/server.js'

let upstream = 0
let inFlight = 0
let peak = 0
globalThis.fetch = async () => {
  upstream++
  inFlight++
  peak = Math.max(peak, inFlight)
  await new Promise(r => setTimeout(r, 5))
  inFlight--
  return new Response(JSON.stringify({ expected_amount_out: '1' }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const { handleMcpPost } = await import('../src/lib/agent/mcp-server.ts')
const { ANONYMOUS_REQUEST_LIMIT, MAX_BATCH_CONCURRENCY, MAX_BATCH_LENGTH, MAX_REQUEST_BYTES } = await import('../src/lib/agent/mcp-tools.ts')

let client = 0
const post = (body, ip) =>
  handleMcpPost(
    new NextRequest('http://localhost:3000/mcp', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }
    })
  )
const quoteCall = id => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'get_swap_quote', arguments: { from_asset: 'BTC.BTC', to_asset: 'ETH.ETH', amount: '100000' } }
})
const batchOf = n => Array.from({ length: n }, (_, i) => quoteCall(i + 1))
const reset = () => {
  upstream = 0
  peak = 0
  return `10.0.0.${++client}`
}

test('one request with a 100-call batch reaches the upstream zero times', async () => {
  const ip = reset()
  const res = await post(batchOf(100), ip)
  const body = await res.json()
  assert.equal(body.error.code, -32600)
  assert.equal(upstream, 0)
})

test('a full batch runs a few calls at a time and answers every one, in order', async () => {
  const ip = reset()
  const res = await post(batchOf(MAX_BATCH_LENGTH), ip)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.length, MAX_BATCH_LENGTH)
  assert.deepEqual(body.map(r => r.id), batchOf(MAX_BATCH_LENGTH).map(m => m.id))
  assert.equal(upstream, MAX_BATCH_LENGTH)
  assert.ok(peak <= MAX_BATCH_CONCURRENCY, `peak concurrency ${peak}`)
})

test('every tool call in a batch is charged against the quota', async () => {
  const ip = reset()
  const batches = ANONYMOUS_REQUEST_LIMIT / MAX_BATCH_LENGTH
  for (let i = 0; i < batches; i++) assert.equal((await post(batchOf(MAX_BATCH_LENGTH), ip)).status, 200)
  assert.equal(upstream, ANONYMOUS_REQUEST_LIMIT)

  const res = await post(quoteCall(1), ip)
  assert.equal(res.status, 429)
  assert.ok(Number(res.headers.get('retry-after')) > 0)
  assert.equal(upstream, ANONYMOUS_REQUEST_LIMIT, 'nothing more reached the upstream')
})

test('a batch the remaining quota cannot cover is refused whole', async () => {
  const ip = reset()
  const single = ANONYMOUS_REQUEST_LIMIT - 5
  for (let i = 0; i < single; i++) await post(quoteCall(i), ip)
  upstream = 0
  const res = await post(batchOf(10), ip)
  assert.equal(res.status, 429)
  assert.equal(upstream, 0)
})

test('an oversized body is refused before it is parsed', async () => {
  const ip = reset()
  const huge = JSON.stringify({ ...quoteCall(1), pad: 'x'.repeat(MAX_REQUEST_BYTES) })
  const res = await post(huge, ip)
  assert.equal(res.status, 413)
  assert.equal(upstream, 0)
})

test('single calls and notification-only batches still behave as before', async () => {
  const ip = reset()
  const single = await post(quoteCall(7), ip)
  assert.equal(single.status, 200)
  assert.equal((await single.json()).id, 7)
  const notes = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' }], ip)
  assert.equal(notes.status, 202)
})
