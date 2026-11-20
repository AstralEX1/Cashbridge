import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Chain } from '@tcswap/core'

// A Wallet Standard wallet registered in the real registry: no extension, transaction or network call starts here.
let reloads = 0
globalThis.window = Object.assign(new EventTarget(), { location: { reload: () => reloads++ } })
const { getWallets } = await import('@mysten/wallet-standard')
const { slushWallet, SLUSH, findSlush } = await import('../src/lib/sui-wallet.ts')
let added
const connect = slushWallet.connectSlush.connectWallet({ addChain: wallet => { added = wallet }, walletType: SLUSH })

const ACCOUNT = { address: `0x${'ab'.repeat(32)}`, chains: ['sui:mainnet'], features: [], publicKey: new Uint8Array(32) }
const slush = {
  name: 'Slush',
  version: '1.0.0',
  icon: 'data:image/svg+xml,',
  chains: ['sui:mainnet'],
  accounts: [],
  calls: [],
  listeners: new Set(),
  features: {
    'standard:connect': {
      version: '1.0.0',
      connect: async ({ silent } = {}) => {
        slush.calls.push(silent ? 'silent' : 'prompt')
        return { accounts: silent && !slush.granted ? [] : [ACCOUNT] }
      }
    },
    'standard:events': {
      version: '1.0.0',
      on: (_event, listener) => {
        slush.listeners.add(listener)
        return () => slush.listeners.delete(listener)
      }
    },
    'standard:disconnect': { version: '1.0.0', disconnect: async () => { slush.calls.push('disconnect') } }
  }
}
getWallets().register(slush)

beforeEach(() => {
  added = undefined
  reloads = 0
  slush.calls = []
  slush.granted = false
  slush.listeners.clear()
})

test('Slush is found in the Wallet Standard registry and connects its Sui mainnet account', async () => {
  assert.equal(findSlush()?.name, 'Slush')
  assert.equal(await connect([Chain.Sui]), true)
  assert.deepEqual(slush.calls, ['prompt'])
  assert.equal(added.chain, Chain.Sui)
  assert.equal(added.walletType, SLUSH)
  assert.equal(added.address, ACCOUNT.address)
  assert.equal(added.validateAddress(ACCOUNT.address), true)
})

test('a restore connects silently and never prompts', async () => {
  await assert.rejects(connect([Chain.Sui], { restoreOnly: true }), /no Sui account/)
  slush.granted = true
  assert.equal(await connect([Chain.Sui], { restoreOnly: true }), true)
  assert.deepEqual(slush.calls, ['silent', 'silent'])
})

test('an account switch in the wallet reloads; our own disconnect stops listening', async () => {
  await connect([Chain.Sui])
  for (const listener of slush.listeners) listener({ accounts: [{ ...ACCOUNT, address: `0x${'cd'.repeat(32)}` }] })
  assert.equal(reloads, 1)
  added.disconnect()
  assert.equal(slush.listeners.size, 0)
  assert.deepEqual(slush.calls, ['prompt', 'disconnect'])
  await assert.rejects(connect([Chain.Ethereum]), /only supports Sui/)
})
