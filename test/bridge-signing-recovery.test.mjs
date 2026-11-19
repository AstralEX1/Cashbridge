import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexToBin } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx, RpcError, txidOf, WsRpc } from '../src/lib/bch.ts'
import { reviewBuild, sourcesOf } from '../src/lib/cauldron.ts'
import { SIGN_REQUEST_EXPIRY_S } from '../src/lib/bch-walletconnect.ts'
import { SignCancelled, SignDeclined, SignSessionLost, SignTimedOut, SignUndelivered } from '../src/lib/bch-signing.ts'
import {
  hasSecondAuthorization,
  matchesSigningRequest,
  OPEN_SECOND_REQUEST_NOTE,
  recoverSecondSigning,
  rememberAttempt,
  sameSecondAttempt,
  signingDefinitelyStopped,
  signingRequest
} from '../src/lib/bridge-signing-recovery.ts'
import { pubkey, PUSD, signBuild, swapBuild } from './fixtures/bridge-fixtures.mjs'

const storage = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
}

const { transactionStore } = await import('../src/store/transaction-store.ts')

const binding = bindingFromPubkey(pubkey, 0)
const funding = [{ txid: '09'.repeat(32), vout: 0, value: '1000000' }, { txid: '0a'.repeat(32), vout: 1, value: '200000' }]
const build = swapBuild({ ownScript: hexToBin(binding.lockingBytecode), funding, sellSats: 900000n, pusdOut: 100n })
const reviewed = reviewBuild(build, {
  category: PUSD,
  side: 'buy',
  funding,
  lockingBytecode: binding.lockingBytecode,
  tokenAddress: binding.tokenAddress,
  cashAddress: binding.cashAddress,
  sell: 900000n,
  minOutput: 100n
})
const signedHex = signBuild(decodeTx(reviewed.unsignedHex), sourcesOf(reviewed), reviewed.ownIndexes)
const signedTxid = txidOf(signedHex)
const request = signingRequest(reviewed, 1_000)
const REQUEST_WAIT_MS = SIGN_REQUEST_EXPIRY_S * 1000 + 60_000

const forwardOp = (stage, secondLeg, extras = {}) => ({
  id: 'recovery',
  stage,
  binding,
  destinationAsset: 'PUSD',
  firstLeg: { result: 'swapped' },
  received: funding.map(coin => ({ ...coin, confirmations: 1, unspent: true })),
  secondLeg,
  updatedAt: 0,
  ...extras
})

const mockNode = (t, { history = [], unspent = true, raw } = {}) => {
  t.mock.method(WsRpc.prototype, 'open', async function () { return this })
  t.mock.method(WsRpc.prototype, 'request', async function (method, params) {
    if (method === 'server.version') return ['fixture', '1.4']
    if (method === 'blockchain.headers.subscribe') return { height: 100 }
    if (method === 'blockchain.scripthash.get_history') {
      return history.map(item => typeof item === 'string' ? { tx_hash: item, height: 100 } : item)
    }
    if (method === 'blockchain.transaction.get') {
      const id = params[0]
      if (raw && raw[id]) return raw[id]
      if (id === signedTxid) return signedHex
      throw new RpcError('1', 'transaction not found')
    }
    if (method === 'blockchain.scripthash.listunspent') {
      return (unspent ? funding : []).map(coin => ({
        tx_hash: coin.txid,
        tx_pos: coin.vout,
        value: Number(coin.value),
        height: 100
      }))
    }
    throw new Error(`Unexpected fixture RPC method ${method}`)
  })
}

test('signingDefinitelyStopped treats only resolved withdrawals as retryable', () => {
  assert.equal(signingDefinitelyStopped(new SignCancelled('x', true)), false)
  assert.equal(signingDefinitelyStopped(new SignTimedOut('x', true)), false)
  assert.equal(signingDefinitelyStopped(new SignCancelled('x', false)), true)
  assert.equal(signingDefinitelyStopped(new SignTimedOut('x', false)), true)
  assert.equal(signingDefinitelyStopped(new SignDeclined('x')), true)
  assert.equal(signingDefinitelyStopped(new SignSessionLost('x')), true)
  assert.equal(signingDefinitelyStopped(new SignUndelivered('x')), true)
  assert.equal(signingDefinitelyStopped(new Error('other')), false)
})

test('authorization helpers keep prior attempts and block Keep while any request exists', () => {
  const first = { attempt: 'a', signing: request, category: PUSD, sellSats: '1', minOutput: '1', routerFeeSats: '0', minerFeeSats: '1' }
  const second = { ...first, attempt: 'b' }
  assert.deepEqual(rememberAttempt(undefined, first), [first])
  assert.deepEqual(rememberAttempt([first], second).map(item => item.attempt), ['a', 'b'])
  assert.deepEqual(rememberAttempt([first, second], { ...first, sellSats: '2' }).map(item => item.attempt), ['b', 'a'])
  assert.equal(hasSecondAuthorization(forwardOp('bch_ready')), false)
  assert.equal(hasSecondAuthorization(forwardOp('second_leg_unknown', first)), true)
  assert.equal(hasSecondAuthorization(forwardOp('bch_ready', undefined, { priorSecondLegs: [first] })), true)
  assert.equal(hasSecondAuthorization({ direction: 'reverse', reverse: { deposit: first } }), true)
  assert.equal(hasSecondAuthorization({ direction: 'reverse', reverse: { priorDeposits: [first] } }), true)
  const snap = forwardOp('second_leg_signing', first)
  assert.equal(sameSecondAttempt(snap, snap), true)
  assert.equal(sameSecondAttempt(forwardOp('second_leg_unknown', first), snap), false)
  assert.equal(sameSecondAttempt(forwardOp('second_leg_signing', second), snap), false)
})

test('signingRequest freezes the exact unsigned authorization before the wallet opens', () => {
  const saved = signingRequest(reviewed, 42)
  assert.equal(saved.unsignedHex, reviewed.unsignedHex)
  assert.deepEqual(saved.ownIndexes, reviewed.ownIndexes)
  assert.equal(saved.sentAt, 42)
  assert.equal(matchesSigningRequest(saved, signedHex, binding.pubkey), true)
  assert.equal(matchesSigningRequest(saved, reviewed.unsignedHex, binding.pubkey), false)
  assert.throws(() => signingRequest({ ...reviewed, ownIndexes: [] }))
  assert.throws(() => signingRequest({ ...reviewed, ownIndexes: [0, 0] }))
  assert.throws(() => signingRequest({ ...reviewed, ownIndexes: [99] }))
})

test('reload turns an in-flight second-leg signature into durable uncertainty without dropping the authorization', async () => {
  storage.set('tc-transactions', JSON.stringify({
    state: {
      transactions: [{
        uid: 'reload',
        kind: 'swap',
        status: 'not_started',
        timestamp: new Date().toISOString(),
        bridge: forwardOp('second_leg_signing', {
          attempt: 'reload-attempt',
          signing: request,
          category: PUSD,
          sellSats: reviewed.sell.toString(),
          minOutput: reviewed.minOutput.toString(),
          routerFeeSats: '0',
          minerFeeSats: reviewed.minerFeeSats.toString()
        })
      }]
    },
    version: 1
  }))
  await transactionStore.persist.rehydrate()
  const op = transactionStore.getState().transactions[0].bridge
  assert.equal(op.stage, 'second_leg_unknown')
  assert.equal(op.secondLeg.signing.unsignedHex, reviewed.unsignedHex)
  assert.equal(hasSecondAuthorization(op), true)
})

test('recoverSecondSigning matches only the authorized wallet signature and completes the forward swap', async t => {
  mockNode(t, { history: [signedTxid], raw: { [signedTxid]: signedHex } })
  const op = forwardOp('second_leg_unknown', {
    attempt: 'match',
    signing: request,
    category: PUSD,
    sellSats: reviewed.sell.toString(),
    minOutput: reviewed.minOutput.toString(),
    routerFeeSats: '0',
    minerFeeSats: reviewed.minerFeeSats.toString()
  })
  const recovery = await recoverSecondSigning(op, request.sentAt + 1_000)
  assert.equal(recovery.stage, 'completed')
  assert.equal(recovery.secondLeg.txid, signedTxid)
  assert.equal(recovery.secondLeg.signedHex, signedHex)
  assert.equal(recovery.error, undefined)
})

test('still-open and expiry leave uncertainty; expiry alone never proves non-broadcast', async t => {
  mockNode(t, { history: [], unspent: true })
  const leg = {
    attempt: 'open',
    signing: request,
    category: PUSD,
    sellSats: reviewed.sell.toString(),
    minOutput: reviewed.minOutput.toString(),
    routerFeeSats: '0',
    minerFeeSats: reviewed.minerFeeSats.toString()
  }
  const open = await recoverSecondSigning(forwardOp('second_leg_unknown', leg), request.sentAt + 1_000)
  assert.equal(open.stage, 'second_leg_unknown')
  assert.equal(open.error, OPEN_SECOND_REQUEST_NOTE)

  const expired = await recoverSecondSigning(forwardOp('second_leg_unknown', leg), request.sentAt + REQUEST_WAIT_MS + 1)
  assert.equal(expired.stage, 'bch_ready')
  assert.match(expired.error, /expired/)
  assert.equal(expired.secondLeg, undefined, 'patch must not clear the saved authorization; merge keeps it')
})

test('spent authorized inputs without a matching saved transaction stay uncertain', async t => {
  mockNode(t, { history: ['ff'.repeat(32)], unspent: false, raw: { ['ff'.repeat(32)]: reviewed.unsignedHex } })
  const recovery = await recoverSecondSigning(forwardOp('second_leg_unknown', {
    attempt: 'spent',
    signing: request,
    category: PUSD,
    sellSats: reviewed.sell.toString(),
    minOutput: reviewed.minOutput.toString(),
    routerFeeSats: '0',
    minerFeeSats: reviewed.minerFeeSats.toString()
  }), request.sentAt + REQUEST_WAIT_MS + 1)
  assert.equal(recovery.stage, 'second_leg_unknown')
  assert.match(recovery.error, /may have sent it|checking continues/i)
  assert.notEqual(recovery.stage, 'kept_bch')
  assert.notEqual(recovery.stage, 'bch_ready')
})

test('a missing saved authorization cannot safely request another signature', async () => {
  const recovery = await recoverSecondSigning(forwardOp('second_leg_unknown', {
    attempt: 'legacy',
    category: PUSD,
    sellSats: '1',
    minOutput: '1',
    routerFeeSats: '0',
    minerFeeSats: '1'
  }))
  assert.equal(recovery.stage, 'second_leg_unknown')
  assert.match(recovery.error, /was not saved/)
})

test('reverse recovery attaches a matched deposit without treating expiry as non-broadcast', async t => {
  mockNode(t, { history: [signedTxid], raw: { [signedTxid]: signedHex }, unspent: true })
  const deposit = {
    attempt: 'reverse',
    signing: request,
    amountSats: '900000',
    minerFeeSats: '600',
    memo: '=:b:synthetic:0',
    inboundAddress: 'bitcoincash:synthetic'
  }
  const op = {
    id: 'reverse-recovery',
    direction: 'reverse',
    stage: 'second_leg_unknown',
    binding,
    firstLeg: { result: 'swapped' },
    reverse: { buyAsset: 'BASE.USDC', destination: `0x${'12'.repeat(20)}`, deposit },
    updatedAt: 0
  }
  const matched = await recoverSecondSigning(op, request.sentAt + 1_000)
  assert.equal(matched.stage, 'second_leg_pending')
  assert.equal(matched.reverse.deposit.txid, signedTxid)
  assert.equal(matched.reverse.deposit.signedHex, signedHex)

  t.mock.restoreAll()
  mockNode(t, { history: [], unspent: true })
  const expired = await recoverSecondSigning(op, request.sentAt + REQUEST_WAIT_MS + 1)
  assert.equal(expired.stage, 'bch_ready')
  assert.match(expired.error, /expired/)
})
