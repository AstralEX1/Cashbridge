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
import { GET as scannerFeed } from '../src/app/api/scanner/route.ts'
import { isFeedOrder } from '../src/lib/auto-bridge-contract.ts'

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

test('the public scanner feed lists paid orders from the worker without addresses, ids or capabilities', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-feed-')),
    path = join(directory, 'worker.sock')
  const previous = process.env.AUTO_BRIDGE_SOCKET
  process.env.AUTO_BRIDGE_SOCKET = path
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const store = new OrderStore(':memory:', signer.xpub, { maxOrderSats: 100000000n, maxPendingSats: 1000000000n, maxOpenOrders: 20 })
  const server = await startOrderServer(store, async () => ({ output: 1000n }), path)
  const address = bindingFromPubkey(pubkey, 0).cashAddress
  const intent = { recipientAddress: address, refundAddress: address, expectedBchSats: '1000000' }
  const capability = randomBytes(32).toString('hex')
  try {
    const paid = store.create(randomUUID(), capability, intent, '980')
    store.create(randomUUID(), randomBytes(32).toString('hex'), intent, '980')
    store.update(paid.id, paid.version, {
      sourceHash: 'ab'.repeat(32),
      funding: [
        { txid: 'cd'.repeat(32), vout: 0, value: '600000', confirmations: 1, unspent: true },
        { txid: 'cd'.repeat(32), vout: 1, value: '400000', confirmations: 1, unspent: true }
      ]
    })
    const response = await scannerFeed()
    assert.equal(response.status, 200)
    const text = await response.text()
    const { orders } = JSON.parse(text)
    assert.equal(orders.length, 1, 'an order nobody paid into stays out of the feed')
    assert.equal(orders[0].sourceHash, 'ab'.repeat(32))
    assert.deepEqual(orders[0].bchReceipts, [{ txid: 'cd'.repeat(32), amountSats: '1000000' }])
    for (const secret of [address, address.split(':')[1], paid.id, capability, paid.binding.cashAddress]) assert.equal(text.includes(secret), false)
    assert.equal(isFeedOrder({ ...orders[0], sourceHash: 'javascript:alert(1)' }), false)
    assert.equal(isFeedOrder({ ...orders[0], bchReceipts: [{ txid: 'zz', amountSats: '1' }] }), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
    store.close()
    rmSync(directory, { recursive: true, force: true })
    if (previous === undefined) delete process.env.AUTO_BRIDGE_SOCKET
    else process.env.AUTO_BRIDGE_SOCKET = previous
  }
})

test('a NEAR Intents deposit address is noted once, before the source hash, only when the Router takes NEAR orders', async () => {
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const address = bindingFromPubkey(pubkey, 0).cashAddress
  const near = `0x${'12'.repeat(20)}`
  const request = (cap, body) =>
    new NextRequest('https://bridge.example/api/auto-bridge/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': `near-${randomUUID()}` },
      body: JSON.stringify(body)
    })
  const open = (nearOrders, contractOrders = false) => {
    const store = new OrderStore(':memory:', signer.xpub, { maxOrderSats: 100000000n, maxPendingSats: 1000000000n, maxOpenOrders: 20 }, undefined, undefined, contractOrders, false, nearOrders)
    const cap = randomBytes(32).toString('hex')
    const order = store.create(randomUUID(), cap, { recipientAddress: address, refundAddress: address, expectedBchSats: '1000000' }, '980')
    return { store, cap, id: order.id, service: { store, quote: async () => ({ output: 1000n }) } }
  }
  const off = open(false)
  const contract = open(true, true)
  const on = open(true)
  try {
    assert.equal((await attachSource(request(off.cap, { nearDepositAddress: near }), off.id, off.service)).status, 400)
    assert.equal((await attachSource(request(contract.cap, { nearDepositAddress: near }), contract.id, contract.service)).status, 409)
    assert.equal((await attachSource(request(on.cap, { nearDepositAddress: 'not an address' }), on.id, on.service)).status, 400)
    const noted = await attachSource(request(on.cap, { nearDepositAddress: near }), on.id, on.service)
    assert.equal(noted.status, 200)
    assert.equal((await noted.json()).nearDepositAddress, near)
    assert.equal((await attachSource(request(on.cap, { nearDepositAddress: `0x${'34'.repeat(20)}` }), on.id, on.service)).status, 409)
    assert.equal((await attachSource(request(on.cap, { nearDepositAddress: near, sourceHash: 'ab'.repeat(32) }), on.id, on.service)).status, 200)
    assert.equal(on.store.get(on.id).sourceHash, 'ab'.repeat(32))
    assert.equal(on.store.get(on.id).nearDepositAddress, near)
  } finally {
    off.store.close()
    contract.store.close()
    on.store.close()
  }
})
