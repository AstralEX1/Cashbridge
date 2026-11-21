import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Chain, WalletOption } from '@tcswap/core'

// Wallet Standard wallets registered in the real registry: no extension, transaction or network call starts here.
let reloads = 0
globalThis.window = Object.assign(new EventTarget(), { location: { origin: 'http://localhost', reload: () => reloads++ } })
const { getWallets } = await import('@mysten/wallet-standard')
const { suiWallet, SLUSH, SUIET, NIGHTLY, findSuiWallet } = await import('../src/lib/sui-wallet.ts')
let added
const connect = suiWallet.connectSuiWallet.connectWallet({ addChain: wallet => { added = wallet } })

const ACCOUNT = { address: `0x${'ab'.repeat(32)}`, chains: ['sui:mainnet'], features: [], publicKey: new Uint8Array(32) }
const standardWallet = (name, chains = ['sui:mainnet'], id) => {
  const wallet = {
    ...(id && { id }),
    name,
    version: '1.0.0',
    icon: 'data:image/svg+xml,',
    chains,
    accounts: [],
    calls: [],
    granted: false,
    listeners: new Set(),
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async ({ silent } = {}) => {
          wallet.calls.push(silent ? 'silent' : 'prompt')
          return { accounts: silent && !wallet.granted ? [] : [ACCOUNT] }
        }
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event, listener) => {
          wallet.listeners.add(listener)
          return () => wallet.listeners.delete(listener)
        }
      },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { wallet.calls.push('disconnect') } },
      'sui:signAndExecuteTransaction': { version: '2.0.0', signAndExecuteTransaction: async () => ({ digest: 'digest' }) }
    }
  }
  return wallet
}
// A look-alike under Slush's name registers first; Slush itself carries its id. Phantom here only for Solana.
const lookalike = standardWallet('Slush')
const slush = standardWallet('Slush', ['sui:mainnet'], 'com.mystenlabs.suiwallet')
const suiet = standardWallet('Suiet')
const noSigner = standardWallet('Nightly')
delete noSigner.features['sui:signAndExecuteTransaction']
getWallets().register(lookalike, slush, suiet, noSigner, standardWallet('Phantom', ['solana:mainnet']))

beforeEach(() => {
  added = undefined
  reloads = 0
  for (const wallet of [slush, suiet]) {
    wallet.accounts = []
    wallet.calls = []
    wallet.granted = false
    wallet.listeners.clear()
  }
})

test('each Sui wallet is found by its id or name, only when it signs on Sui mainnet', () => {
  assert.equal(findSuiWallet(SLUSH), slush)
  assert.equal(findSuiWallet(SUIET), suiet)
  assert.equal(findSuiWallet(NIGHTLY), undefined)
  assert.equal(findSuiWallet(WalletOption.PHANTOM), undefined)
  assert.equal(findSuiWallet(WalletOption.METAMASK), undefined)
})

test('a connect files the Sui mainnet account under the wallet the user picked', async () => {
  assert.equal(await connect([Chain.Sui], { walletType: SUIET }), true)
  assert.deepEqual(suiet.calls, ['prompt'])
  assert.deepEqual(slush.calls, [])
  assert.equal(added.chain, Chain.Sui)
  assert.equal(added.walletType, SUIET)
  assert.equal(added.address, ACCOUNT.address)
  assert.equal(added.validateAddress(ACCOUNT.address), true)

  await connect([Chain.Sui])
  assert.equal(added.walletType, SLUSH)
})

test('a restore takes the accounts the wallet already lists, else connects silently, and never prompts', async () => {
  await assert.rejects(connect([Chain.Sui], { restoreOnly: true }), /no Sui mainnet account/)
  slush.granted = true
  assert.equal(await connect([Chain.Sui], { restoreOnly: true }), true)
  assert.deepEqual(slush.calls, ['silent', 'silent'])

  slush.calls = []
  slush.accounts = [ACCOUNT]
  assert.equal(await connect([Chain.Sui], { restoreOnly: true }), true)
  assert.equal(added.address, ACCOUNT.address)
  assert.deepEqual(slush.calls, [])
})

test('a missing wallet or another chain is refused by name', async () => {
  await assert.rejects(connect([Chain.Sui], { walletType: NIGHTLY }), /Nightly with Sui is not installed/)
  await assert.rejects(connect([Chain.Sui], { walletType: WalletOption.METAMASK }), /This wallet with Sui is not installed/)
  await assert.rejects(connect([Chain.Ethereum], { walletType: SUIET }), /Suiet connects only Sui/)
})

test('an account switch in the wallet reloads; our own disconnect stops listening', async () => {
  await connect([Chain.Sui])
  for (const listener of slush.listeners) listener({ accounts: [{ ...ACCOUNT, address: `0x${'cd'.repeat(32)}` }] })
  assert.equal(reloads, 1)
  added.disconnect()
  assert.equal(slush.listeners.size, 0)
  assert.deepEqual(slush.calls, ['prompt', 'disconnect'])
})
