// This browser's saved transfers in the scanner's wallet search: drafts and unsent requests never show.
import assert from 'node:assert/strict'
import { test } from 'node:test'

const storage = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  key: () => null,
  length: 0
}

const { bindingFromPubkey } = await import('../src/lib/bch.ts')
const { pubkey, otherPubkey } = await import('./fixtures/bridge-fixtures.mjs')
const { bchForms, localRows, localWallets, rowFromSavedOrder, rowFromTransaction, sameWallet } = await import('../src/lib/local-scan.ts')

const binding = bindingFromPubkey(pubkey, 0)
const other = bindingFromPubkey(otherPubkey, 0)
const evm = `0x${'aB'.repeat(20)}`
const usdc = { chain: 'BASE', ticker: 'USDC', identifier: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', decimals: 6 }
const bch = { chain: 'BCH', ticker: 'BCH', identifier: 'BCH.BCH', decimals: 8 }

const bridgeTx = (stage, extra = {}) => ({
  uid: `tx-${stage}`,
  provider: 'THORCHAIN',
  timestamp: '2030-01-01T00:00:00Z',
  assetFrom: usdc,
  assetTo: bch,
  amountFrom: '5',
  amountTo: '0.0123',
  addressFrom: evm,
  addressTo: binding.cashAddress,
  status: stage === 'completed' ? 'completed' : 'pending',
  bridge: { id: 'op', stage, binding, destinationAsset: 'BCH', firstLeg: { result: 'pending' }, updatedAt: 0 },
  ...extra
})

const savedOrder = (extra = {}, orderExtra = {}) => ({
  id: 'order-1',
  capability: 'cd'.repeat(32),
  intent: { recipientAddress: binding.tokenAddress, refundAddress: binding.cashAddress, expectedBchSats: '1000000' },
  order: {
    id: 'order-1',
    recipientAddress: binding.tokenAddress,
    refundAddress: binding.cashAddress,
    expectedBchSats: '1000000',
    depositAddress: other.cashAddress,
    minPusd: '980',
    maxWaitSeconds: 3600,
    state: 'awaiting_deposit',
    createdAt: 1000,
    updatedAt: 1000,
    receivedSats: '0',
    attempts: [],
    source: { chain: 'BASE', asset: usdc.identifier, amount: '5', address: evm },
    ...orderExtra
  },
  ...extra
})

test('one wallet in any spelling: EVM in any case, BCH with or without prefix, token-aware or not', () => {
  assert.ok(sameWallet(evm, evm.toLowerCase()))
  assert.ok(sameWallet(binding.cashAddress, binding.tokenAddress.split(':')[1]))
  assert.equal(sameWallet(binding.cashAddress, other.cashAddress), false)
  assert.equal(sameWallet('', binding.cashAddress), false)
  assert.deepEqual(bchForms(binding.tokenAddress), [binding.cashAddress.split(':')[1], binding.tokenAddress.split(':')[1]])
  assert.deepEqual(bchForms(evm), [])
})

test('a saved transfer is a row only once a chain has it', () => {
  assert.equal(rowFromTransaction(bridgeTx('first_leg_signing')), undefined, 'the wallet was opened, nothing sent')
  assert.equal(rowFromTransaction({ ...bridgeTx('first_leg_unknown'), status: 'unknown' }), undefined)
  const unpaid = { uid: 'qr', provider: 'NEAR', timestamp: '2030-01-01T00:00:00Z', assetFrom: usdc, assetTo: bch, amountFrom: '5', amountTo: '1', addressTo: binding.cashAddress, status: 'not_started', qrCodeData: 'data:' }
  assert.equal(rowFromTransaction(unpaid), undefined, 'a deposit address nobody paid')
  const quoted = { ...bridgeTx('first_leg_signing'), bridge: { ...bridgeTx('first_leg_signing').bridge, near: { depositAddress: 'ff'.repeat(32) } } }
  assert.equal(rowFromTransaction(quoted), undefined, 'a NEAR Intents deposit address alone is not a sent transaction')
  assert.deepEqual(rowFromTransaction({ ...quoted, hash: 'ab'.repeat(32) }).legs.map(leg => leg.label), ['Base deposit', 'NEAR Intents swap'])

  const sent = rowFromTransaction({ ...bridgeTx('first_leg_pending'), hash: 'ab'.repeat(32) })
  assert.deepEqual(sent.legs.map(leg => leg.label), ['Base deposit', 'THORChain swap'])
  assert.deepEqual([sent.status, sent.from.amount, sent.to.ticker, sent.router], ['pending', '5', 'BCH', false])

  const kept = rowFromTransaction({
    ...bridgeTx('kept_bch', { status: 'completed' }),
    hash: 'ab'.repeat(32),
    bridge: { ...bridgeTx('kept_bch').bridge, received: [{ txid: 'cd'.repeat(32), vout: 0, value: '1230000', confirmations: 1, unspent: true }] }
  })
  assert.deepEqual([kept.status, kept.to.ticker, kept.to.amount], ['completed', 'BCH', '0.0123'])
  assert.deepEqual(kept.legs.map(leg => leg.label), ['Base deposit', 'THORChain swap', 'BCH received'])
})

test('a saved Router order shows once something is sent to it; a draft never does', () => {
  assert.equal(rowFromSavedOrder(savedOrder()), undefined, 'a draft')
  assert.equal(rowFromSavedOrder(savedOrder({ sourceAttempted: true })), undefined, 'the wallet opened, no hash yet')
  assert.equal(rowFromSavedOrder(savedOrder({ sourceAttempted: true }, { state: 'expired' })), undefined, 'expired unpaid')
  assert.ok(rowFromSavedOrder(savedOrder({}, { inboundHash: 'cd'.repeat(32), state: 'streaming' })), 'paid from another wallet')
  const row = rowFromSavedOrder(savedOrder({}, { sourceHash: 'ab'.repeat(32), state: 'streaming' }))
  assert.deepEqual([row.router, row.status, row.from.ticker], [true, 'pending', 'USDC'])
  assert.equal(row.legs[0].label, 'Base deposit')
})

test("a wallet's local rows: matched by any address of the transfer, drafts left out", () => {
  const sent = { ...bridgeTx('first_leg_pending'), hash: 'ab'.repeat(32) }
  const orders = [savedOrder({ id: 'draft' }), savedOrder({ id: 'paid' }, { sourceHash: 'ef'.repeat(32), state: 'streaming' })]
  assert.equal(localRows(binding.tokenAddress, [sent, bridgeTx('first_leg_signing')], orders).length, 2)
  assert.equal(localRows(evm.toLowerCase(), [sent], []).length, 1)
  assert.equal(localRows(other.cashAddress, [sent], orders).length, 0)
  const wallets = localWallets([sent], orders)
  assert.ok(wallets.some(w => sameWallet(w.address, binding.cashAddress) && w.chain === 'BCH'))
  assert.ok(wallets.some(w => w.address === evm && w.chain === 'BASE'))
  assert.equal(wallets.length, 2, 'each wallet once')
})
