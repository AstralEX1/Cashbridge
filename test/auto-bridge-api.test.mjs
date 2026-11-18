import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { deriveHdPrivateNodeFromSeed, encodeHdPrivateKey } from '@bitauth/libauth'
import { WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { createOrder, getOrder, attachSource } from '../src/server/auto-bridge/api.ts'
import { bindingFromPubkey } from '../src/lib/bch.ts'
import { pubkey } from './fixtures/bridge-fixtures.mjs'
import { startOrderServer } from '../src/server/auto-bridge/http.ts'
import { POST as publicCreate } from '../src/app/api/auto-bridge/orders/route.ts'
import { GET as publicStatus } from '../src/app/api/auto-bridge/orders/[id]/route.ts'

test('order API fixes the minimum before signing, authenticates status and rejects altered recipients', async () => {
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const store = new OrderStore(':memory:', signer.xpub, { maxOrderSats: 100000000n, maxPendingSats: 1000000000n, maxOpenOrders: 20 })
  const id = randomUUID(),
    cap = randomBytes(32).toString('hex'),
    address = bindingFromPubkey(pubkey, 0).cashAddress
  const intent = { id, recipientAddress: address, refundAddress: address, expectedBchSats: '1000000' }
  const request = (body, token = cap, method = 'POST') =>
    new NextRequest('https://bridge.example/api/auto-bridge/orders', {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': 'api-test'
      },
      ...(method !== 'GET' && { body: JSON.stringify(body) })
    })
  let quotes = 0
  const service = {
    store,
    quote: async () => {
      quotes++
      return { output: 1000n }
    }
  }
  try {
    const created = await createOrder(request(intent), service)
    assert.equal(created.status, 201)
    const first = await created.json()
    assert.equal(first.minPusd, '980')
    assert.equal((await createOrder(request(intent), service)).status, 200)
    assert.equal(quotes, 1)
    assert.equal((await createOrder(request({ ...intent, refundAddress: 'invalid' }), service)).status, 400)
    assert.equal((await getOrder(request(undefined, randomBytes(32).toString('hex'), 'GET'), id, service)).status, 404)
    assert.equal((await getOrder(request(undefined, cap, 'GET'), id, service)).status, 200)
    assert.equal((await attachSource(request({ sourceHash: '0x' + 'ab'.repeat(32) }), id, service)).status, 200)
    assert.equal(store.get(id).sourceHash, 'ab'.repeat(32))
    assert.equal((await attachSource(request({ sourceHash: 'cd'.repeat(32) }), id, service)).status, 409)
    assert.equal(
      (await createOrder(new NextRequest('https://bridge.example/api/auto-bridge/orders', { method: 'POST', body: JSON.stringify(intent) }), service))
        .status,
      403
    )
    assert.equal((await createOrder(request({ ...intent, id: randomUUID(), expectedBchSats: '1e6' }), service)).status, 400)
  } finally {
    store.close()
  }
})

test('public Next routes reach the private worker socket and cannot mutate order recipients', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-socket-')),
    path = join(directory, 'worker.sock')
  const previous = process.env.AUTO_BRIDGE_SOCKET
  process.env.AUTO_BRIDGE_SOCKET = path
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const store = new OrderStore(':memory:', signer.xpub, { maxOrderSats: 100000000n, maxPendingSats: 1000000000n, maxOpenOrders: 20 })
  const server = await startOrderServer(store, async () => ({ output: 1000n }), path)
  const id = randomUUID(),
    capability = randomBytes(32).toString('hex'),
    address = bindingFromPubkey(pubkey, 0).cashAddress
  const input = { id, recipientAddress: address, refundAddress: address, expectedBchSats: '1000000' }
  const headers = {
    Authorization: `Bearer ${capability}`,
    'Content-Type': 'application/json',
    'sec-fetch-site': 'same-origin',
    'cf-connecting-ip': 'socket-test'
  }
  try {
    const created = await publicCreate(
      new NextRequest('https://bridge.example/api/auto-bridge/orders', { method: 'POST', headers, body: JSON.stringify(input) })
    )
    assert.equal(created.status, 201)
    const result = await created.json()
    assert.equal(result.minPusd, '980')
    assert.equal(JSON.stringify(result).includes(capability), false)
    assert.equal(Object.hasOwn(result, 'binding'), false)
    const restored = await publicStatus(new NextRequest(`https://bridge.example/api/auto-bridge/orders/${id}`, { headers }), {
      params: Promise.resolve({ id })
    })
    assert.equal(restored.status, 200)
    assert.equal((await restored.json()).depositAddress, result.depositAddress)
    const changed = await publicCreate(
      new NextRequest('https://bridge.example/api/auto-bridge/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...input, expectedBchSats: '2000000' })
      })
    )
    assert.equal(changed.status, 409)
    await assert.rejects(
      startOrderServer(store, async () => ({ output: 1n }), path),
      /already active/
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
    store.close()
    rmSync(directory, { recursive: true, force: true })
    if (previous === undefined) delete process.env.AUTO_BRIDGE_SOCKET
    else process.env.AUTO_BRIDGE_SOCKET = previous
  }
})
