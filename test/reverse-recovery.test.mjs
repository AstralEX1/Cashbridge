import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binToHex, encodeTransaction, generateTransaction, hexToBin, walletTemplateP2pkhNonHd, walletTemplateToCompilerBch } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx, RpcError, txidOf, WsRpc } from '../src/lib/bch.ts'
import { buildDeposit, maxBchDeposit, pickBchFunding } from '../src/lib/thorchain-deposit.ts'
import { checkSigned, reviewBuild, sourcesOf } from '../src/lib/cauldron.ts'
import { pubkey, otherPubkey, privateKey, PUSD, signBuild, swapBuild } from './fixtures/bridge-fixtures.mjs'

const data = new Map()
globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
const { broadcastDeposit, broadcastSale, OPEN_REQUEST_MS, signingInputs, unsignedOutcome } = await import('../src/lib/reverse-bridge.ts')
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
  assert.throws(() => pickBchFunding(coins(5), 10000n, binding.lockingBytecode, vault, 1n), /minimum/, 'THORChain ignores a deposit equal to its dust threshold')
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

const save = (deposit = {}) => transactionStore.setState({ transactions: [{
  uid, bridge: { id: uid, direction: 'reverse', binding, stage: 'second_leg_unknown', firstLeg: { result: 'pending' }, reverse: {
    buyAsset: 'BASE.ETH', destination: `0x${'12'.repeat(20)}`,
    sale: { txid, signedHex }, deposit: { txid, signedHex, ...deposit }
  } }
}] })
const current = () => transactionStore.getState().transactions[0].bridge

function node(t, { lookup = 'absent', unspent = true } = {}) {
  t.mock.method(WsRpc.prototype, 'open', async function () { return this })
  return t.mock.method(WsRpc.prototype, 'request', async function (method, params) {
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
  assert.equal(current().reverse.sale, undefined, 'a sale that never reached the network must not show as sent')
  assert.ok(decodeTx(signedHex).inputs.length > funding.length, 'pool inputs need not remain available after a pool rejection')
})

test('a deposit whose quote lapsed is not sent again while the chain has not seen it', async t => {
  const rpc = node(t)
  save({ expiresAt: Date.now() - 1 })
  await broadcastDeposit(uid, signedHex, txid, transactionStore.getState().updateBridge)
  assert.equal(current().stage, 'bch_ready')
  assert.match(current().error, /quote expired/)
  assert.ok(!rpc.mock.calls.some(call => call.arguments[0] === 'blockchain.transaction.broadcast'))
})

test('a first transaction whose signature never came back is called unsent only once its inputs outlive the request', async t => {
  const signing = signingInputs(reviewed)
  assert.deepEqual(signing.inputs, funding.map(({ txid, vout }) => ({ txid, vout })), 'only the bound wallet\'s own inputs are watched')
  const unknown = reverse => ({ stage: 'first_leg_unknown', binding, reverse: { buyAsset: 'BTC.BTC', destination: 'synthetic-destination', ...reverse } })

  node(t)
  assert.equal(await unsignedOutcome(unknown({ signing }), signing.sentAt + 1000), undefined, 'the wallet may still answer')
  const expired = await unsignedOutcome(unknown({ signing }), signing.sentAt + OPEN_REQUEST_MS + 1)
  assert.equal(expired.stage, 'failed')
  assert.match(expired.error, /nothing was sent/)

  t.mock.restoreAll()
  node(t, { unspent: 'partial' })
  // A wallet that broadcasts on its own (older Paytaca) sent it after the request was withdrawn here.
  const spent = await unsignedOutcome(unknown({ signing }), signing.sentAt + 1000)
  assert.equal(spent.stage, 'failed')
  assert.match(spent.error, /may have sent it/)
  assert.doesNotMatch(spent.error, /nothing was sent/i)

  // A record saved before the inputs were kept proves nothing either way.
  const legacy = await unsignedOutcome(unknown({}))
  assert.doesNotMatch(legacy.error, /nothing was sent/i)
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

test('a deposit signed with the longest ECDSA signatures still pays the configured fee rate', () => {
  const own = bindingFromPubkey(pubkey, 0),
    vault = bindingFromPubkey(otherPubkey, 0).lockingBytecode
  const compiler = walletTemplateToCompilerBch(JSON.parse(JSON.stringify(walletTemplateP2pkhNonHd).replaceAll('schnorr_signature', 'ecdsa_signature')))
  for (const inputs of [1, 3]) {
    const funding = Array.from({ length: inputs }, (_, vout) => ({ txid: 'cd'.repeat(32), vout, value: '400000' }))
    const built = buildDeposit({ funding, lockingBytecode: own.lockingBytecode, vaultScript: vault, memo: '=:b:synthetic:0', amountSats: 300000n, feeRate: 1n })
    const unsigned = decodeTx(built.unsignedHex),
      sources = sourcesOf(built)
    const result = generateTransaction({
      ...unsigned,
      inputs: unsigned.inputs.map((input, i) => ({
        ...input,
        unlockingBytecode: { compiler, data: { keys: { privateKeys: { key: privateKey } } }, script: 'unlock', valueSatoshis: sources[i].valueSatoshis }
      })),
      sourceOutputs: sources
    })
    assert.equal(result.success, true)
    const signed = binToHex(encodeTransaction(result.transaction))
    // The wallet review accepts ECDSA, so the fee must already cover it.
    assert.equal(checkSigned(built.unsignedHex, signed, built.ownIndexes, sources, own.pubkey), txidOf(signed))
    assert.ok(built.minerFeeSats >= BigInt(signed.length / 2), `${built.minerFeeSats} sats for ${signed.length / 2} bytes`)
  }
})
