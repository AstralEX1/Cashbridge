import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexToBin } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx, RpcError, txidOf, WsRpc } from '../src/lib/bch.ts'
import { buildDeposit, maxBchDeposit, pickBchFunding } from '../src/lib/thorchain-deposit.ts'
import { reviewBuild, sourcesOf } from '../src/lib/cauldron.ts'
import { pubkey, otherPubkey, PUSD, signBuild, swapBuild } from './fixtures/bridge-fixtures.mjs'

const data = new Map()
globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
const { broadcastDeposit, broadcastSale } = await import('../src/lib/reverse-bridge.ts')
const { transactionStore } = await import('../src/store/transaction-store.ts')
const binding = bindingFromPubkey(pubkey, 0)
const vault = bindingFromPubkey(otherPubkey, 0).lockingBytecode
const coins = count => Array.from({ length: count }, (_, i) => ({ txid: (i + 1).toString(16).padStart(64, '0'), vout: 0, value: '10000' }))

test('MAX and coin selection cover the actual deposit fee, including many small inputs', () => {
  for (const funding of [[{ ...coins(1)[0], value: '1000000' }], coins(200)]) {
    for (const feeRate of [1n, 10n]) {
      const amountSats = maxBchDeposit(funding, binding.lockingBytecode, vault, feeRate)
      const picked = pickBchFunding(funding, amountSats, binding.lockingBytecode, vault, feeRate)
      const built = buildDeposit({ funding: picked, lockingBytecode: binding.lockingBytecode, vaultScript: vault, memo: 'x'.repeat(80), amountSats, feeRate })
      assert.equal(built.amountSats, amountSats)
      assert.equal(built.changeSats, 0n)
      assert.equal(amountSats + built.minerFeeSats, picked.reduce((sum, coin) => sum + BigInt(coin.value), 0n))
    }
  }
  const picked = pickBchFunding(coins(200), 1000000n, binding.lockingBytecode, vault, 1n)
  assert.ok(picked.length > 101, 'fixed 2000-satoshi padding selected too few inputs')
  assert.equal(maxBchDeposit([], binding.lockingBytecode, vault, 1n), 0n)
  assert.throws(() => pickBchFunding(coins(1), 20000n, binding.lockingBytecode, vault, 1n))
})

test('MAX uses the vault output size and keeps the approved partial amount unchanged', () => {
  const funding = [{ ...coins(1)[0], value: '1000000' }]
  const largerVault = `aa20${'11'.repeat(32)}87`
  const max = maxBchDeposit(funding, binding.lockingBytecode, largerVault, 10n)
  assert.ok(max < maxBchDeposit(funding, binding.lockingBytecode, vault, 10n))
  const picked = pickBchFunding(funding, max, binding.lockingBytecode, largerVault, 10n)
  const built = buildDeposit({ funding: picked, lockingBytecode: binding.lockingBytecode, vaultScript: largerVault, memo: '=:b:fixture:0', amountSats: max, feeRate: 10n })
  assert.equal(built.amountSats, max)
  assert.ok(built.minerFeeSats > 0n)
})

const funding = [{ txid: '09'.repeat(32), vout: 0, value: '1000000' }, { txid: '0a'.repeat(32), vout: 1, value: '200000' }]
const build = swapBuild({ ownScript: hexToBin(binding.lockingBytecode), funding, sellSats: 900000n, pusdOut: 100n })
const reviewed = reviewBuild(build, { category: PUSD, side: 'buy', funding, lockingBytecode: binding.lockingBytecode, tokenAddress: binding.tokenAddress, cashAddress: binding.cashAddress, sell: 900000n, minOutput: 100n })
const signedHex = signBuild(decodeTx(reviewed.unsignedHex), sourcesOf(reviewed), reviewed.ownIndexes)
const txid = txidOf(signedHex)
const uid = 'reverse-recovery-fixture'

const save = () => transactionStore.setState({ transactions: [{
  uid, bridge: { id: uid, direction: 'reverse', binding, stage: 'second_leg_unknown', firstLeg: { result: 'pending' }, reverse: {
    buyAsset: 'BASE.ETH', destination: `0x${'12'.repeat(20)}`,
    sale: { txid, signedHex }, deposit: { txid, signedHex }
  } }
}] })
const current = () => transactionStore.getState().transactions[0].bridge

function node(t, { lookup = 'absent', unspent = true } = {}) {
  t.mock.method(WsRpc.prototype, 'open', async function () { return this })
  t.mock.method(WsRpc.prototype, 'request', async function (method, params) {
    if (method === 'server.version') return ['fixture', '1.4']
    if (method === 'blockchain.transaction.broadcast') throw new RpcError('1', 'missing-inputs')
    if (method === 'blockchain.transaction.get') {
      if (lookup === 'unavailable') throw new Error('synthetic lookup outage')
      if (lookup === 'seen') return params[1] ? { confirmations: 1 } : signedHex
      throw new RpcError('1', 'transaction not found')
    }
    if (method === 'blockchain.headers.subscribe') return { height: 100 }
    if (method === 'blockchain.scripthash.listunspent') return (unspent === 'partial' ? funding.slice(0, 1) : unspent ? funding : []).map(coin => ({ tx_hash: coin.txid, tx_pos: coin.vout, value: Number(coin.value), height: 100 }))
    throw new Error('Unexpected fixture RPC method')
  })
}

test('a reverse retry keeps signed bytes when transaction lookup is unavailable', async t => {
  node(t, { lookup: 'unavailable' })
  save()
  await broadcastDeposit(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().stage, 'second_leg_unknown')
  assert.equal(current().reverse.deposit.signedHex, signedHex)
  await broadcastSale(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().stage, 'first_leg_unknown')
  assert.ok(!current().error.includes('Nothing was sent'))
})

test('a rejected reverse retry cannot retire a transaction whose own inputs are missing', async t => {
  node(t, { unspent: 'partial' })
  save()
  await broadcastDeposit(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().stage, 'second_leg_unknown')
  assert.equal(current().reverse.deposit.txid, txid)
})

test('a reverse payout already observed on-chain is never discarded after a broadcast rejection', async t => {
  node(t, { lookup: 'seen' })
  save()
  await broadcastDeposit(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().reverse.deposit.txid, txid)
  assert.notEqual(current().stage, 'bch_ready')
})

test('a definitely absent reverse deposit can be rebuilt only while every wallet input stays unspent', async t => {
  node(t)
  save()
  await broadcastDeposit(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().stage, 'bch_ready')
  assert.equal(current().reverse.deposit, undefined)
  assert.deepEqual(current().reverse.priorDepositTxids, [txid])
  save()
  await broadcastSale(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().stage, 'failed')
  assert.ok(decodeTx(signedHex).inputs.length > funding.length, 'pool inputs need not remain available after a pool rejection')
})

test('an old retry cannot erase a newer deposit stored while its network check was running', async t => {
  node(t)
  save()
  const newer = 'ff'.repeat(32)
  await broadcastDeposit(uid, signedHex, txid, (id, patch) => {
    transactionStore.getState().updateBridge(id, op => ({ reverse: { ...op.reverse, deposit: { ...op.reverse.deposit, txid: newer } } }))
    transactionStore.getState().updateBridge(id, patch)
  })
  assert.equal(current().reverse.deposit.txid, newer)
})
