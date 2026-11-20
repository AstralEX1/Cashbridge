import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  binToHex,
  createVirtualMachineBch2026,
  deriveHdPrivateNodeFromSeed,
  encodeHdPrivateKey,
  encodeTransaction,
  generatePrivateKey,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1
} from '@bitauth/libauth'
import { orderUnlockBytes, termsOf, WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { orderRedeemScript, orderUnlock } from '../src/lib/router-contract.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, reviewBuild, sourcesOf, tradeTransaction } from '../src/lib/cauldron.ts'
import { BridgeConfig } from '../src/config.ts'
import { inboundHash, otherPubkey, outboundTx, pubkey } from './fixtures/bridge-fixtures.mjs'
import { PAGE_FIRST_MS, processOrder } from '../src/server/auto-bridge/worker.ts'

const limits = { maxOrderSats: 100_000_000n, maxPendingSats: 1_000_000_000n, maxOpenOrders: 100 }
const recipient = bindingFromPubkey(pubkey, 0)
const refund = bindingFromPubkey(otherPubkey, 0)
const intent = { recipientAddress: recipient.tokenAddress, refundAddress: refund.cashAddress, expectedBchSats: '1000000' }
const policy = { minConfirmations: 0, zeroConfMaxSats: 100_000_000n, maxWaitMs: 60000 }
const pool = {
  version: '0',
  parameters: { withdraw_pubkey_hash: new Uint8Array(20).fill(7) },
  outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
  output: { locking_bytecode: poolLockingBytecode(new Uint8Array(20).fill(7)), token: { amount: 30000n, token_id: BridgeConfig.pusd.category }, amount: 108000000n }
}
const tradeOf = order => {
  // The real builder sells all of it; this local one leaves the miner fee and change room.
  const sell = order.funding.reduce((sum, coin) => sum + BigInt(coin.value), 0n) - 10000n
  const buildIntent = {
    category: BridgeConfig.pusd.category,
    side: 'buy',
    funding: order.funding,
    lockingBytecode: order.binding.lockingBytecode,
    tokenAddress: order.recipientAddress,
    cashAddress: order.refundAddress,
    payout: { tokenScript: order.recipientScript, changeScript: order.refundScript },
    sell,
    minOutput: 1n,
    ownUnlockBytes: orderUnlockBytes(order)
  }
  return { build: tradeTransaction(bestTrade([pool], sell), buildIntent), intent: buildIntent }
}

// One forward contract order and a BCH node that holds whatever the test puts in `raw` (mempool included).
const setup = ({ page = false, near = false, minPusd = '200' } = {}) => {
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, true, false, true, false, true)
  const pageKey = generatePrivateKey()
  const capability = randomBytes(32).toString('hex')
  const order = store.create(randomUUID(), capability, { ...intent, ...(page && { pageKey: binToHex(secp256k1.derivePublicKeyCompressed(pageKey)) }) }, minPusd, 100)
  if (near) store.update(order.id, order.version, { nearDepositAddress: `0x${'12'.repeat(20)}` })
  const raw = new Map(),
    spent = new Set(),
    observed = new Map(),
    asked = { thor: 0, near: 0 },
    builds = []
  const gateway = {
    history: async () => [...raw.keys()],
    raw: async id => raw.get(id),
    tip: async () => 100,
    coin: async (id, vout) => {
      if (id === '08'.repeat(32) && vout === 0)
        return { output: { lockingBytecode: pool.output.locking_bytecode, valueSatoshis: 108000000n, token: { category: hexToBin(BridgeConfig.pusd.category), amount: 30000n } }, confirmations: 1 }
      const hex = raw.get(id)
      return hex && !spent.has(`${id}:${vout}`) && decodeTx(hex).outputs[vout] ? { output: decodeTx(hex).outputs[vout], confirmations: 0 } : undefined
    },
    // THORChain and 1Click still call the swap unfinished: the contract does not wait for them.
    thorStatus: async () => {
      asked.thor++
      return { tx: { id: inboundHash }, stages: { swap_finalised: { completed: false }, swap_status: { pending: true } }, out_txs: [] }
    },
    nearStatus: async () => {
      asked.near++
      return { status: 'PROCESSING', swapDetails: {}, quoteResponse: { quoteRequest: { recipient: order.binding.cashAddress, destinationAsset: 'nep141:bch.omft.near' }, quote: { depositAddress: `0x${'12'.repeat(20)}`, minAmountOut: '990000' } } }
    },
    observe: async id => observed.get(id) ?? { seen: false, confirmations: 0 },
    broadcast: async attempt => observed.set(attempt.txid, { seen: true, confirmations: 0 })
  }
  // The bridge's payout lands in the mempool.
  const land = (amount = 1000000n) => {
    const hex = outboundTx({ to: hexToBin(order.binding.lockingBytecode), amount, ...(near && { memo: 'near' }) })
    raw.set(txidOf(hex), hex)
    return txidOf(hex)
  }
  // What the customer's page signs with its own key and sends, as the browser does.
  const pageConvert = () => {
    const current = store.get(order.id)
    const { build, intent: buildIntent } = tradeOf(current)
    const reviewed = reviewBuild(build, buildIntent)
    const transaction = decodeTx(reviewed.unsignedHex)
    const sourceOutputs = sourcesOf(reviewed)
    const terms = termsOf(current, current.binding.pubkey)
    for (const i of reviewed.ownIndexes) {
      const preimage = generateSigningSerializationBch({ inputIndex: i, sourceOutputs, transaction }, { coveredBytecode: orderRedeemScript(terms), signingSerializationType: Uint8Array.of(0x61) })
      const signature = Uint8Array.from([...secp256k1.signMessageHashSchnorr(pageKey, hash256(preimage)), 0x61])
      transaction.inputs[i].unlockingBytecode = orderUnlock(terms, 'convert', signature, terms.pageKey)
    }
    assert.equal(createVirtualMachineBch2026(true).verify({ transaction, sourceOutputs }), true, 'the page key alone settles the contract')
    const hex = binToHex(encodeTransaction(transaction))
    for (const input of transaction.inputs) spent.add(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)
    raw.set(txidOf(hex), hex)
    observed.set(txidOf(hex), { seen: true, confirmations: 0 })
    return { txid: txidOf(hex), pusdOut: reviewed.output }
  }
  return {
    store,
    order,
    raw,
    observed,
    view: () => store.public(order.id, capability),
    asked,
    builds,
    land,
    pageConvert,
    run: at =>
      processOrder(store, gateway, signer, store.get(order.id), policy, async current => (builds.push(current.funding), tradeOf({ ...current, minPusd: current.minPusd })), () => at),
    get: () => store.get(order.id),
    attempts: () => store.attempts(order.id)
  }
}

test('a contract order swaps the moment its THORChain BCH reaches the mempool, before THORChain calls the swap done', async () => {
  const env = setup()
  try {
    await env.run(1000)
    assert.equal(env.get().state, 'awaiting_deposit', 'no coin yet: THORChain status still drives the order')
    const coin = env.land()
    await env.run(2000)
    const [attempt] = env.attempts()
    assert.equal(env.get().state, 'submitted')
    assert.equal(attempt.kind, 'swap')
    assert.ok(decodeTx(attempt.hex).inputs.some(input => binToHex(input.outpointTransactionHash) === coin))
    assert.equal(env.get().inboundHash, inboundHash.toLowerCase(), 'the OUT memo still names the THORChain inbound for the scanner')
  } finally {
    env.store.close()
  }
})

test('a NEAR Intents or ShapeShift contract order swaps the moment its BCH lands, while 1Click still says processing', async () => {
  const env = setup({ near: true })
  try {
    await env.run(1000)
    assert.equal(env.get().state, 'streaming')
    env.land()
    await env.run(2000)
    assert.equal(env.get().state, 'submitted')
    assert.equal(env.attempts()[0].kind, 'swap')
    assert.equal(env.asked.thor, 0, 'a NEAR Intents order never asks THORChain')
  } finally {
    env.store.close()
  }
})

test('a version 2 coin under the quote still buys the token at its share of the minimum', async () => {
  const env = setup()
  try {
    const full = tradeOf({ ...env.get(), funding: [{ txid: 'ee'.repeat(32), vout: 0, value: '1000000', confirmations: 0, unspent: true }] })
    const env2 = setup({ minPusd: reviewBuild(full.build, full.intent).output.toString() })
    try {
      assert.equal(env2.get().contract.version, 2)
      env2.land(970000n)
      await env2.run(1000)
      assert.equal(env2.get().state, 'submitted')
      assert.equal(env2.attempts()[0].kind, 'swap', 'a short coin is swapped, not sent back')
    } finally {
      env2.store.close()
    }
  } finally {
    env.store.close()
  }
})

test('the page settles first; the Router steps in only after the page had its turn', async () => {
  const env = setup({ page: true })
  try {
    env.land()
    await env.run(1000)
    assert.equal(env.get().state, 'ready')
    assert.equal(env.attempts().length, 0, 'the Router leaves the coin to the page at first')
    await env.run(1000 + PAGE_FIRST_MS)
    assert.equal(env.get().state, 'submitted', 'a closed page does not strand the order')
    assert.equal(env.attempts()[0].kind, 'swap')
  } finally {
    env.store.close()
  }
})

test("the page's own settlement becomes the order's payout, and the Router signs nothing", async () => {
  const env = setup({ page: true })
  try {
    env.land()
    await env.run(1000)
    const paid = env.pageConvert()
    await env.run(3000)
    const order = env.get()
    assert.equal(order.state, 'submitted')
    assert.equal(order.payoutTxid, paid.txid)
    assert.deepEqual(env.attempts().map(a => [a.txid, a.kind, a.status, a.pusdOut]), [[paid.txid, 'swap', 'accepted', paid.pusdOut.toString()]])
    assert.equal(env.builds.length, 0)
    assert.equal(env.view().settlement.pusdAmount, paid.pusdOut.toString())
    env.observed.set(paid.txid, { seen: true, confirmations: 6 })
    await env.run(4000)
    assert.equal(env.get().state, 'completed')
  } finally {
    env.store.close()
  }
})

test('a page settlement that beat the Router to the coin retires the Router attempt', async () => {
  const env = setup({ page: true })
  try {
    env.land()
    await env.run(1000)
    await env.run(1000 + PAGE_FIRST_MS)
    const [mine] = env.attempts()
    assert.equal(mine.kind, 'swap')
    // The node dropped the Router's broadcast for the page's spend of the same coin.
    env.observed.delete(mine.txid)
    const paid = env.pageConvert()
    await env.run(2000 + PAGE_FIRST_MS)
    assert.equal(env.get().payoutTxid, paid.txid)
    assert.deepEqual(env.attempts().map(a => a.status), ['rejected', 'accepted'])
    assert.equal(env.builds.length, 1, 'no new trade is built')
  } finally {
    env.store.close()
  }
})

test('a version 2 order names the page key it was created with, and a malformed key is refused', () => {
  const env = setup({ page: true })
  try {
    const { contract } = env.view()
    assert.equal(contract.version, 2)
    assert.match(contract.pageKey, /^0[23][0-9a-f]{64}$/)
    assert.notEqual(contract.pageKey, contract.routerKey)
    for (const pageKey of ['02' + '00'.repeat(32), '04' + 'ab'.repeat(32), 'xyz'])
      assert.throws(() => env.store.create(randomUUID(), randomBytes(32).toString('hex'), { ...intent, pageKey }, '200'), error => error.status === 400)
    const plain = setup()
    try {
      assert.equal(plain.view().contract.pageKey, plain.view().contract.routerKey, 'without a page the Router key stands in')
    } finally {
      plain.store.close()
    }
  } finally {
    env.store.close()
  }
})
