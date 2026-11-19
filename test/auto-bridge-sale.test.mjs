import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { binToHex, createVirtualMachineBch2026, deriveHdPrivateNodeFromSeed, encodeHdPrivateKey, encodeTransaction, hexToBin } from '@bitauth/libauth'
import { addressToLockingBytecode, bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { BroadcastRejected, bestTrade, poolLockingBytecode, tradeTransaction } from '../src/lib/cauldron.ts'
import { memoScript, saleBinding } from '../src/lib/router-contract.ts'
import { BridgeConfig } from '../src/config.ts'
import { createOrder } from '../src/server/auto-bridge/api.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { orderUnlockBytes, WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { processSale } from '../src/server/auto-bridge/worker.ts'
import { otherPubkey, pubkey } from './fixtures/bridge-fixtures.mjs'

const limits = { maxOrderSats: 100_000_000n, maxPendingSats: 1_000_000_000n, maxOpenOrders: 100 }
const policy = { minConfirmations: 0, zeroConfMaxSats: 100_000_000n, maxWaitMs: 1_800_000 }
const category = BridgeConfig.pusd.category
const customer = bindingFromPubkey(pubkey, 0)
const vault = bindingFromPubkey(otherPubkey, 7)
const sale = { category, tokenAmount: '100', buyAsset: 'ETH.ETH', destination: '0x1111111111111111111111111111111111111111', memo: '=:e:0x1111111111111111111111111111111111111111:0/1/0', vaultAddress: vault.cashAddress }
const intent = { recipientAddress: customer.tokenAddress, refundAddress: customer.tokenAddress, expectedBchSats: '3000000', sale }
const wallet = () => new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
const capability = () => randomBytes(32).toString('hex')
const vm = createVirtualMachineBch2026(true)

const withdraw = new Uint8Array(20).fill(7)
const poolOutput = { lockingBytecode: poolLockingBytecode(withdraw), valueSatoshis: 108000000n, token: { category: hexToBin(category), amount: 30000n } }
const localSale = async order => {
  const [coin] = order.funding
  const pool = {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdraw },
    outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
    output: { locking_bytecode: poolOutput.lockingBytecode, token: { amount: 30000n, token_id: category }, amount: poolOutput.valueSatoshis }
  }
  const buildIntent = {
    category,
    side: 'sell',
    funding: [{ txid: coin.txid, vout: coin.vout, value: coin.value, token: coin.token }],
    lockingBytecode: order.binding.lockingBytecode,
    tokenAddress: order.binding.tokenAddress,
    cashAddress: order.binding.cashAddress,
    sell: BigInt(coin.token.amount),
    minOutput: BigInt(order.minPusd),
    ownUnlockBytes: orderUnlockBytes(order)
  }
  return { build: tradeTransaction(bestTrade([pool], BigInt(coin.token.amount), category, 'sell'), buildIntent), intent: buildIntent }
}

// A BCH network in memory: it relays only transactions every input of which verifies in the VM.
const network = () => {
  const txs = new Map()
  const spent = new Set()
  const extra = new Map([[`${'08'.repeat(32)}:0`, poolOutput]])
  const confirmations = new Map()
  const outputOf = (id, vout) => extra.get(`${id}:${vout}`) ?? (txs.has(id) ? decodeTx(txs.get(id)).outputs[vout] : undefined)
  const add = hex => {
    const id = txidOf(hex)
    txs.set(id, hex)
    for (const input of decodeTx(hex).inputs) spent.add(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)
    return id
  }
  // A transaction from outside (the customer, THORChain) paying `outputs`.
  const receive = outputs => add(binToHex(encodeTransaction({
    version: 2, locktime: 0,
    inputs: [{ outpointTransactionHash: randomBytes(32), outpointIndex: 0, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }],
    outputs
  })))
  const state = { inbounds: [{ chain: 'BCH', address: vault.cashAddress, gas_rate: '1' }, { chain: 'ETH', address: '0x2222222222222222222222222222222222222222', router: '0x3333333333333333333333333333333333333333' }], status: undefined, sent: [] }
  const gateway = {
    history: async script => [...txs].filter(([, hex]) => decodeTx(hex).outputs.some(o => binToHex(o.lockingBytecode) === script)).map(([id]) => id),
    raw: async id => txs.get(id),
    tip: async () => 900000,
    coin: async (id, vout) => {
      const output = outputOf(id, vout)
      return output && !spent.has(`${id}:${vout}`) ? { output, confirmations: confirmations.get(id) ?? 0 } : undefined
    },
    thorStatus: async () => state.status,
    observe: async id => ({ seen: txs.has(id), confirmations: confirmations.get(id) ?? 0 }),
    inbound: async () => state.inbounds,
    broadcast: async attempt => {
      if (txs.has(attempt.txid)) return
      const transaction = decodeTx(attempt.hex)
      const sourceOutputs = transaction.inputs.map(input => outputOf(binToHex(input.outpointTransactionHash), input.outpointIndex))
      if (sourceOutputs.some(source => !source) || transaction.inputs.some(input => spent.has(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)))
        throw new BroadcastRejected('missing or spent inputs')
      const verdict = vm.verify({ transaction, sourceOutputs })
      if (verdict !== true) throw new BroadcastRejected(String(verdict))
      state.sent.push(attempt)
      add(attempt.hex)
    }
  }
  return { gateway, receive, state, txs, confirm: (id, depth = 1) => confirmations.set(id, depth) }
}

const setup = () => {
  const signer = wallet()
  const store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, false, true)
  const token = capability()
  const order = store.create(randomUUID(), token, intent, '300000', 1_000_000)
  const net = network()
  const run = (now = 2_000_000, build = localSale) => processSale(store, net.gateway, signer, store.get(order.id), policy, build, () => now)
  const tokens = (amount = 100n, value = 2000n) => net.receive([{ lockingBytecode: hexToBin(order.binding.lockingBytecode), valueSatoshis: value, token: { category: hexToBin(category), amount } }])
  return { signer, store, token, order, net, run, tokens, get: () => store.get(order.id) }
}

test('a sale order deposits into the sale contract of its own public terms, and only when sales are on', () => {
  const { store, token, order } = setup()
  try {
    const view = store.public(order.id, token)
    assert.deepEqual(view.sale, sale)
    const terms = { ...view.contract, vaultScript: addressToLockingBytecode(sale.vaultAddress), memo: sale.memo, refundScript: addressToLockingBytecode(view.refundAddress), minSats: view.minPusd }
    assert.equal(saleBinding(terms, 0).cashAddress, view.depositAddress)
    const off = new OrderStore(':memory:', wallet().xpub, limits)
    assert.throws(() => off.create(randomUUID(), capability(), intent, '300000'), error => error.status === 400)
    off.close()
    for (const bad of [
      { ...intent, refundAddress: bindingFromPubkey(otherPubkey, 0).cashAddress },
      { ...intent, sale: { ...sale, memo: 'x'.repeat(81) } },
      { ...intent, sale: { ...sale, vaultAddress: saleBinding(terms, 0).cashAddress } },
      { ...intent, sale: { ...sale, vaultAddress: customer.cashAddress } },
      { ...intent, category }
    ])
      assert.throws(() => store.create(randomUUID(), capability(), bad, '300000'), error => error.status === 400)
  } finally {
    store.close()
  }
})

test('the Router sells the tokens into the contract and deposits that BCH alone to the vault with the memo', async () => {
  const { store, net, run, tokens, get } = setup()
  try {
    tokens()
    await run()
    const [sold, deposited] = store.attempts(get().id)
    assert.deepEqual([sold.kind, deposited.kind, deposited.parent], ['swap', 'deposit', sold.txid])
    assert.deepEqual(net.state.sent.map(a => a.txid), [sold.txid, deposited.txid], 'both verified in the VM and relayed')
    const tx = decodeTx(deposited.hex)
    assert.equal(binToHex(tx.outputs[0].lockingBytecode), vault.lockingBytecode)
    assert.ok(tx.outputs[0].valueSatoshis >= 300000n - 2000n)
    assert.equal(binToHex(tx.outputs[1].lockingBytecode), binToHex(memoScript(sale.memo)))
    assert.equal(get().state, 'submitted')
    assert.equal(get().payoutTxid, deposited.txid)

    net.state.status = { out_txs: [{ id: 'aa'.repeat(32), chain: 'ETH', coins: [], memo: `OUT:${deposited.txid}` }], stages: { swap_status: { pending: false } } }
    await run()
    assert.equal(get().state, 'completed')
  } finally {
    store.close()
  }
})

test('a THORChain refund that comes back to the contract goes on to the customer', async () => {
  const { store, net, run, tokens, get, token } = setup()
  try {
    tokens()
    await run()
    net.state.status = { out_txs: [{ id: 'aa'.repeat(32), chain: 'BCH', coins: [], memo: 'REFUND:x' }], planned_out_txs: [{ chain: 'BCH', to_address: get().binding.cashAddress, coin: { asset: 'BCH.BCH', amount: '1' }, refund: true }], stages: { swap_status: { pending: false } } }
    net.receive([{ lockingBytecode: hexToBin(get().binding.lockingBytecode), valueSatoshis: 250000n }])
    await run()
    const back = store.attempts(get().id).find(a => a.kind === 'refund')
    assert.ok(net.state.sent.some(a => a.txid === back.txid))
    const out = decodeTx(back.hex).outputs
    assert.equal(binToHex(out[0].lockingBytecode), customer.lockingBytecode)
    assert.ok(out[0].valueSatoshis > 248000n && !out[0].token)
    await run()
    assert.equal(get().state, 'refunded')
    assert.equal(store.public(get().id, token).settlement.kind, 'deposit')
  } finally {
    store.close()
  }
})

test('a second coin, a moved vault or a missed deadline sends the tokens back as they came', async () => {
  for (const scenario of ['two coins', 'vault moved', 'late']) {
    const { store, net, run, tokens, get } = setup()
    try {
      tokens()
      if (scenario === 'two coins') tokens(5n)
      if (scenario === 'vault moved') net.state.inbounds[0].address = customer.cashAddress
      if (scenario === 'late') {
        // No sale meets the floor before the deadline, which starts when the tokens are seen.
        await run(2_000_000, async () => { throw new Error('no pool fills it') })
        assert.equal(get().state, 'retrying')
        assert.equal(store.attempts(get().id).length, 0)
      }
      await run(scenario === 'late' ? 2_000_000 + policy.maxWaitMs : 2_000_000)
      const attempts = store.attempts(get().id)
      assert.deepEqual(attempts.map(a => a.kind), ['refund'], scenario)
      const out = decodeTx(attempts[0].hex).outputs
      assert.ok(out.every(o => binToHex(o.lockingBytecode) === customer.lockingBytecode && o.token && binToHex(o.token.category) === category), scenario)
      assert.ok(net.state.sent.some(a => a.txid === attempts[0].txid), scenario)
      net.confirm(attempts[0].txid)
      await run()
      assert.equal(get().state, 'refunded', scenario)
    } finally {
      store.close()
    }
  }
})

test('the sale API quotes the token sale for the floor and refuses a vault THORChain no longer uses', async () => {
  const signer = wallet()
  const store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, false, true)
  const cap = capability()
  const request = body =>
    new NextRequest('https://bridge.example/api/auto-bridge/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': 'sale-api-test' },
      body: JSON.stringify(body)
    })
  const asked = []
  let inbounds = [{ chain: 'BCH', address: vault.cashAddress }, { chain: 'ETH', address: '0x2222222222222222222222222222222222222222' }]
  const service = { store, quote: async (amount, cat, side) => (asked.push([amount, cat, side]), { output: 3_000_000n }), inbound: async () => inbounds }
  try {
    const created = await createOrder(request({ id: randomUUID(), ...intent }), service)
    assert.equal(created.status, 201)
    assert.deepEqual(asked, [[100n, category, 'sell']])
    assert.equal((await created.json()).minPusd, '2940000')
    inbounds = [{ chain: 'BCH', address: customer.cashAddress }, inbounds[1]]
    assert.equal((await createOrder(request({ id: randomUUID(), ...intent }), service)).status, 409)
    assert.equal((await createOrder(request({ id: randomUUID(), ...intent, sale: { ...sale, memo: 7 } }), service)).status, 400)
  } finally {
    store.close()
  }
})
