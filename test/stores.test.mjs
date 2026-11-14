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

test('a source swap the wallet declines leaves no operation behind; any other wallet error stays "unknown"', async () => {
  const { startBridgeFirstLeg, FirstLegRejected } = await import('../src/lib/bridge-first-leg.ts')
  const base = { provider: 'THORCHAIN', chainId: '8453', timestamp: new Date(), assetFrom: {}, assetTo: {}, amountFrom: '0.001', amountTo: '0.007', addressTo: binding.cashAddress }
  const declined = Object.assign(new Error('user rejected action (action="sendTransaction")'), { code: 'ACTION_REJECTED', info: { error: { code: 4001 } } })

  await restore([])
  await assert.rejects(startBridgeFirstLeg({ base, binding, execute: async () => { throw declined } }), FirstLegRejected)
  assert.deepEqual(transactionStore.getState().transactions, [])
  assert.equal(getActiveBridge(), undefined)
  assert.deepEqual(JSON.parse(storage.get('tc-transactions')).state.transactions, [])

  // A wallet that broke after maybe broadcasting is not a rejection: that operation is kept for the user.
  await assert.rejects(startBridgeFirstLeg({ base, binding, execute: async () => { throw new Error('Request timed out') } }), /timed out/)
  const [kept] = transactionStore.getState().transactions
  assert.equal(kept.bridge.stage, 'first_leg_unknown')
  await restore([])
})

test('wallet rejections are recognised in the shapes wallets and ethers report them', async () => {
  const { isUserRejection } = await import('../src/lib/errors.ts')
  assert.equal(isUserRejection({ code: 4001, message: 'User rejected the request.' }), true)
  assert.equal(isUserRejection({ code: 'ACTION_REJECTED' }), true)
  assert.equal(isUserRejection(new Error('MetaMask Tx Signature: User denied transaction signature.')), true)
  assert.equal(isUserRejection({ message: 'wrapped', cause: { code: 4001 } }), true)
  assert.equal(isUserRejection(new Error('insufficient funds for gas')), false)
  assert.equal(isUserRejection(undefined), false)
})

test('a completed PUSD swap never carries the "spent by a different transaction" error', async () => {
  // A record an older version left completed with a stale error heals on load.
  const healed = await restore([tx({ ...op('completed'), destinationAsset: 'PUSD', error: 'The BCH was spent by a different transaction; the PUSD swap did not happen' })])
  assert.equal(healed.bridge.stage, 'completed')
  assert.equal(healed.bridge.error, undefined)

  // Completing an operation that had an error clears it.
  await restore([tx({ ...op('second_leg_pending'), error: 'The BCH was spent by a different transaction; the PUSD swap did not happen' })])
  transactionStore.getState().updateBridge('u1', () => ({ stage: 'completed' }))
  assert.equal(transactionStore.getState().transactions[0].bridge.error, undefined)

  // A failure that is not a completion keeps its reason.
  transactionStore.getState().updateBridge('u1', () => ({ stage: 'failed', error: 'genuinely foreign spender' }))
  assert.equal(transactionStore.getState().transactions[0].bridge.error, 'genuinely foreign spender')
  await restore([])
})
