import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'
import { controls } from './fixtures/network-tracker-mocks.mjs'

register('./fixtures/network-tracker-loader.mjs', import.meta.url)

test('free-pair completion requires a successful source receipt and the asked destination minimum', async () => {
  const { syncNetworkSwap } = await import('../src/lib/network-swap-tracker.ts').catch(() => ({}))
  assert.equal(typeof syncNetworkSwap, 'function', 'generic aggregator completion cannot settle a free-pair swap')
  const tx = {
    hash: 'sourcehash', addressTo: 'destination', assetFrom: { chain: 'ETH' },
    assetTo: { chain: 'BTC', identifier: 'BTC.BTC', decimals: 8 }, networkSwap: { minOutput: '10000' }
  }
  controls.payout = { hash: 'outbound', amount: '10000' }
  controls.source = 'pending'
  assert.notEqual((await syncNetworkSwap(tx)).status, 'completed')
  controls.source = 'failed'
  assert.equal((await syncNetworkSwap(tx)).status, 'failed')
  controls.source = 'completed'
  controls.payout = undefined
  assert.notEqual((await syncNetworkSwap(tx)).status, 'completed')
  controls.payout = { hash: 'outbound', amount: '9999' }
  assert.notEqual((await syncNetworkSwap(tx)).status, 'completed')
  controls.payout = { hash: 'outbound', amount: '10000' }
  const result = await syncNetworkSwap(tx)
  assert.equal(result.status, 'completed')
  assert.equal(result.amountTo, '0.0001')
  assert.equal(result.networkSwap.payout.hash, 'outbound')
  assert.deepEqual(controls.lookups.at(-1), { depositTxid: 'sourcehash', buyAsset: 'BTC.BTC', destination: 'destination' })
})

test('a NEAR Intents free pair settles on 1Click payouts the destination chain shows paying the minimum', async () => {
  const { syncNetworkSwap } = await import('../src/lib/network-swap-tracker.ts')
  const tx = {
    hash: 'sourcehash', addressTo: 'destination', assetFrom: { chain: 'ETH' },
    assetTo: { chain: 'BTC', identifier: 'BTC.BTC', decimals: 8 }, networkSwap: { minOutput: '10000', near: { depositAddress: '0xdeposit' } }
  }
  let status
  const original = globalThis.fetch
  globalThis.fetch = async input => {
    assert.match(String(input), /\/status\?depositAddress=0xdeposit$/)
    return Response.json(status)
  }
  try {
    status = { status: 'PROCESSING' }
    assert.equal((await syncNetworkSwap(tx)).status, 'pending')
    status = { status: 'REFUNDED', swapDetails: {} }
    assert.equal((await syncNetworkSwap(tx)).status, 'refunded')
    status = { status: 'FAILED' }
    assert.equal((await syncNetworkSwap(tx)).status, 'failed')
    status = { status: 'SUCCESS', swapDetails: { destinationChainTxHashes: [{ hash: 'out1' }] } }
    controls.payout = { hash: 'out1', amount: '9999' }
    assert.equal((await syncNetworkSwap(tx)).status, 'pending')
    controls.payout = { hash: 'out1', amount: '10000' }
    const done = await syncNetworkSwap(tx)
    assert.equal(done.status, 'completed')
    assert.equal(done.networkSwap.payout.hash, 'out1')
    assert.deepEqual(controls.byHash.at(-1), { chain: 'BTC', hash: 'out1', expect: { destination: 'destination', buyAsset: 'BTC.BTC' } })
  } finally {
    globalThis.fetch = original
  }
})
