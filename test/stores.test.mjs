// Restored browser state is rechecked against the bridge rules (crafted local storage).
import assert from 'node:assert/strict'
import { test } from 'node:test'

const storage = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k)
}

const { bindingFromPubkey } = await import('../src/lib/bch.ts')
const { pubkey, otherPubkey } = await import('./fixtures/bridge-fixtures.mjs')
const { transactionStore, getActiveBridge } = await import('../src/store/transaction-store.ts')
const { useSwapStore } = await import('../src/store/swap-store.ts')

const binding = bindingFromPubkey(pubkey, 0)
const other = bindingFromPubkey(otherPubkey, 0)
const op = (stage, b = binding) => ({ id: 'op', stage, binding: b, firstLeg: { result: 'pending' }, updatedAt: 0 })
const tx = bridge => ({ uid: 'u1', kind: 'swap', hash: undefined, status: 'pending', timestamp: new Date().toISOString(), bridge })

const restore = async transactions => {
  storage.set('tc-transactions', JSON.stringify({ state: { transactions }, version: 1 }))
  await transactionStore.persist.rehydrate()
  return transactionStore.getState().transactions[0]
}

test('a page closed while the wallet was signing the source swap restores as "unknown", never "not sent"', async () => {
  const restored = await restore([tx(op('first_leg_signing'))])
  assert.equal(restored.bridge.stage, 'first_leg_unknown')
  assert.equal(getActiveBridge()?.uid, 'u1', 'and it still blocks a new operation')
})

test('a restored operation whose binding no longer derives from its key is failed', async () => {
  const restored = await restore([tx(op('bch_ready', { ...binding, cashAddress: other.cashAddress }))])
  assert.equal(restored.bridge.stage, 'failed')
  assert.equal(restored.status, 'failed')
})

test('a valid in-flight operation is kept as it was', async () => {
  const restored = await restore([tx(op('bch_unconfirmed'))])
  assert.equal(restored.bridge.stage, 'bch_unconfirmed')
})

test('the tracker cannot move a bridge operation to completed', async () => {
  await restore([tx(op('first_leg_pending'))])
  transactionStore.getState().setTransactionStatus('u1', 'completed')
  assert.equal(transactionStore.getState().transactions[0].bridge.stage, 'first_leg_pending')
  assert.notEqual(transactionStore.getState().transactions[0].status, 'completed')
})

test('a crafted saved pair cannot make the buy side anything but BCH.BCH', async () => {
  const asset = identifier => ({ identifier, chain: identifier.split('.')[0], ticker: identifier.split('.')[1] })
  storage.set('tc-swap-store', JSON.stringify({ state: { assetFrom: asset('BCH.BCH'), assetTo: asset('ETH.ETH') }, version: 4 }))
  await useSwapStore.persist.rehydrate()
  assert.equal(useSwapStore.getState().assetFrom, undefined)
  assert.equal(useSwapStore.getState().assetTo, undefined)

  storage.set('tc-swap-store', JSON.stringify({ state: { assetFrom: asset('ETH.ETH'), assetTo: asset('BCH.BCH') }, version: 4 }))
  await useSwapStore.persist.rehydrate()
  assert.equal(useSwapStore.getState().assetFrom.identifier, 'ETH.ETH')
  assert.equal(useSwapStore.getState().assetTo.identifier, 'BCH.BCH')

  useSwapStore.getState().setAssetTo(asset('BTC.BTC'))
  assert.equal(useSwapStore.getState().assetTo.identifier, 'BCH.BCH')
  useSwapStore.getState().setAssetFrom(asset('BCH.BCH'))
  assert.equal(useSwapStore.getState().assetFrom.identifier, 'ETH.ETH')
})
