// One forward order on contract v2 from end to end, with every part real except the networks: the order API, the
// page's own checks and settlement, the Router's worker, the public status and the scanner row.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { binToHex, createVirtualMachineBch2026, deriveHdPrivateNodeFromSeed, encodeHdPrivateKey, hexToBin } from '@bitauth/libauth'
import { orderUnlockBytes, WorkerWallet } from '../src/server/auto-bridge/wallet.ts'
import { OrderStore } from '../src/server/auto-bridge/store.ts'
import { createOrder } from '../src/server/auto-bridge/api.ts'
import { processOrder } from '../src/server/auto-bridge/worker.ts'
import { checkOrder } from '../src/lib/auto-bridge-order.ts'
import { newPageKey, settleFromPage } from '../src/lib/page-settle.ts'
import { rowFromOrder } from '../src/lib/scanner.ts'
import { bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, tradeTransaction } from '../src/lib/cauldron.ts'
import { BridgeConfig } from '../src/config.ts'
import { outboundTx, pubkey } from './fixtures/bridge-fixtures.mjs'

const limits = { maxOrderSats: 100_000_000n, maxPendingSats: 1_000_000_000n, maxOpenOrders: 100 }
const policy = { minConfirmations: 0, zeroConfMaxSats: 100_000_000n, maxWaitMs: 60000 }
const customer = bindingFromPubkey(pubkey, 0)
const pool = {
  version: '0',
  parameters: { withdraw_pubkey_hash: new Uint8Array(20).fill(7) },
  outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
  output: { locking_bytecode: poolLockingBytecode(new Uint8Array(20).fill(7)), token: { amount: 30000n, token_id: BridgeConfig.pusd.category }, amount: 108000000n }
}
// The live builder against one local pool, leaving the miner fee as the real one does.
const localTrade = async intent => {
  const fitted = { ...intent, sell: intent.sell - 10000n }
  return { build: tradeTransaction(bestTrade([pool], fitted.sell), fitted), intent: fitted }
}
const routerTrade = order =>
  localTrade({
    category: BridgeConfig.pusd.category,
    side: 'buy',
    funding: order.funding,
    lockingBytecode: order.binding.lockingBytecode,
    tokenAddress: order.recipientAddress,
    cashAddress: order.refundAddress,
    payout: { tokenScript: order.recipientScript, changeScript: order.refundScript },
    sell: order.funding.reduce((sum, coin) => sum + BigInt(coin.value), 0n),
    minOutput: 1n,
    ownUnlockBytes: orderUnlockBytes(order)
  })

// A BCH node and a mempool shared by the page and the Router.
const chain = () => {
  const raw = new Map(), spent = new Set(), seen = new Map()
  const add = hex => {
    const txid = txidOf(hex)
    raw.set(txid, hex)
    seen.set(txid, { seen: true, confirmations: 0 })
    for (const input of decodeTx(hex).inputs) spent.add(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)
    return txid
  }
  const unspent = script =>
    [...raw].flatMap(([txid, hex]) =>
      decodeTx(hex).outputs.flatMap((output, vout) =>
        binToHex(output.lockingBytecode) === script && !spent.has(`${txid}:${vout}`) ? [{ txid, vout, value: output.valueSatoshis, height: 0, hasToken: !!output.token }] : []
      )
    )
  const gateway = {
    history: async () => [...raw.keys()],
    raw: async id => raw.get(id),
    tip: async () => 100,
    coin: async (id, vout) => {
      if (id === '08'.repeat(32) && vout === 0)
        return { output: { lockingBytecode: pool.output.locking_bytecode, valueSatoshis: pool.output.amount, token: { category: hexToBin(BridgeConfig.pusd.category), amount: 30000n } }, confirmations: 1 }
      const hex = raw.get(id)
      return hex && !spent.has(`${id}:${vout}`) && decodeTx(hex).outputs[vout] ? { output: decodeTx(hex).outputs[vout], confirmations: 0 } : undefined
    },
    thorStatus: async () => undefined,
    observe: async id => seen.get(id) ?? { seen: false, confirmations: 0 },
    broadcast: async attempt => void add(attempt.hex)
  }
  return { raw, seen, add, unspent, gateway }
}

const openOrder = async () => {
  const signer = new WorkerWallet(encodeHdPrivateKey({ network: 'mainnet', node: deriveHdPrivateNodeFromSeed(randomBytes(32)) }).hdPrivateKey)
  const store = new OrderStore(':memory:', signer.xpub, limits, undefined, undefined, true, false, true, false, true)
  const page = newPageKey()
  const id = randomUUID(), capability = randomBytes(32).toString('hex')
  const intent = { recipientAddress: customer.tokenAddress, refundAddress: customer.cashAddress, expectedBchSats: '1000000', pageKey: page.pubkey }
  const response = await createOrder(
    new NextRequest('https://bridge.example/api/auto-bridge/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': 'flow-test' },
      body: JSON.stringify({ id, ...intent })
    }),
    { store, quote: async () => ({ output: 220n }) }
  )
  assert.equal(response.status, 201)
  // The page's own check before it shows the deposit address.
  const order = checkOrder(await response.json(), id, intent)
  assert.equal(order.contract.version, 2)
  assert.equal(order.contract.pageKey, page.pubkey)
  return { signer, store, page, order, capability, net: chain() }
}

test('the page settles its own order the moment THORChain pays the contract, and the Router records it and completes', async () => {
  const flow = await openOrder()
  const { store, order, net, page, signer } = flow
  try {
    const run = at => processOrder(store, net.gateway, signer, store.get(order.id), policy, routerTrade, () => at)
    await run(1000)
    assert.equal(store.get(order.id).state, 'awaiting_deposit')
    const contract = hexToBin(store.get(order.id).binding.lockingBytecode)
    net.add(outboundTx({ to: contract, amount: 1000000n }))
    const txid = await settleFromPage(order, page.secret, {
      coinsOf: async script => ({ tip: 100, utxos: net.unspent(script) }),
      trade: localTrade,
      send: async (hex, id) => (assert.equal(net.add(hex), id), id)
    })
    assert.ok(txid, 'the page settled')
    await run(2000)
    assert.deepEqual([store.get(order.id).state, store.get(order.id).payoutTxid], ['submitted', txid])
    net.seen.set(txid, { seen: true, confirmations: 6 })
    await run(3000)
    const view = store.public(order.id, flow.capability)
    assert.equal(view.state, 'completed')
    assert.equal(view.settlement.kind, 'swap')
    assert.ok(BigInt(view.settlement.pusdAmount) >= BigInt(view.minPusd))
    assert.deepEqual(store.attempts(order.id).map(a => a.txid), [txid], 'the Router signed nothing')
    const row = rowFromOrder(store.feed().find(feed => feed.settlement?.txid === txid))
    assert.equal(row.status, 'completed')
    assert.deepEqual(row.legs.map(leg => leg.label), ['BCH to order', 'PUSD payout'])
  } finally {
    store.close()
  }
})

test('with no trade available before the deadline the Router gives the BCH back through contract v2', async () => {
  const flow = await openOrder()
  const { store, order, net, signer } = flow
  try {
    const noTrade = async () => {
      throw new Error('no pool')
    }
    const run = at => processOrder(store, net.gateway, signer, store.get(order.id), policy, noTrade, () => at)
    const contract = hexToBin(store.get(order.id).binding.lockingBytecode)
    net.add(outboundTx({ to: contract, amount: 1000000n }))
    await run(1000)
    await run(1000 + 13000)
    assert.equal(store.get(order.id).state, 'retrying')
    await run(1000 + policy.maxWaitMs)
    const [attempt] = store.attempts(order.id)
    assert.equal(attempt.kind, 'refund')
    const tx = decodeTx(attempt.hex)
    assert.equal(createVirtualMachineBch2026(true).verify({ transaction: tx, sourceOutputs: [{ lockingBytecode: contract, valueSatoshis: 1000000n }] }), true)
    assert.equal(binToHex(tx.outputs[0].lockingBytecode), customer.lockingBytecode)
    assert.ok(tx.outputs[0].valueSatoshis + 2000n >= 1000000n)
  } finally {
    store.close()
  }
})
