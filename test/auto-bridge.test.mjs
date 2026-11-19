import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { binToHex, deriveHdPrivateNodeFromSeed, encodeHdPrivateKey, encodeTransaction, hexToBin } from '@bitauth/libauth'
import { orderUnlockBytes, PublicWallet, WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { orderBinding, REFUND_AFTER_SECONDS } from '../src/lib/router-contract.ts'
import { addressToLockingBytecode } from '../src/lib/bch.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { bestTrade, BroadcastRejected, checkPoolCovenants, poolLockingBytecode, reviewBuild, tradeTransaction } from '../src/lib/cauldron.ts'
import { BridgeConfig } from '../src/config.ts'
import { inboundHash, otherPubkey, outboundTx, pubkey } from './fixtures/bridge-fixtures.mjs'
import { processOrder } from '../src/server/auto-bridge/worker.ts'

const limits = { maxOrderSats: 100_000_000n, maxPendingSats: 1_000_000_000n, maxOpenOrders: 100 }
const recipient = bindingFromPubkey(pubkey, 0)
const refund = bindingFromPubkey(otherPubkey, 0)
const intent = { recipientAddress: recipient.tokenAddress, refundAddress: refund.cashAddress, expectedBchSats: '1000000' }
const wallet = () => new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
const capability = () => randomBytes(32).toString('hex')

test('one HD wallet yields distinct per-order addresses and a matching watch-only view', () => {
  const signer = wallet()
  const observer = new PublicWallet(signer.xpub)
  assert.deepEqual(observer.binding(0), signer.binding(0))
  assert.notEqual(observer.binding(0).cashAddress, observer.binding(1).cashAddress)
  assert.throws(() => observer.binding(-1))
  assert.throws(() => observer.binding(2 ** 31))
})

test('durable orders allocate unique addresses, preserve immutable intent and authenticate status after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-auto-'))
  const path = join(directory, 'orders.sqlite')
  const signer = wallet()
  const id = randomUUID(),
    token = capability()
  try {
    const store = new OrderStore(path, signer.xpub, limits)
    const first = store.create(id, token, intent, '1200', 100)
    const again = store.create(id, token, intent, '999999', 101)
    assert.equal(again.id, first.id)
    assert.equal(again.minPusd, '1200')
    assert.throws(() => store.create(id, token, { ...intent, refundAddress: recipient.cashAddress }, '1200', 102))
    assert.throws(() => store.public(id, capability()))
    assert.equal(store.public(id, token).depositAddress, first.binding.cashAddress)
    const second = store.create(randomUUID(), capability(), intent, '1200', 103)
    assert.notEqual(second.binding.cashAddress, first.binding.cashAddress)
    store.close()
    const reopened = new OrderStore(path, signer.xpub, limits)
    assert.equal(reopened.public(id, token).minPusd, '1200')
    assert.notEqual(reopened.create(randomUUID(), capability(), intent, '1200', 104).binding.cashAddress, first.binding.cashAddress)
    reopened.close()
    assert.throws(() => new OrderStore(path, wallet().xpub, limits))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('customer payouts cannot point to any previously allocated service deposit script', () => {
  const signer = wallet(), store = new OrderStore(':memory:', signer.xpub, limits)
  try {
    const first = store.create(randomUUID(), capability(), intent, '200')
    for (const field of ['recipientAddress', 'refundAddress']) {
      for (const address of [first.binding.cashAddress, first.binding.tokenAddress]) {
        assert.throws(() => store.create(randomUUID(), capability(), { ...intent, [field]: address }, '200'), error => error.status === 400)
      }
    }
    assert.equal(store.create(randomUUID(), capability(), intent, '200').addressIndex, 1, 'a rejected recipient never allocates another address')
  } finally { store.close() }
})

test('creation enforces amount limits and competing updates cannot overwrite newer state', () => {
  const signer = wallet()
  const store = new OrderStore(':memory:', signer.xpub, limits)
  try {
    assert.throws(() => store.create(randomUUID(), capability(), { ...intent, expectedBchSats: '100000001' }, '1'))
    assert.throws(() => store.create(randomUUID(), capability(), { ...intent, recipientAddress: 'invalid' }, '1'))
    const order = store.create(randomUUID(), capability(), intent, '1200')
    assert.equal(store.update(order.id, order.version, { state: 'streaming' }), true)
    assert.equal(store.update(order.id, order.version, { state: 'ready' }), false)
    assert.equal(store.get(order.id).state, 'streaming')
  } finally {
    store.close()
  }
})

const localBuild = (order, sellSats = 990000n) => {
  const withdraw = new Uint8Array(20).fill(7)
  const pool = {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdraw },
    outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
    output: { locking_bytecode: poolLockingBytecode(withdraw), token: { amount: 30000n, token_id: BridgeConfig.pusd.category }, amount: 108000000n }
  }
  const trade = bestTrade([pool], sellSats)
  const buildIntent = {
    category: BridgeConfig.pusd.category,
    side: 'buy',
    funding: order.funding,
    lockingBytecode: order.binding.lockingBytecode,
    tokenAddress: order.recipientAddress,
    cashAddress: order.refundAddress,
    payout: { tokenScript: order.recipientScript, changeScript: order.refundScript },
    sell: sellSats,
    minOutput: BigInt(order.minPusd),
    ownUnlockBytes: orderUnlockBytes(order)
  }
  return { build: tradeTransaction(trade, buildIntent), intent: buildIntent }
}

test('real Cauldron trade pays PUSD and BCH change directly to different customer scripts and the server signs it', () => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, limits)
  try {
    const order = store.create(randomUUID(), capability(), intent, '200')
    order.funding = [{ txid: 'ee'.repeat(32), vout: 0, value: '1000000', confirmations: 1, unspent: true }]
    const { build, intent: buildIntent } = localBuild(order)
    const reviewed = reviewBuild(build, buildIntent)
    checkPoolCovenants(reviewed)
    const tx = decodeTx(build.unsigned_tx_hex)
    assert.equal(tx.outputs.filter(o => o.token && binToHex(o.lockingBytecode) === order.recipientScript).length, 1)
    assert.ok(tx.outputs.some(o => !o.token && binToHex(o.lockingBytecode) === order.refundScript))
    assert.ok(!tx.outputs.some(o => binToHex(o.lockingBytecode) === order.binding.lockingBytecode))
    const signed = signer.signSwap(order, build, buildIntent.sell)
    assert.equal(signed.txid, txidOf(signed.hex))
    assert.ok(BigInt(signed.pusdOut) >= BigInt(order.minPusd))
    tx.outputs.find(o => o.token && binToHex(o.lockingBytecode) === order.recipientScript).lockingBytecode = hexToBin(order.binding.lockingBytecode)
    assert.throws(() => signer.signSwap(order, { ...build, unsigned_tx_hex: binToHex(encodeTransaction(tx)) }, buildIntent.sell))
  } finally {
    store.close()
  }
})

test('refund signs only verified order BCH to the immutable fallback and persists before any broadcast', () => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, limits)
  try {
    const order = store.create(randomUUID(), capability(), intent, '200')
    order.funding = [{ txid: 'ee'.repeat(32), vout: 0, value: '1000000', confirmations: 1, unspent: true }]
    const attempt = signer.signRefund(order)
    const tx = decodeTx(attempt.hex)
    assert.equal(tx.outputs.length, 1)
    assert.equal(binToHex(tx.outputs[0].lockingBytecode), order.refundScript)
    assert.ok(tx.outputs[0].valueSatoshis > 999000n)
    assert.equal(store.saveAttempt(order, attempt), true)
    assert.equal(store.saveAttempt(order, attempt), false)
    assert.equal(store.attempts(order.id).length, 1)
  } finally {
    store.close()
  }
})

const environment = (path = ':memory:', contractOrders = false) => {
  const signer = wallet(),
    store = new OrderStore(path, signer.xpub, limits, undefined, undefined, contractOrders)
  const order = store.create(randomUUID(), capability(), intent, '200', 100)
  const hex = outboundTx({ to: hexToBin(order.binding.lockingBytecode), amount: 1000000n })
  const outid = txidOf(hex),
    raw = new Map([[outid, hex]]),
    observed = new Map()
  let finalized = true,
    broadcastError,
    builds = 0,
    broadcasts = 0,
    lostResponse = false
  const status = () => ({
    tx: { id: inboundHash, memo: `=:BCH.BCH:${order.binding.cashAddress}:0` },
    stages: { swap_finalised: { completed: finalized }, swap_status: { pending: !finalized } },
    planned_out_txs: [{ chain: 'BCH', to_address: order.binding.cashAddress, coin: { asset: 'BCH.BCH', amount: '1000000' }, refund: false }],
    out_txs: [
      { id: outid, chain: 'BCH', to_address: order.binding.cashAddress, coins: [{ asset: 'BCH.BCH', amount: '1000000' }], memo: `OUT:${inboundHash}` }
    ]
  })
  const gateway = {
    history: async () => [...raw.keys()],
    raw: async id => raw.get(id),
    tip: async () => 100,
    coin: async (id, vout) => {
      if (id === '08'.repeat(32) && vout === 0)
        return {
          output: {
            lockingBytecode: poolLockingBytecode(new Uint8Array(20).fill(7)),
            valueSatoshis: 108000000n,
            token: { category: hexToBin(BridgeConfig.pusd.category), amount: 30000n }
          },
          confirmations: 1
        }
      if (id !== outid || vout !== 0) return undefined
      return { output: decodeTx(hex).outputs[0], confirmations: 1 }
    },
    thorStatus: async () => status(),
    observe: async id => observed.get(id) ?? { seen: false, confirmations: 0 },
    broadcast: async attempt => {
      broadcasts++
      assert.ok(
        store.attempts(order.id).some(a => a.txid === attempt.txid),
        'signed bytes must be durable before broadcast'
      )
      if (broadcastError) throw broadcastError
      observed.set(attempt.txid, { seen: true, confirmations: 0 })
      if (lostResponse) throw new Error('Connection ended after acceptance')
    }
  }
  const build = async order => {
    builds++
    return localBuild(order)
  }
  const policy = { minConfirmations: 1, zeroConfMaxSats: 0n, maxWaitMs: 60000 }
  return {
    signer,
    store,
    order,
    gateway,
    policy,
    build,
    observed,
    raw,
    outid,
    hex,
    setFinalized: value => {
      finalized = value
    },
    setLostResponse: () => {
      lostResponse = true
    },
    counts: () => ({ builds, broadcasts }),
    setBroadcastError: value => {
      broadcastError = value
    }
  }
}

test('a contract order deposits into the contract of its own terms, which the browser can rebuild', () => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, true)
  try {
    const token = capability()
    const order = store.create(randomUUID(), token, intent, '200', 1_000_000)
    const view = store.public(order.id, token)
    assert.match(view.depositAddress, /^bitcoincash:p/)
    assert.deepEqual(view.contract, { routerKey: signer.binding(order.addressIndex).pubkey, refundAfter: 1000 + REFUND_AFTER_SECONDS })
    const terms = {
      ...view.contract,
      recipientScript: addressToLockingBytecode(view.recipientAddress),
      refundScript: addressToLockingBytecode(view.refundAddress),
      category: BridgeConfig.pusd.category,
      minPusd: view.minPusd
    }
    assert.equal(orderBinding(terms, 0).cashAddress, view.depositAddress)
    assert.notEqual(orderBinding({ ...terms, minPusd: '1' }, 0).cashAddress, view.depositAddress)
  } finally {
    store.close()
  }
})

test('an order for another Cauldron token keeps its category, and its contract buys that token', () => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, true)
  try {
    const token = capability(), category = 'ab'.repeat(32)
    const order = store.create(randomUUID(), token, { ...intent, category }, '200', 1_000_000)
    const view = store.public(order.id, token)
    assert.equal(view.category, category)
    const pusdToken = capability()
    assert.equal(store.public(store.create(randomUUID(), pusdToken, intent, '200', 1_000_000).id, pusdToken).category, undefined)
    const terms = { ...view.contract, recipientScript: addressToLockingBytecode(view.recipientAddress), refundScript: addressToLockingBytecode(view.refundAddress), category, minPusd: view.minPusd }
    assert.equal(orderBinding(terms, 0).cashAddress, view.depositAddress)
    assert.notEqual(orderBinding({ ...terms, category: BridgeConfig.pusd.category }, 0).cashAddress, view.depositAddress)
    assert.throws(() => store.create(randomUUID(), capability(), { ...intent, category: 'PUSD' }, '200', 1_000_000))
  } finally {
    store.close()
  }
})

test('the worker swaps a contract order to PUSD through the contract, and refunds every coin through it', async () => {
  const env = environment(':memory:', true)
  try {
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    const [attempt] = env.store.attempts(env.order.id)
    assert.equal(attempt.kind, 'swap')
    assert.equal(env.store.get(env.order.id).state, 'submitted')
    assert.ok(BigInt(attempt.pusdOut) >= 200n)
    const order = { ...env.store.get(env.order.id), funding: [0, 1].map(vout => ({ txid: 'ee'.repeat(32), vout, value: '500000', confirmations: 1, unspent: true })) }
    assert.throws(() => env.signer.signSwap(order, localBuild(order, 490000n).build, 490000n), /one coin/)
    const refund = decodeTx(env.signer.signRefund(order).hex)
    assert.equal(refund.outputs.length, 2)
    assert.ok(refund.outputs.every(o => binToHex(o.lockingBytecode) === order.refundScript && o.valueSatoshis > 497000n))
    assert.throws(() => env.signer.signRefund({ ...order, minPusd: '1' }), /signing intent/)
  } finally {
    env.store.close()
  }
})

test('worker recovers a closed-browser order from BCH history and waits until the stream finishes', async () => {
  const env = environment()
  try {
    env.setFinalized(false)
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    assert.equal(env.store.get(env.order.id).state, 'streaming')
    assert.equal(env.counts().builds, 0)
    env.setFinalized(true)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(env.store.attempts(env.order.id).length, 1)
    assert.equal(env.store.get(env.order.id).state, 'submitted')
    const attempt = env.store.attempts(env.order.id)[0]
    env.observed.set(attempt.txid, { seen: true, confirmations: 6 })
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 3000)
    assert.equal(env.store.get(env.order.id).state, 'completed')
    assert.equal(env.counts().builds, 1)
  } finally {
    env.store.close()
  }
})

test('a lost broadcast answer is reconciled after worker restart without another signature', async () => {
  const env = environment()
  try {
    env.setLostResponse()
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    assert.equal(env.store.attempts(env.order.id).length, 1)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(env.counts().builds, 1)
    assert.equal(env.counts().broadcasts, 1)
    assert.equal(env.store.get(env.order.id).state, 'submitted')
  } finally {
    env.store.close()
  }
})

test('a shallow payout reorg retains exposure and replays only the original transaction until finality', async () => {
  const env = environment()
  try {
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    const attempt = env.store.attempts(env.order.id)[0]
    env.observed.set(attempt.txid, { seen: true, confirmations: 1 })
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(env.store.get(env.order.id).state, 'submitted')
    assert.equal(env.store.active().length, 1)
    assert.equal(env.store.exposure(), 1000000n)
    env.observed.delete(attempt.txid)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 3000)
    assert.deepEqual(env.counts(), { builds: 1, broadcasts: 2 })
    assert.equal(env.store.attempts(env.order.id)[0].hex, attempt.hex)
    env.observed.set(attempt.txid, { seen: true, confirmations: 6 })
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 4000)
    assert.equal(env.store.get(env.order.id).state, 'completed')
    assert.equal(env.store.active().length, 0)
    assert.equal(env.store.exposure(), 0n)
    assert.equal(env.store.attempts(env.order.id).length, 1)
  } finally {
    env.store.close()
  }
})

test('a failed trade attempt logs its reason with the short order id', async t => {
  const env = environment(),
    lines = []
  t.mock.method(console, 'warn', line => lines.push(line))
  try {
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, async () => { throw new Error('No liquidity') }, () => 1000)
    assert.ok(lines.includes(`Order ${env.order.id.slice(0, 8)} trade attempt failed: No liquidity`), JSON.stringify(lines))
  } finally {
    env.store.close()
  }
})

test('worker refunds BCH after bounded liquidity failure and keeps the original PUSD minimum', async () => {
  const env = environment()
  try {
    const unavailable = async () => {
      throw new Error('No liquidity')
    }
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, unavailable, () => 1000)
    assert.equal(env.store.get(env.order.id).state, 'retrying')
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, unavailable, () => 62000)
    const attempt = env.store.attempts(env.order.id)[0]
    assert.equal(attempt.kind, 'refund')
    assert.equal(env.store.get(env.order.id).minPusd, '200')
    env.observed.set(attempt.txid, { seen: true, confirmations: 6 })
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, unavailable, () => 63000)
    assert.equal(env.store.get(env.order.id).state, 'refunded')
  } finally {
    env.store.close()
  }
})

test('unfunded admission reservations expire but their addresses stay watched; funded review cases retain exposure', () => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, { ...limits, maxOpenOrders: 1 })
  try {
    const first = store.create(randomUUID(), capability(), intent, '200', 100)
    assert.throws(() => store.create(randomUUID(), capability(), intent, '200', 101))
    store.create(randomUUID(), capability(), intent, '200', 31 * 60 * 1000)
    assert.equal(store.active().length, 2, 'late payments must remain discoverable')
    store.update(first.id, first.version, {
      state: 'manual_review',
      funding: [{ txid: 'aa'.repeat(32), vout: 0, value: '2000000', confirmations: 1, unspent: true }]
    })
    assert.equal(store.exposure(), 2000000n)
    assert.throws(() => store.create(randomUUID(), capability(), intent, '200', 32 * 60 * 1000))
  } finally {
    store.close()
  }
})

test('unknown broadcast stays unknown when later retries are rejected, and no replacement is signed', async () => {
  const env = environment()
  try {
    env.setBroadcastError(new Error('Unknown acceptance'))
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    env.setBroadcastError(new BroadcastRejected('Input conflict'))
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(env.store.attempts(env.order.id)[0].status, 'unknown')
    assert.equal(env.counts().builds, 1)
  } finally {
    env.store.close()
  }
})

test('a lost swap broadcast refused by every node three passes running is rejected and rebuilt', async () => {
  const env = environment()
  try {
    env.setBroadcastError(new Error('Unknown acceptance'))
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    env.setBroadcastError(new BroadcastRejected('min relay fee not met'))
    for (const [i, at] of [2000, 3000].entries()) {
      await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => at)
      assert.equal(env.store.attempts(env.order.id)[0].status, 'unknown', `refusal ${i + 1} is not final`)
    }
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 4000)
    assert.equal(env.store.attempts(env.order.id)[0].status, 'rejected')
    assert.equal(env.store.get(env.order.id).state, 'retrying')
    assert.equal(env.counts().builds, 1, 'the pass that rejects signs nothing new')
    env.setBroadcastError(undefined)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, async order => localBuild(order, 980000n), () => 5000)
    assert.equal(env.store.attempts(env.order.id).length, 2, 'a replacement spending the same funding is signed')
  } finally {
    env.store.close()
  }
})

test('a lost swap broadcast that nodes keep refusing goes to operator review at the deadline, not forever', async () => {
  const env = environment()
  try {
    env.setBroadcastError(new Error('Unknown acceptance'))
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    env.setBroadcastError(new BroadcastRejected('min relay fee not met'))
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(env.store.get(env.order.id).state, 'broadcasting', 'before the deadline the same bytes are resent')
    const deadline = env.store.get(env.order.id).deadline
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => deadline)
    const order = env.store.get(env.order.id)
    assert.equal(order.state, 'manual_review')
    assert.match(order.error, /operator/)
    assert.equal(env.counts().builds, 1, 'no replacement or fallback is signed over the unresolved swap')
    assert.equal(env.store.attempts(env.order.id).length, 1)
  } finally {
    env.store.close()
  }
})

test('an uncertain swap whose pool input went to another trade is rebuilt instead of resent forever', async () => {
  const env = environment()
  try {
    env.setBroadcastError(new Error('Unknown acceptance'))
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    const first = env.store.attempts(env.order.id)[0]
    assert.equal(first.status, 'unknown')
    const coin = env.gateway.coin
    env.gateway.coin = async (id, vout) => (id === '08'.repeat(32) ? undefined : coin(id, vout))
    env.setBroadcastError(new BroadcastRejected('Missing inputs'))
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(env.store.attempts(env.order.id)[0].status, 'rejected')
    assert.equal(env.store.get(env.order.id).state, 'retrying')
    assert.equal(env.counts().builds, 1, 'no replacement is signed in the pass that finds the conflict')
    env.gateway.coin = coin
    env.setBroadcastError(undefined)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, async order => localBuild(order, 980000n), () => 3000)
    const attempts = env.store.attempts(env.order.id)
    assert.equal(attempts.length, 2)
    assert.notEqual(attempts[1].txid, first.txid)
    assert.equal(env.store.get(env.order.id).state, 'submitted')
    assert.equal(env.store.get(env.order.id).payoutTxid, attempts[1].txid)
  } finally {
    env.store.close()
  }
})

test('a definitively rejected refund retries saved bytes after the node recovers', async () => {
  const env = environment()
  try {
    env.setBroadcastError(new BroadcastRejected('Temporary policy rejection'))
    await processOrder(env.store, env.gateway, env.signer, env.order, { ...env.policy, maxWaitMs: 0 }, env.build, () => 1000)
    const first = env.store.attempts(env.order.id)[0]
    assert.equal(first.kind, 'refund')
    env.setBroadcastError(undefined)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), { ...env.policy, maxWaitMs: 0 }, env.build, () => 2000)
    assert.equal(env.store.attempts(env.order.id).length, 1)
    assert.equal(env.store.get(env.order.id).state, 'submitted')
    assert.equal(env.store.get(env.order.id).payoutTxid, first.txid)
  } finally {
    env.store.close()
  }
})

test('a reorg during construction cannot bypass the confirmation policy', async () => {
  const env = environment()
  try {
    let reorg = false
    const original = env.gateway.coin
    env.gateway.coin = async (...args) => {
      const coin = await original(...args)
      return coin && args[0] === env.outid && reorg ? { ...coin, confirmations: 0 } : coin
    }
    const build = async order => {
      const result = await env.build(order)
      reorg = true
      return result
    }
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, build, () => 1000)
    assert.equal(env.store.attempts(env.order.id).length, 0)
  } finally {
    env.store.close()
  }
})

test('concurrent workers save and broadcast only one newly signed attempt', async () => {
  const env = environment()
  try {
    await Promise.all([
      processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000),
      processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    ])
    assert.equal(env.store.attempts(env.order.id).length, 1)
    assert.equal(env.counts().broadcasts, 1)
  } finally {
    env.store.close()
  }
})

test('all unique outbounds of a completed stream are aggregated once', async () => {
  const env = environment()
  try {
    const first = outboundTx({ to: hexToBin(env.order.binding.lockingBytecode), amount: 500000n })
    const second = outboundTx({ to: hexToBin(env.order.binding.lockingBytecode), amount: 600000n })
    env.raw.clear()
    env.raw.set(txidOf(first), first)
    env.raw.set(txidOf(second), second)
    const previous = await env.gateway.thorStatus(inboundHash)
    const out = (hex, value) => ({ ...previous.out_txs[0], id: txidOf(hex), coins: [{ asset: 'BCH.BCH', amount: value }] })
    env.gateway.thorStatus = async () => ({
      ...previous,
      out_txs: [out(first, '500000'), out(second, '600000')],
      planned_out_txs: [previous.planned_out_txs[0], previous.planned_out_txs[0]]
    })
    const original = env.gateway.coin
    env.gateway.coin = async (id, vout) =>
      env.raw.has(id) && vout === 0 ? { output: decodeTx(env.raw.get(id)).outputs[0], confirmations: 1 } : original(id, vout)
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    const order = env.store.get(env.order.id)
    assert.equal(order.funding.length, 2)
    assert.equal(
      order.funding.reduce((total, coin) => total + BigInt(coin.value), 0n),
      1100000n
    )
    assert.equal(env.store.attempts(order.id).length, 1)
  } finally {
    env.store.close()
  }
})

test('duplicate executed outbounds cannot satisfy two planned outputs', async () => {
  const env = environment()
  try {
    const status = await env.gateway.thorStatus(inboundHash)
    env.gateway.thorStatus = async () => ({
      ...status,
      out_txs: [status.out_txs[0], status.out_txs[0]],
      planned_out_txs: [status.planned_out_txs[0], status.planned_out_txs[0]]
    })
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    assert.equal(env.store.get(env.order.id).state, 'streaming')
    assert.equal(env.counts().builds, 0)
  } finally {
    env.store.close()
  }
})

test('a raw BCH REFUND cannot masquerade as an OUT even if the status response lists it', async () => {
  const env = environment()
  try {
    const wrong = outboundTx({ to: hexToBin(env.order.binding.lockingBytecode), amount: 1000000n, memo: `REFUND:${inboundHash}` })
    const id = txidOf(wrong),
      status = await env.gateway.thorStatus(inboundHash)
    env.raw.clear()
    env.raw.set(id, wrong)
    env.gateway.thorStatus = async () => ({ ...status, out_txs: [{ ...status.out_txs[0], id }] })
    env.store.update(env.order.id, env.order.version, { sourceHash: inboundHash.toLowerCase() })
    env.gateway.coin = async (txid, vout) => (txid === id && vout === 0 ? { output: decodeTx(wrong).outputs[0], confirmations: 1 } : undefined)
    await processOrder(env.store, env.gateway, env.signer, env.store.get(env.order.id), env.policy, env.build, () => 1000)
    assert.equal(env.store.get(env.order.id).state, 'manual_review')
    assert.equal(env.store.attempts(env.order.id).length, 0)
  } finally {
    env.store.close()
  }
})

test('signed transaction recovery survives a real database close and reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashbridge-restart-')),
    path = join(directory, 'orders.sqlite')
  const env = environment(path)
  let reopened
  try {
    env.setLostResponse()
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    const attempt = env.store.attempts(env.order.id)[0]
    env.store.close()
    reopened = new OrderStore(path, env.signer.xpub, limits)
    env.observed.set(attempt.txid, { seen: true, confirmations: 6 })
    await processOrder(reopened, env.gateway, env.signer, reopened.get(env.order.id), env.policy, env.build, () => 2000)
    assert.equal(reopened.get(env.order.id).state, 'completed')
    assert.equal(reopened.attempts(env.order.id).length, 1)
    assert.equal(env.counts().builds, 1)
  } finally {
    reopened?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('aggregate observed exposure includes recovery cases and redirects excess receipts to BCH fallback', async () => {
  const env = environment()
  try {
    env.store.limits.maxPendingSats = 100000000n
    const retained = env.store.create(randomUUID(), capability(), intent, '200', 101)
    env.store.update(retained.id, retained.version, {
      state: 'manual_review',
      funding: [{ txid: 'ff'.repeat(32), vout: 0, value: '99500000', confirmations: 1, unspent: true }]
    })
    await processOrder(env.store, env.gateway, env.signer, env.order, env.policy, env.build, () => 1000)
    assert.equal(env.store.attempts(env.order.id)[0].kind, 'refund')
    assert.equal(env.counts().builds, 0)
  } finally {
    env.store.close()
    limits.maxPendingSats = 1000000000n
  }
})

// A tiny fake chain for source attribution: each payment is a THORChain outbound to the order address.
const attribution = source => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, limits),
    cap = capability()
  const order = store.create(randomUUID(), cap, { ...intent, source }, '200', 100)
  const payments = new Map(),
    seen = new Map()
  const pay = (from, inbound, amount) => {
    const hex = outboundTx({ to: hexToBin(order.binding.lockingBytecode), amount: BigInt(amount), memo: `OUT:${inbound}` })
    payments.set(txidOf(hex), { from, inbound, hex, amount, spent: false })
    return txidOf(hex)
  }
  const gateway = {
    history: async () => [...payments.keys()],
    raw: async id => payments.get(id)?.hex,
    tip: async () => 100,
    coin: async (id, vout) =>
      vout === 0 && payments.has(id) && !payments.get(id).spent ? { output: decodeTx(payments.get(id).hex).outputs[0], confirmations: 1 } : undefined,
    thorStatus: async inbound => {
      const [id, payment] = [...payments].find(([, p]) => p.inbound.toLowerCase() === inbound.toLowerCase()) ?? []
      if (!payment) return undefined
      return {
        tx: { id: payment.inbound, chain: 'ETH', from_address: payment.from, coins: [{ asset: 'ETH.ETH', amount: '100000000' }], memo: `=:BCH.BCH:${order.binding.cashAddress}:0` },
        stages: { swap_finalised: { completed: true }, swap_status: { pending: false } },
        planned_out_txs: [{ chain: 'BCH', to_address: order.binding.cashAddress, coin: { asset: 'BCH.BCH', amount: payment.amount }, refund: false }],
        out_txs: [{ id, chain: 'BCH', to_address: order.binding.cashAddress, coins: [{ asset: 'BCH.BCH', amount: payment.amount }], memo: `OUT:${payment.inbound}` }]
      }
    },
    observe: async id => seen.get(id) ?? { seen: false, confirmations: 0 },
    broadcast: async attempt => {
      for (const input of decodeTx(attempt.hex).inputs) payments.get(binToHex(input.outpointTransactionHash)).spent = true
      seen.set(attempt.txid, { seen: true, confirmations: 6 })
    }
  }
  const policy = { minConfirmations: 1, zeroConfMaxSats: 0n, maxWaitMs: 60000 }
  const noTrade = async () => {
    throw new Error('Synthetic unavailable trade')
  }
  const run = at => processOrder(store, gateway, signer, store.get(order.id), policy, noTrade, () => at)
  return { store, order, cap, pay, run }
}

test('a known source settles only itself; another THORChain inbound to the address is kept for recovery', async () => {
  const user = '0x' + '11'.repeat(20),
    env = attribution({ chain: 'ETH', asset: 'ETH.ETH', amount: '1', address: user })
  const source = 'ab'.repeat(32)
  try {
    env.store.update(env.order.id, env.order.version, { sourceHash: source })
    // Someone else's finished swap reaches the address before the customer's own status is available.
    const other = env.pay('0x' + '22'.repeat(20), inboundHash, '10000')
    await env.run(1000)
    assert.equal(env.store.get(env.order.id).state, 'awaiting_deposit')
    assert.equal(env.store.get(env.order.id).inboundHash, undefined)
    assert.equal(env.store.public(env.order.id, env.cap).sourceHash, source)
    assert.equal(env.store.public(env.order.id, env.cap).recoverySats, '10000')
    const own = env.pay(user, source, '1000000')
    await env.run(2000)
    assert.equal(env.store.get(env.order.id).inboundHash, source)
    assert.deepEqual(env.store.get(env.order.id).funding.map(coin => coin.txid), [own])
    await env.run(70000)
    const [attempt] = env.store.attempts(env.order.id)
    assert.equal(attempt.kind, 'refund')
    assert.deepEqual(decodeTx(attempt.hex).inputs.map(input => binToHex(input.outpointTransactionHash)), [own])
    await env.run(70001)
    assert.equal(env.store.get(env.order.id).state, 'refunded')
    assert.equal(env.store.public(env.order.id, env.cap).sourceHash, source)
    assert.equal(env.store.public(env.order.id, env.cap).recoverySats, '10000')
    assert.ok(!decodeTx(attempt.hex).inputs.some(input => binToHex(input.outpointTransactionHash) === other))
  } finally {
    env.store.close()
  }
})

test('without a source hint only an inbound from the order sender, chain and asset is discovered', async () => {
  const user = '0xAbCd' + '11'.repeat(18),
    env = attribution({ chain: 'ETH', asset: 'ETH.ETH', amount: '1', address: user })
  try {
    env.pay('0x' + '22'.repeat(20), inboundHash, '10000')
    await env.run(1000)
    assert.equal(env.store.get(env.order.id).state, 'awaiting_deposit')
    assert.equal(env.store.get(env.order.id).inboundHash, undefined)
    // The customer's own inbound is found from its memo; the sender's case differs as on EVM.
    const own = env.pay(user.toLowerCase(), 'cd'.repeat(32), '1000000')
    await env.run(2000)
    assert.equal(env.store.get(env.order.id).inboundHash, 'cd'.repeat(32))
    assert.deepEqual(env.store.get(env.order.id).funding.map(coin => coin.txid), [own])
  } finally {
    env.store.close()
  }
})

// An order whose first leg goes through NEAR Intents: 1Click's status names the BCH payout, which pays the order address.
const nearEnvironment = (contractOrders = false) => {
  const signer = wallet(),
    store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, contractOrders, false, true)
  const order = store.create(randomUUID(), capability(), intent, '200', 100)
  const depositAddress = `0x${'12'.repeat(20)}`
  store.update(order.id, order.version, { nearDepositAddress: depositAddress })
  const payout = binToHex(
    encodeTransaction({
      version: 2,
      locktime: 0,
      inputs: [{ outpointTransactionHash: hexToBin('aa'.repeat(32)), outpointIndex: 0, sequenceNumber: 0xffffffff, unlockingBytecode: Uint8Array.from([0x00]) }],
      outputs: [{ lockingBytecode: hexToBin(order.binding.lockingBytecode), valueSatoshis: 1000000n }]
    })
  )
  const payoutId = txidOf(payout)
  const raw = new Map(),
    observed = new Map(),
    thorAsked = []
  let near = {
    status: 'PENDING_DEPOSIT',
    swapDetails: {},
    quoteResponse: {
      quoteRequest: { recipient: order.binding.cashAddress, destinationAsset: 'nep141:bch.omft.near', originAsset: 'nep141:base.omft.near' },
      quote: { depositAddress, minAmountOut: '990000' }
    }
  }
  const gateway = {
    history: async () => [...raw.keys()],
    raw: async id => raw.get(id),
    tip: async () => 100,
    coin: async (id, vout) => {
      if (id === '08'.repeat(32) && vout === 0)
        return {
          output: { lockingBytecode: poolLockingBytecode(new Uint8Array(20).fill(7)), valueSatoshis: 108000000n, token: { category: hexToBin(BridgeConfig.pusd.category), amount: 30000n } },
          confirmations: 1
        }
      return raw.has(id) && vout === 0 ? { output: decodeTx(raw.get(id)).outputs[0], confirmations: 1 } : undefined
    },
    thorStatus: async id => {
      thorAsked.push(id)
      return undefined
    },
    nearStatus: async address => (address === depositAddress ? near : undefined),
    observe: async id => observed.get(id) ?? { seen: false, confirmations: 0 },
    broadcast: async attempt => {
      observed.set(attempt.txid, { seen: true, confirmations: 0 })
    }
  }
  const policy = { minConfirmations: 1, zeroConfMaxSats: 0n, maxWaitMs: 60000 }
  return {
    store,
    order,
    raw,
    payout,
    payoutId,
    thorAsked,
    setNear: change => {
      near = change(near)
    },
    run: at => processOrder(store, gateway, signer, store.get(order.id), policy, async current => localBuild(current), () => at),
    state: () => store.get(order.id).state
  }
}

test('a NEAR Intents order is funded by the BCH payout its signed quote sends to the order address', async () => {
  const env = nearEnvironment()
  try {
    await env.run(1000)
    assert.equal(env.state(), 'awaiting_deposit')
    env.setNear(near => ({ ...near, status: 'PROCESSING' }))
    await env.run(2000)
    assert.equal(env.state(), 'streaming')
    env.setNear(near => ({ ...near, status: 'SUCCESS', swapDetails: { destinationChainTxHashes: [{ hash: env.payoutId }] } }))
    await env.run(3000)
    assert.equal(env.state(), 'streaming', 'a payout the BCH node does not have yet is waited for')
    env.raw.set(env.payoutId, env.payout)
    await env.run(4000)
    assert.equal(env.state(), 'submitted')
    assert.deepEqual(env.store.get(env.order.id).funding.map(coin => coin.txid), [env.payoutId])
    assert.equal(env.store.attempts(env.order.id)[0].kind, 'swap')
    assert.deepEqual(env.thorAsked, [], 'a NEAR Intents order never asks THORChain')
  } finally {
    env.store.close()
  }
})

test('a NEAR Intents quote paying elsewhere, a short payout or a refund never funds the order', async () => {
  const cases = [
    [near => ({ ...near, quoteResponse: { ...near.quoteResponse, quoteRequest: { ...near.quoteResponse.quoteRequest, recipient: refund.cashAddress } } }), 'manual_review'],
    [near => ({ ...near, quoteResponse: { ...near.quoteResponse, quote: { ...near.quoteResponse.quote, minAmountOut: '1000001' } } }), 'manual_review'],
    [near => ({ ...near, status: 'FAILED' }), 'manual_review'],
    [near => ({ ...near, status: 'REFUNDED', swapDetails: { refundedAmountFormatted: '5' } }), 'source_refunded']
  ]
  for (const [change, state] of cases) {
    const env = nearEnvironment()
    try {
      env.raw.set(env.payoutId, env.payout)
      env.setNear(near => change({ ...near, status: 'SUCCESS', swapDetails: { destinationChainTxHashes: [{ hash: env.payoutId }] } }))
      await env.run(1000)
      assert.equal(env.state(), state)
      assert.equal(env.store.attempts(env.order.id).length, 0)
      assert.deepEqual(env.store.get(env.order.id).funding, [])
      if (state === 'source_refunded')
        assert.deepEqual(env.store.get(env.order.id).sourceRefunds, [{ asset: 'nep141:base.omft.near', amount: '500000000', pending: false, evidence: 'near_intents' }])
    } finally {
      env.store.close()
    }
  }
})

test('a NEAR Intents payout to a contract order is swapped to PUSD through the contract', async () => {
  const env = nearEnvironment(true)
  try {
    assert.match(env.order.binding.cashAddress, /^bitcoincash:p/)
    env.raw.set(env.payoutId, env.payout)
    env.setNear(near => ({ ...near, status: 'SUCCESS', swapDetails: { destinationChainTxHashes: [{ hash: env.payoutId }] } }))
    await env.run(1000)
    const [attempt] = env.store.attempts(env.order.id)
    assert.equal(env.state(), 'submitted')
    assert.equal(attempt.kind, 'swap')
    assert.ok(BigInt(attempt.pusdOut) >= 200n)
    assert.ok(decodeTx(attempt.hex).inputs.some(input => binToHex(input.outpointTransactionHash) === env.payoutId))
  } finally {
    env.store.close()
  }
})
