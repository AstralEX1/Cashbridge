import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { binToHex, createVirtualMachineBch2026, deriveHdPrivateNodeFromSeed, encodeHdPrivateKey, encodeTransaction, hexToBin } from '@bitauth/libauth'
import { addressToLockingBytecode, bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { BroadcastRejected, bestTrade, poolLockingBytecode, tradeTransaction } from '../src/lib/cauldron.ts'
import { memoScript, saleBinding } from '../src/lib/router-contract.ts'
import { ROUTE_MEMO } from '../src/lib/auto-bridge-contract.ts'
import { BridgeConfig } from '../src/config.ts'
import { createOrder } from '../src/server/auto-bridge/api.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { orderUnlockBytes, WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { processSale, THORCHAIN_QUOTE_MS } from '../src/server/auto-bridge/worker.ts'
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
    nearStatus: async address => state.near?.(address),
    nearSubmit: async (address, hash) => ((state.notices ??= []).push([address, hash]), true),
    observe: async id => ({ seen: txs.has(id), confirmations: confirmations.get(id) ?? 0 }),
    inbound: async () => state.inbounds,
    mimir: async () => state.mimir ?? {},
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
  // Opened a little before the tokens arrive, inside THORChain's quote lifetime.
  const order = store.create(randomUUID(), token, intent, '300000', 1_500_000)
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
    net.state.status = { out_txs: [{ id: 'aa'.repeat(32), chain: 'BCH', to_address: get().binding.cashAddress, coins: [], memo: 'REFUND:x' }], planned_out_txs: [{ chain: 'BCH', to_address: get().binding.cashAddress, coin: { asset: 'BCH.BCH', amount: '1' }, refund: true }], stages: { swap_status: { pending: false } } }
    await run()
    assert.equal(get().state, 'streaming', 'a refund paid to the contract is not done until it is given back')
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

test('a THORChain refund paid straight to the customer ends the order', async () => {
  const { store, net, run, tokens, get } = setup()
  try {
    tokens()
    await run()
    net.state.status = { out_txs: [{ id: 'aa'.repeat(32), chain: 'BCH', to_address: customer.cashAddress, coins: [], memo: 'REFUND:x' }], stages: { swap_status: { pending: false } } }
    await run()
    assert.equal(get().state, 'refunded')
    assert.ok(!store.attempts(get().id).some(a => a.kind === 'refund'))
  } finally {
    store.close()
  }
})

test('tokens split over two coins, a moved vault, a THORChain payout halt, a lapsed quote or a missed deadline send the tokens back as they came', async () => {
  for (const scenario of ['two coins', 'vault moved', 'payouts halted', 'quote lapsed', 'late']) {
    const { store, net, run, tokens, get } = setup()
    try {
      if (scenario === 'two coins') (tokens(60n), tokens(40n))
      else tokens()
      if (scenario === 'vault moved') net.state.inbounds[0].address = customer.cashAddress
      // inbound_addresses still says trading is open; only mimir shows the destination chain's signing halt.
      if (scenario === 'payouts halted') net.state.mimir = { HALTSIGNINGETH: 1 }
      if (scenario === 'late') {
        // No sale meets the floor before the deadline, which starts when the tokens are seen.
        await run(2_000_000, async () => { throw new Error('no pool fills it') })
        assert.equal(get().state, 'retrying')
        assert.equal(store.attempts(get().id).length, 0)
      }
      await run(scenario === 'late' ? 2_000_000 + policy.maxWaitMs : scenario === 'quote lapsed' ? 1_500_000 + THORCHAIN_QUOTE_MS : 2_000_000)
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

// --- Sales through a NEAR Intents or ShapeShift deposit address -------------------------------------------------
const ETH_ID = 'nep141:eth.omft.near'
const routedSale = route => ({ ...sale, memo: ROUTE_MEMO, route, ...(route === 'shapeshift' && { depositSats: '290000', quoteId: 'f6fdc521-af9e-4b60-921d-db8d6a3d38c0' }) })
// 1Click's status of the deposit address, as the signed quote it was made for.
const oneClick = (route, { status = 'PENDING_DEPOSIT', deadline = 10_000_000, refundTo = customer.cashAddress, recipient = sale.destination, minAmountIn = '280000', amount = '290000', payouts = [] } = {}) => ({
  status,
  correlationId: 'c',
  quoteResponse: {
    timestamp: 't',
    signature: 's',
    quoteRequest: {
      swapType: route === 'shapeshift' ? 'EXACT_INPUT' : 'FLEX_INPUT',
      originAsset: 'nep141:bch.omft.near',
      destinationAsset: ETH_ID,
      amount,
      recipient,
      refundTo,
      deadline: new Date(deadline).toISOString()
    },
    quote: { depositAddress: vault.cashAddress, amountIn: amount, minAmountIn, amountOut: '1', minAmountOut: '1' }
  },
  swapDetails: { destinationChainTxHashes: payouts.map(hash => ({ hash })) }
})
const setupRoute = (route, options) => {
  const signer = wallet()
  const store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, false, true, false, true)
  const token = capability()
  const order = store.create(randomUUID(), token, { ...intent, sale: routedSale(route) }, '300000', 1_000_000)
  const net = network()
  let quote = oneClick(route, options)
  net.state.near = address => (address === vault.cashAddress ? quote : undefined)
  const run = (now = 2_000_000) => processSale(store, net.gateway, signer, store.get(order.id), policy, localSale, () => now)
  const tokens = () => net.receive([{ lockingBytecode: hexToBin(order.binding.lockingBytecode), valueSatoshis: 2000n, token: { category: hexToBin(category), amount: 100n } }])
  return { store, token, net, run, tokens, get: () => store.get(order.id), setQuote: next => (quote = next) }
}

test('a NEAR Intents sale deposits the whole sale to the 1Click address and settles from its status', async () => {
  const { store, net, run, tokens, get, setQuote } = setupRoute('near')
  try {
    tokens()
    await run()
    const [, deposited] = store.attempts(get().id)
    const tx = decodeTx(deposited.hex)
    assert.equal(tx.outputs.length, 2)
    assert.equal(binToHex(tx.outputs[0].lockingBytecode), vault.lockingBytecode)
    assert.ok(tx.outputs[0].valueSatoshis >= 300000n - 2000n)
    assert.equal(binToHex(tx.outputs[1].lockingBytecode), binToHex(memoScript(ROUTE_MEMO)))
    assert.ok(net.state.sent.some(a => a.txid === deposited.txid), 'verified in the VM and relayed')
    // 1Click still waits for the deposit: the Router tells it the hash, again a minute later, and stops once it moves on.
    await run()
    await run(2_030_000)
    assert.deepEqual(net.state.notices, [[vault.cashAddress, deposited.txid]])
    await run(2_061_000)
    assert.equal(net.state.notices.length, 2)
    setQuote(oneClick('near', { status: 'PROCESSING' }))
    await run()
    assert.equal(get().state, 'streaming')
    setQuote(oneClick('near', { status: 'SUCCESS', payouts: ['0x' + 'ab'.repeat(32)] }))
    await run()
    assert.equal(get().state, 'completed')
    assert.equal(net.state.notices.length, 2, 'no notice once 1Click has the deposit')
  } finally {
    store.close()
  }
})

test('a ShapeShift sale deposits exactly the quoted BCH and returns the rest to the customer', async () => {
  const { store, net, run, tokens, get, setQuote } = setupRoute('shapeshift')
  try {
    tokens()
    await run()
    const [sold, deposited] = store.attempts(get().id)
    const tx = decodeTx(deposited.hex)
    assert.equal(tx.outputs[0].valueSatoshis, 290000n)
    assert.equal(binToHex(tx.outputs[0].lockingBytecode), vault.lockingBytecode)
    assert.equal(binToHex(tx.outputs[2].lockingBytecode), customer.lockingBytecode)
    const back = decodeTx(sold.hex).outputs.find(o => binToHex(o.lockingBytecode) === get().binding.lockingBytecode && !o.token).valueSatoshis
    assert.ok(back - 290000n - tx.outputs[2].valueSatoshis <= 2000n, 'only the miner fee is kept')
    assert.ok(net.state.sent.some(a => a.txid === deposited.txid), 'verified in the VM and relayed')
    setQuote(oneClick('shapeshift', { status: 'REFUNDED' }))
    await run()
    assert.equal(get().state, 'refunded')
  } finally {
    store.close()
  }
})

test('a routed sale gives the tokens back when its deposit address is used, expiring or refunds elsewhere', async () => {
  for (const options of [{ status: 'PROCESSING' }, { deadline: 2_000_000 + 30 * 60_000 }, { refundTo: bindingFromPubkey(otherPubkey, 1).cashAddress }]) {
    const { store, run, tokens, get } = setupRoute('near', options)
    try {
      tokens()
      await run()
      assert.deepEqual(store.attempts(get().id).map(a => a.kind), ['refund'], JSON.stringify(options))
    } finally {
      store.close()
    }
  }
})

test('the store admits routed sales only when they are on, with the route memo and an exact amount that leaves change', () => {
  const signer = wallet()
  const on = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, false, true, false, true)
  const off = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, false, true)
  try {
    assert.throws(() => off.create(randomUUID(), capability(), { ...intent, sale: routedSale('near') }, '300000'), error => error.status === 400)
    for (const bad of [
      { ...routedSale('near'), memo: 'other' },
      { ...routedSale('near'), depositSats: '1000' },
      { ...routedSale('shapeshift'), depositSats: undefined },
      { ...routedSale('shapeshift'), depositSats: '297500' },
      { ...routedSale('near'), route: 'thorchain' }
    ])
      assert.throws(() => on.create(randomUUID(), capability(), { ...intent, sale: JSON.parse(JSON.stringify(bad)) }, '300000'), error => error.status === 400, JSON.stringify(bad))
    const order = on.create(randomUUID(), capability(), { ...intent, sale: routedSale('shapeshift') }, '300000')
    const terms = { routerKey: order.binding.pubkey, vaultScript: vault.lockingBytecode, memo: ROUTE_MEMO, refundScript: customer.lockingBytecode, minSats: '300000', refundAfter: order.contract.refundAfter, depositSats: '290000' }
    assert.equal(saleBinding(terms, 0).cashAddress, order.binding.cashAddress, 'the exact contract of the public terms')
  } finally {
    on.close()
    off.close()
  }
})

test('the sale API checks a routed sale against 1Click: recipient, refund, assets and amount', async () => {
  const signer = wallet()
  const store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, false, true, false, true)
  const cap = capability()
  const request = body =>
    new NextRequest('https://bridge.example/api/auto-bridge/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': 'sale-route-api-test' },
      body: JSON.stringify(body)
    })
  const later = Date.now() + 4 * 60 * 60_000
  let quote = oneClick('shapeshift', { deadline: later, amount: '2900000' })
  const HOT_ETH = 'nep245:v2_1.omni.hot.tg:1_'
  const near = {
    status: async () => quote,
    tokens: async () => [
      { assetId: ETH_ID, decimals: 18, blockchain: 'eth', symbol: 'ETH', price: 1 },
      { assetId: HOT_ETH, decimals: 18, blockchain: 'eth', symbol: 'ETH(DEPRECATED)', price: 1 },
      { assetId: 'nep141:arb.omft.near', decimals: 18, blockchain: 'arb', symbol: 'ETH', price: 1 }
    ]
  }
  const service = { store, quote: async () => ({ output: 3_000_000n }), near }
  const body = (overrides = {}) => ({ id: randomUUID(), ...intent, sale: { ...routedSale('shapeshift'), depositSats: '2900000', ...overrides } })
  try {
    const created = await createOrder(request(body()), service)
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()))
    assert.equal((await created.json()).sale.route, 'shapeshift')
    assert.equal((await createOrder(request(body({ depositSats: '2800000' })), service)).status, 409, 'not the quoted amount')
    quote = oneClick('shapeshift', { deadline: later, amount: '2900000', refundTo: bindingFromPubkey(otherPubkey, 1).cashAddress })
    assert.equal((await createOrder(request(body()), service)).status, 409, 'refunds someone else')
    quote = oneClick('shapeshift', { deadline: later, amount: '2900000', recipient: '0x2222222222222222222222222222222222222222' })
    assert.equal((await createOrder(request(body()), service)).status, 409, 'pays someone else')
    quote = oneClick('shapeshift', { deadline: Date.now() + 30 * 60_000, amount: '2900000' })
    assert.equal((await createOrder(request(body()), service)).status, 409, 'expires too soon')
    quote = { ...oneClick('shapeshift', { deadline: later, amount: '2900000' }) }
    quote.quoteResponse.quoteRequest.destinationAsset = 'nep141:other.near'
    assert.equal((await createOrder(request(body()), service)).status, 409, 'another asset')
    quote.quoteResponse.quoteRequest.destinationAsset = 'nep141:arb.omft.near'
    assert.equal((await createOrder(request(body()), service)).status, 409, 'the same ticker on another chain')
    quote.quoteResponse.quoteRequest.destinationAsset = HOT_ETH
    assert.equal((await createOrder(request(body()), service)).status, 201, "a retired 1Click row of the same coin, as ShapeShift quotes BSC USDT")
    quote = oneClick('near', { deadline: later, minAmountIn: '2939000' })
    assert.equal((await createOrder(request({ id: randomUUID(), ...intent, sale: routedSale('near') }), service)).status, 409, 'asks more than the sale guarantees')
    quote = oneClick('near', { deadline: later, minAmountIn: '2900000' })
    assert.equal((await createOrder(request({ id: randomUUID(), ...intent, sale: routedSale('near') }), service)).status, 201)
  } finally {
    store.close()
  }
})

test("a stranger's BCH beside the tokens neither stops the sale nor stays at the contract, and dust is left alone", async () => {
  const { store, net, run, tokens, get } = setup()
  try {
    tokens()
    net.receive([{ lockingBytecode: hexToBin(get().binding.lockingBytecode), valueSatoshis: 5000n }])
    net.receive([{ lockingBytecode: hexToBin(get().binding.lockingBytecode), valueSatoshis: 700n }])
    await run()
    const [sold, deposited] = store.attempts(get().id)
    assert.deepEqual([sold.kind, deposited.kind], ['swap', 'deposit'])
    assert.equal(get().funding.length, 1, 'only the token coin is sold')
    await run()
    const back = store.attempts(get().id).find(a => a.kind === 'refund')
    assert.ok(back && net.state.sent.some(a => a.txid === back.txid), 'the stray BCH goes to the customer')
    const tx = decodeTx(back.hex)
    assert.equal(tx.inputs.length, 1)
    assert.equal(binToHex(tx.outputs[0].lockingBytecode), customer.lockingBytecode)
  } finally {
    store.close()
  }
})

test("a stranger's token dust at the contract holds back neither the tokens' return nor the order's end", async () => {
  for (const scenario of ['give back', 'deposit done']) {
    const { store, net, run, tokens, get } = setup()
    const dust = () => net.receive([{ lockingBytecode: hexToBin(get().binding.lockingBytecode), valueSatoshis: 800n, token: { category: randomBytes(32), amount: 1n } }])
    try {
      tokens()
      if (scenario === 'give back') {
        dust()
        await run(1_500_000 + THORCHAIN_QUOTE_MS)
        const [back] = store.attempts(get().id)
        const tx = decodeTx(back.hex)
        assert.equal(tx.inputs.length, 1, 'the dust token cannot pay its fee share and stays at the contract')
        assert.equal(binToHex(tx.outputs[0].token.category), category)
        assert.ok(net.state.sent.some(a => a.txid === back.txid))
        net.confirm(back.txid)
        await run()
        assert.equal(get().state, 'refunded')
      } else {
        await run()
        const deposited = store.attempts(get().id).find(a => a.kind === 'deposit')
        dust()
        net.state.status = { out_txs: [{ id: 'aa'.repeat(32), chain: 'ETH', coins: [], memo: `OUT:${deposited.txid}` }], stages: { swap_status: { pending: false } } }
        await run()
        assert.equal(get().state, 'completed')
        assert.ok(!store.attempts(get().id).some(a => a.kind === 'refund'))
      }
    } finally {
      store.close()
    }
  }
})
