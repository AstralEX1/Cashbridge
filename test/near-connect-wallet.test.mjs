import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'
import { AssetValue, Chain } from '@tcswap/core'

// Only NEAR Connect is replaced: no wallet iframe, manifest download or transaction starts in these tests.
const near = {}
globalThis.nearConnectTest = near
registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@hot-labs/near-connect' ? { url: 'near-connect-test:connector', shortCircuit: true } : next(specifier, context)
  },
  load(url, context, next) {
    return url === 'near-connect-test:connector'
      ? { format: 'module', source: 'export class NearConnector { constructor() { return globalThis.nearConnectTest } }', shortCircuit: true }
      : next(url, context)
  }
})
let reloads = 0
globalThis.window = { location: { reload: () => reloads++ } }
const { nearconnectWallet, NEARCONNECT, isNearConnectDismissed } = await import('../src/lib/near-connect-wallet.ts')
let added
const connect = nearconnectWallet.connectNearConnect.connectWallet({ addChain: wallet => { added = wallet }, walletType: NEARCONNECT })

const wallet = {
  sent: [],
  getAccounts: async () => [{ accountId: 'alice.near' }],
  signAndSendTransaction: async params => {
    wallet.sent.push(params)
    return { transaction: { hash: `hash${wallet.sent.length}` } }
  }
}

beforeEach(() => {
  added = undefined
  reloads = 0
  wallet.sent = []
  Object.assign(near, {
    whenManifestLoaded: Promise.resolve(),
    session: undefined,
    picked: 0,
    listeners: new Set(),
    getConnectedWallet: async () => {
      if (!near.session) throw new Error('No wallet selected')
      return near.session
    },
    connect: async () => {
      near.picked++
      if (near.reject) throw new Error('User rejected')
      return wallet
    },
    disconnect: async () => {
      near.disconnected = true
      for (const listener of near.listeners) listener({})
    },
    on: (event, listener) => event === 'wallet:signOut' && near.listeners.add(listener),
    off: (event, listener) => near.listeners.delete(listener),
    reject: false,
    disconnected: false
  })
})

test('the picker opens only on a connect, and the account it signs in with is added', async () => {
  assert.equal(await connect([Chain.Near]), true)
  assert.equal(near.picked, 1)
  assert.equal(added.chain, Chain.Near)
  assert.equal(added.walletType, NEARCONNECT)
  assert.equal(added.address, 'alice.near')
})

test('a restore reuses the signed-in wallet and never opens the picker', async () => {
  await assert.rejects(connect([Chain.Near], { restoreOnly: true }), /No NEAR Connect session/)
  assert.equal(near.picked, 0)
  near.session = { wallet, accounts: [{ accountId: 'bob.near' }] }
  assert.equal(await connect([Chain.Near], { restoreOnly: true }), true)
  assert.equal(near.picked, 0)
  assert.equal(added.address, 'bob.near')
})

test('closing the picker is a cancel', async () => {
  near.reject = true
  await assert.rejects(connect([Chain.Near]), isNearConnectDismissed)
  assert.equal(added, undefined)
})

test('native NEAR goes out as one Transfer action from the connected account', async () => {
  await connect([Chain.Near])
  const assetValue = AssetValue.from({ asset: 'NEAR.NEAR', value: '1.5' })
  assert.equal(await added.transfer({ assetValue, recipient: 'deposit.near' }), 'hash1')
  assert.deepEqual(wallet.sent, [
    { receiverId: 'deposit.near', signerId: 'alice.near', actions: [{ type: 'Transfer', params: { deposit: '1500000000000000000000000' } }] }
  ])
})

test('a token registers the receiver, then sends ft_transfer with one yoctoNEAR', async () => {
  await connect([Chain.Near])
  const assetValue = AssetValue.from({ asset: 'NEAR.USDC-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', value: '2', fromBaseDecimal: 6 })
  await added.transfer({ assetValue, recipient: 'deposit.near' })
  const [tx] = wallet.sent
  assert.equal(tx.receiverId, '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')
  assert.deepEqual(
    tx.actions.map(a => [a.params.methodName, a.params.deposit]),
    [['storage_deposit', '1250000000000000000000'], ['ft_transfer', '1']]
  )
  assert.deepEqual(tx.actions[0].params.args, { account_id: 'deposit.near', registration_only: true })
  assert.equal(tx.actions[1].params.args.receiver_id, 'deposit.near')
})

test("the swap plugin's NEP-141 deposit is sent as the contract call it asked for", async () => {
  await connect([Chain.Near])
  const unsigned = await added.createContractFunctionCall({
    args: { receiver_id: 'intents.near', amount: '100', msg: '{}' },
    attachedDeposit: '1',
    contractId: 'usdt.tether-token.near',
    gas: '250000000000000',
    methodName: 'ft_transfer_call',
    sender: 'alice.near'
  })
  assert.equal(await added.signAndSendTransaction(unsigned), 'hash1')
  assert.deepEqual(wallet.sent[0], {
    receiverId: 'usdt.tether-token.near',
    signerId: 'alice.near',
    actions: [{ type: 'FunctionCall', params: { methodName: 'ft_transfer_call', args: { receiver_id: 'intents.near', amount: '100', msg: '{}' }, gas: '250000000000000', deposit: '1' } }]
  })
})

test('a sign-out from the wallet reloads; our own disconnect does not', async () => {
  await connect([Chain.Near])
  added.disconnect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(near.disconnected, true)
  assert.equal(reloads, 0)
  await connect([Chain.Near])
  for (const listener of near.listeners) listener({})
  assert.equal(reloads, 1)
})
