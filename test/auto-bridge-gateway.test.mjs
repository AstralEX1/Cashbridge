import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BchGateway } from '../src/server/auto-bridge/gateway.ts'
import { loadConfig } from '../src/server/auto-bridge/config.ts'
import { BroadcastRejected, BroadcastUnknown } from '../src/lib/cauldron.ts'

test('an unsolicited NFT can be observed for custody without becoming a spendable native input', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ result: { value: 0.00000546, confirmations: 1,
    scriptPubKey: { hex: '51' }, tokenData: { category: 'ab'.repeat(32), amount: '0', nft: { capability: 'none', commitment: '' } } } })
  try {
    const coin = await new BchGateway().coin('cd'.repeat(32), 0)
    assert.equal(coin.output.valueSatoshis, 546n)
    assert.equal(coin.output.token.nft.capability, 'none')
  } finally { globalThis.fetch = originalFetch }
})

test('gateway retains uncertain primary acceptance even if its secondary broadcaster rejects', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-gateway-'))
  const credential = join(directory, 'rpc.credential')
  writeFileSync(credential, randomBytes(32).toString('hex'), { mode: 0o600 })
  const previousFile = process.env.BCHN_RPC_COOKIE_FILE,
    previousUrl = process.env.BCHN_RPC_URL,
    originalFetch = globalThis.fetch
  process.env.BCHN_RPC_COOKIE_FILE = credential
  process.env.BCHN_RPC_URL = 'http://127.0.0.1:8332'
  const attempt = { txid: '11'.repeat(32), hex: '00', kind: 'refund', pusdOut: '0', status: 'signed' }
  let primaryCode,
    sends = []
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    if (new URL(url).hostname === '127.0.0.1') {
      sends.push(body.params[0])
      if (primaryCode === undefined) throw new Error('synthetic lost response')
      return Response.json({ error: { code: primaryCode } }, { status: 500 })
    }
    sends.push(body.tx)
    return Response.json({ error: { code: 'REJECTED' } }, { status: 400 })
  }
  try {
    const gateway = new BchGateway()
    await assert.rejects(gateway.broadcast(attempt), BroadcastUnknown)
    assert.deepEqual(sends, [attempt.hex, attempt.hex])
    sends = []
    primaryCode = -28
    await assert.rejects(gateway.broadcast(attempt), BroadcastUnknown)
    assert.equal(sends.length, 2)
    sends = []
    primaryCode = -26
    await assert.rejects(gateway.broadcast(attempt), BroadcastRejected)
    assert.equal(sends.length, 1)
    primaryCode = -27
    await gateway.broadcast(attempt)
  } finally {
    globalThis.fetch = originalFetch
    if (previousFile === undefined) delete process.env.BCHN_RPC_COOKIE_FILE
    else process.env.BCHN_RPC_COOKIE_FILE = previousFile
    if (previousUrl === undefined) delete process.env.BCHN_RPC_URL
    else process.env.BCHN_RPC_URL = previousUrl
    rmSync(directory, { recursive: true, force: true })
  }
})

test('disabled or missing worker policy fails closed as service configuration errors', () => {
  const previous = ['AUTO_BRIDGE_ENABLED', 'AUTO_BRIDGE_MAX_ORDER_SATS', 'AUTO_BRIDGE_MAX_PENDING_SATS'].map(name => [name, process.env[name]])
  try {
    delete process.env.AUTO_BRIDGE_ENABLED
    assert.throws(loadConfig, error => error.status === 503)
    process.env.AUTO_BRIDGE_ENABLED = 'true'
    delete process.env.AUTO_BRIDGE_MAX_ORDER_SATS
    assert.throws(loadConfig, error => error.status === 503)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('hosted RPC reads its private configuration without exposing credentials and rejects wrong-chain or unsafe configuration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-rpc-'))
  const file = join(directory, 'rpc.json'),
    secret = randomBytes(32).toString('hex')
  const names = ['BCHN_RPC_CONFIG_FILE', 'BCHN_RPC_COOKIE_FILE', 'BCHN_RPC_URL']
  const previous = names.map(name => [name, process.env[name]])
  const originalFetch = globalThis.fetch
  writeFileSync(file, JSON.stringify({ url: 'https://rpc.example/private-endpoint', headers: { 'x-api-key': secret } }), { mode: 0o600 })
  process.env.BCHN_RPC_CONFIG_FILE = file
  // The private config takes precedence over legacy cookie configuration.
  process.env.BCHN_RPC_COOKIE_FILE = '/nonexistent/legacy-cookie'
  let chain = 'main',
    authorized = false
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error')
    authorized = options.headers['x-api-key'] === secret
    return Response.json({ result: { chain, initialblockdownload: false, blocks: 100, headers: 100 } })
  }
  try {
    const gateway = new BchGateway()
    await gateway.assertReady()
    assert.equal(authorized, true)
    chain = 'test'
    await assert.rejects(gateway.assertReady(), /mainnet/)
    chmodSync(file, 0o644)
    assert.throws(
      () => new BchGateway(),
      error => !error.message.includes(secret) && /configuration/.test(error.message)
    )
    chmodSync(file, 0o600)
    for (const config of [
      null,
      { url: 'http://rpc.example', headers: {} },
      { url: 'https://rpc.example', headers: { authorization: 123 } },
      { url: 'https://rpc.example', headers: {}, minIntervalMs: -1 }
    ]) {
      writeFileSync(file, JSON.stringify(config))
      assert.throws(() => new BchGateway(), /configuration/)
    }
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(directory, { recursive: true, force: true })
  }
})

test('hosted RPC failover preserves uncertain writes across backup rejections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-rpc-failover-'))
  const file = join(directory, 'rpc.json'),
    originalFetch = globalThis.fetch,
    previous = process.env.BCHN_RPC_CONFIG_FILE
  writeFileSync(
    file,
    JSON.stringify({
      rpcs: [
        { url: 'https://first.example', headers: {} },
        { url: 'https://second.example', headers: {} }
      ]
    }),
    { mode: 0o600 }
  )
  process.env.BCHN_RPC_CONFIG_FILE = file
  let secondaryAccepts = false,
    upstreamReadError = false
  const attempt = { txid: '11'.repeat(32), hex: '00', kind: 'refund', pusdOut: '0', status: 'signed' }
  globalThis.fetch = async (url, options) => {
    const host = new URL(url).host,
      payload = JSON.parse(options.body)
    if (host === 'first.example') {
      if (upstreamReadError && payload.method === 'getblockcount') return Response.json({ error: { code: -16503 } })
      throw new Error('synthetic lost response')
    }
    if (host === 'second.example') {
      if (payload.method === 'getblockcount') return Response.json({ result: 100 })
      return secondaryAccepts ? Response.json({ result: attempt.txid }) : Response.json({ error: { code: -26 } })
    }
    return Response.json({ error: { code: 'REJECTED' } })
  }
  try {
    const gateway = new BchGateway()
    assert.equal(await gateway.tip(), 100)
    upstreamReadError = true
    assert.equal(await gateway.tip(), 100)
    await assert.rejects(gateway.broadcast(attempt), BroadcastUnknown)
    secondaryAccepts = true
    await gateway.broadcast(attempt)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.BCHN_RPC_CONFIG_FILE
    else process.env.BCHN_RPC_CONFIG_FILE = previous
    rmSync(directory, { recursive: true, force: true })
  }
})

test('concurrent RPC reads reserve separate request slots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-rpc-pacing-'))
  const file = join(directory, 'rpc.json'),
    previous = process.env.BCHN_RPC_CONFIG_FILE,
    originalFetch = globalThis.fetch
  writeFileSync(file, JSON.stringify({ url: 'https://rpc.example', headers: {}, minIntervalMs: 40 }), { mode: 0o600 })
  process.env.BCHN_RPC_CONFIG_FILE = file
  const starts = []
  globalThis.fetch = async () => {
    starts.push(Date.now())
    return Response.json({ result: 100 })
  }
  try {
    const gateway = new BchGateway()
    assert.deepEqual(await Promise.all([gateway.tip(), gateway.tip(), gateway.tip()]), [100, 100, 100])
    assert.equal(starts.length, 3)
    assert.ok(starts[1] - starts[0] >= 30)
    assert.ok(starts[2] - starts[1] >= 30)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.BCHN_RPC_CONFIG_FILE
    else process.env.BCHN_RPC_CONFIG_FILE = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
