// The live Rostrum pool feed: snapshot, updates, reconnects and server fallback, against a scripted server.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PoolFeed, parseRostrumPool } from '../src/lib/cauldron-rostrum.ts'

const CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544'
const OTHER = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366'
const hex = (char, length) => char.repeat(length)

const raw = (n, over = {}) => ({
  token_id: CATEGORY,
  pkh: hex('a', 40),
  new_utxo_hash: `hash-${n}`,
  new_utxo_txid: hex(String(n % 10), 64),
  new_utxo_n: 1,
  sats: 5_000_000 + n,
  token_amount: 100_000 + n,
  is_withdrawn: false,
  spent_utxo_hash: '',
  ...over
})

// A scripted Rostrum server: `pools` is what it lists on subscribe; `push` sends an update.
const server = ({ pools = [], failOpen = false } = {}) => {
  const log = { urls: [], requests: [] }
  const sockets = []
  const factory = (url, hooks) => {
    log.urls.push(url)
    const socket = {
      hooks,
      closed: false,
      open: async () => {
        if (failOpen === true || (Array.isArray(failOpen) && failOpen.includes(url))) throw new Error('refused')
      },
      request: async (method, params) => {
        log.requests.push({ method, params })
        if (socket.closed) throw new Error('Connection closed')
        if (method === 'server.version') return ['Rostrum', '1.4.3']
        if (method === 'cauldron.contract.subscribe') return { utxos: pools }
        throw new Error(`unexpected ${method}`)
      },
      close: () => {
        if (socket.closed) return
        socket.closed = true
        hooks.onClose()
      }
    }
    sockets.push(socket)
    return socket
  }
  const push = (utxos, socket = sockets.at(-1)) => socket.hooks.onNotification('cauldron.contract.subscribe', { type: 'update', utxos })
  return { factory, log, sockets, push }
}

test('the snapshot lists the usable pools, and unusable entries are left out', async () => {
  const s = server({
    pools: [raw(1), raw(2), raw(3, { is_withdrawn: true }), raw(4, { pkh: 'nothex' }), raw(5, { sats: 0 }), raw(6, { token_id: 'x' }), raw(7, { sats: 2 ** 60 }), raw(8, { sats: '5000008', token_amount: '100008' })]
  })
  const feed = new PoolFeed(['wss://one'], s.factory)
  const pools = await feed.pools(CATEGORY)
  assert.deepEqual(pools.map(p => p.sats).sort(), [5_000_001, 5_000_002, 5_000_008].sort())
  assert.deepEqual(s.log.requests.at(-1), { method: 'cauldron.contract.subscribe', params: [2, CATEGORY] })
  assert.deepEqual(s.log.requests[0], { method: 'server.version', params: ['cash-bridge', '1.4.3'] })
  feed.close()
})

test('an update replaces a spent pool with its successor and removes a withdrawn one', async () => {
  const s = server({ pools: [raw(1), raw(2)] })
  const feed = new PoolFeed(['wss://one'], s.factory)
  assert.equal((await feed.pools(CATEGORY)).length, 2)
  // Pool 1 was traded: pool 11 takes its place.
  s.push([raw(11, { spent_utxo_hash: 'hash-1' })])
  let pools = await feed.pools(CATEGORY)
  assert.deepEqual(pools.map(p => p.sats).sort(), [5_000_002, 5_000_011])
  // Pool 2 was withdrawn: its entry is not a pool, but it names what it spent.
  s.push([raw(12, { is_withdrawn: true, spent_utxo_hash: 'hash-2' })])
  pools = await feed.pools(CATEGORY)
  assert.deepEqual(pools.map(p => p.sats), [5_000_011])
  // One batch can chain trades: the successor of a successor.
  s.push([raw(13, { spent_utxo_hash: 'hash-11' }), raw(14, { spent_utxo_hash: 'hash-13' })])
  assert.deepEqual((await feed.pools(CATEGORY)).map(p => p.sats), [5_000_014])
  assert.equal(s.log.requests.filter(r => r.method === 'cauldron.contract.subscribe').length, 1, 'one subscription serves every later read')
  feed.close()
})

test('updates for another token or malformed updates change nothing', async () => {
  const s = server({ pools: [raw(1)] })
  const feed = new PoolFeed(['wss://one'], s.factory)
  await feed.pools(CATEGORY)
  s.push([raw(20, { token_id: OTHER, spent_utxo_hash: 'hash-1' })])
  s.sockets[0].hooks.onNotification('cauldron.contract.subscribe', [2, CATEGORY, { utxos: [] }])
  s.sockets[0].hooks.onNotification('blockchain.headers.subscribe', { type: 'update', utxos: [raw(21, { spent_utxo_hash: 'hash-1' })] })
  s.sockets[0].hooks.onNotification('cauldron.contract.subscribe', { type: 'update', utxos: 'nope' })
  assert.deepEqual((await feed.pools(CATEGORY)).map(p => p.sats), [5_000_001])
  feed.close()
})

test('a closed connection is replaced and the token subscribed afresh', async () => {
  const s = server({ pools: [raw(1)] })
  const feed = new PoolFeed(['wss://one'], s.factory)
  await feed.pools(CATEGORY)
  s.sockets[0].close()
  await feed.pools(CATEGORY)
  assert.equal(s.sockets.length, 2)
  assert.equal(s.log.requests.filter(r => r.method === 'cauldron.contract.subscribe').length, 2)
  feed.close()
})

test('the next server answers when the first is unreachable, and an error rejects when none is', async () => {
  const s = server({ pools: [raw(1)], failOpen: ['wss://one'] })
  const feed = new PoolFeed(['wss://one', 'wss://two'], s.factory)
  assert.equal((await feed.pools(CATEGORY)).length, 1)
  assert.deepEqual(s.log.urls, ['wss://one', 'wss://two'])
  feed.close()

  const down = server({ failOpen: true })
  const none = new PoolFeed(['wss://one', 'wss://two'], down.factory)
  await assert.rejects(none.pools(CATEGORY), /refused/)
  assert.equal(none.enabled, true)
  await assert.rejects(new PoolFeed([], down.factory).pools(CATEGORY), /No Rostrum server/)
  await assert.rejects(none.pools('not-a-category'), /Not a token category/)
})

test('concurrent readers share one connection and one subscription', async () => {
  const s = server({ pools: [raw(1)] })
  const feed = new PoolFeed(['wss://one'], s.factory)
  const [a, b, c] = await Promise.all([feed.pools(CATEGORY), feed.pools(CATEGORY), feed.pools(CATEGORY)])
  assert.equal(a.length + b.length + c.length, 3)
  assert.equal(s.sockets.length, 1)
  assert.equal(s.log.requests.filter(r => r.method === 'cauldron.contract.subscribe').length, 1)
  feed.close()
})

test('a pool the chain shows spent is forgotten until the server says otherwise', async () => {
  const s = server({ pools: [raw(1), raw(2)] })
  const feed = new PoolFeed(['wss://one'], s.factory)
  const [first] = await feed.pools(CATEGORY)
  feed.forget(CATEGORY, first.txid, first.vout)
  assert.equal((await feed.pools(CATEGORY)).length, 1)
  feed.forget(OTHER, first.txid, first.vout)
  feed.close()
})

test('an idle connection is closed and the next read opens a new one', async () => {
  const s = server({ pools: [raw(1)] })
  const feed = new PoolFeed(['wss://one'], s.factory, { idleMs: 20 })
  await feed.pools(CATEGORY)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(s.sockets[0].closed, true)
  await feed.pools(CATEGORY)
  assert.equal(s.sockets.length, 2)
  feed.close()
})

test('parseRostrumPool keeps the keys a later update names', () => {
  const parsed = parseRostrumPool(raw(5, { spent_utxo_hash: 'hash-4' }))
  assert.equal(parsed.key, 'hash-5')
  assert.equal(parsed.spentKey, 'hash-4')
  assert.equal(parsed.pool.vout, 1)
  assert.equal(parseRostrumPool(null), undefined)
  assert.equal(parseRostrumPool(raw(5, { new_utxo_txid: 'short' })), undefined)
})

test('WsRpc hands server notifications and the close to its listeners', async () => {
  const { WsRpc } = await import('../src/lib/bch.ts')
  const real = globalThis.WebSocket
  let socket
  globalThis.WebSocket = class {
    static OPEN = 1
    readyState = 1
    sent = []
    constructor() {
      socket = this
      queueMicrotask(() => this.onopen())
    }
    send(data) {
      this.sent.push(JSON.parse(data))
    }
    close() {
      this.onclose()
    }
  }
  try {
    const seen = []
    let closed = 0
    const rpc = new WsRpc('wss://rostrum.test:443', { jsonrpc: true, onNotification: (method, params) => seen.push([method, params]), onClose: () => closed++ })
    await rpc.open()
    const answer = rpc.request('server.version', ['x', '1.4'])
    socket.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method: 'cauldron.contract.subscribe', params: { type: 'update', utxos: [] } }) })
    socket.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', id: socket.sent[0].id, result: ['Rostrum', '1.4.3'] }) })
    assert.deepEqual(await answer, ['Rostrum', '1.4.3'])
    assert.deepEqual(seen, [['cauldron.contract.subscribe', { type: 'update', utxos: [] }]])
    rpc.close()
    assert.equal(closed, 1)
  } finally {
    globalThis.WebSocket = real
  }
})
