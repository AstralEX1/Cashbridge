import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chain, WalletOption } from '@tcswap/core'

import { getWallets } from '@mysten/wallet-standard'
import { getAccounts, RESTORE_ONLY, supportedChains } from '../src/lib/wallets.ts'
import { NIGHTLY, SLUSH, SUIET } from '../src/lib/sui-wallet.ts'
import { BACKPACK, SOLFLARE } from '../src/lib/solana-wallet.ts'
import { LEATHER, UNISAT } from '../src/lib/bitcoin-wallets.ts'

// Loaded as on a server; the window appears afterwards, so the connectors can look for the wallets registered below.
globalThis.window = Object.assign(new EventTarget(), { location: { origin: 'http://localhost', reload: () => {} } })

test('Phantom is offered for Ethereum and Solana: not for Bitcoin, where its connector cannot send, nor Monad, which Phantom dropped', () => {
  assert.deepEqual(supportedChains[WalletOption.PHANTOM], [Chain.Ethereum, Chain.Solana])
})

test('a wallet connection saved on a chain no longer offered for it does not come back there', async () => {
  const asked = []
  window.phantom = { ethereum: { request: async ({ method }) => (asked.push(method), ['0x702570b16d6A5bB2a9AbF4872710b3925D379709']) } }
  assert.deepEqual(await getAccounts(WalletOption.PHANTOM, [Chain.Monad]), [])
  assert.deepEqual(asked, [], 'Phantom is never asked for a Monad account')
  delete window.phantom
})

test('hardware wallets are offered only on the chains their connect steps carry a path for, and not on Zcash', () => {
  for (const option of [WalletOption.LEDGER, WalletOption.TREZOR]) {
    for (const chain of [Chain.Zcash, Chain.Near, Chain.Optimism, Chain.Polygon, Chain.Monad])
      assert.equal(supportedChains[option].includes(chain), false, `${option} ${chain}`)
    for (const chain of [Chain.Ethereum, Chain.Base, Chain.Bitcoin, Chain.Litecoin, Chain.Dogecoin])
      assert.equal(supportedChains[option].includes(chain), true, `${option} ${chain}`)
  }
  for (const chain of [Chain.Ripple, Chain.Tron, Chain.Cosmos, Chain.THORChain])
    assert.equal(supportedChains[WalletOption.LEDGER].includes(chain), true)
})

test('WalletConnect is not offered on NEAR, where its signer returns no real signature', () => {
  assert.equal(supportedChains[WalletOption.WALLETCONNECT].includes(Chain.Near), false)
  assert.equal(supportedChains[WalletOption.WALLETCONNECT].includes(Chain.Ethereum), true)
})

test('multi-chain extensions are offered only for the chains their connectors can send on', () => {
  for (const chain of [Chain.Solana, Chain.Cosmos]) assert.equal(supportedChains[WalletOption.BITGET].includes(chain), false)
  assert.equal(supportedChains[WalletOption.BITGET].includes(Chain.Bitcoin), true)
  for (const chain of [Chain.Bitcoin, Chain.Solana]) assert.equal(supportedChains[WalletOption.ONEKEY].includes(chain), false)
  assert.equal(supportedChains[WalletOption.ONEKEY].includes(Chain.Sui), true)
  assert.equal(supportedChains[WalletOption.COSMOSTATION].includes(Chain.Ethereum), false)
  assert.equal(supportedChains[WalletOption.COSMOSTATION].includes(Chain.Cosmos), true)
})

test('TON Connect is offered for TON and restores without a wallet prompt', () => {
  assert.deepEqual(supportedChains.TONCONNECT, [Chain.Ton])
  assert.equal(RESTORE_ONLY.has('TONCONNECT'), true)
})

test('Sui, Solana and Bitcoin extension wallets restore from an earlier grant only', () => {
  for (const option of [SLUSH, SUIET]) assert.deepEqual(supportedChains[option], [Chain.Sui])
  for (const option of [SOLFLARE, BACKPACK]) assert.deepEqual(supportedChains[option], [Chain.Solana])
  for (const option of [UNISAT, LEATHER]) assert.deepEqual(supportedChains[option], [Chain.Bitcoin])
  assert.deepEqual(supportedChains[NIGHTLY], [Chain.Sui, Chain.Solana])
  for (const option of [SLUSH, SUIET, NIGHTLY, SOLFLARE, BACKPACK, UNISAT, LEATHER]) assert.equal(RESTORE_ONLY.has(option), true)
})

test('one wallet row connects its Sui and Solana accounts through the Wallet Standard, each filed under that row', async () => {
  const calls = []
  const account = (address, chain, features) => ({ address, chains: [chain], features, publicKey: new Uint8Array(32).fill(1) })
  const nightly = (chain, address, sign) => ({
    name: 'Nightly',
    version: '1.0.0',
    icon: 'data:image/svg+xml,',
    chains: [chain],
    accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => (calls.push(chain), { accounts: [account(address, chain, Object.keys(sign))] }) },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      ...sign
    }
  })
  const suiSign = { 'sui:signAndExecuteTransaction': { version: '2.0.0', signAndExecuteTransaction: async () => ({}) } }
  const solanaSign = { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async () => [] } }
  const solanaAddress = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'
  getWallets().register(nightly('sui:mainnet', `0x${'ef'.repeat(32)}`, suiSign), nightly('solana:mainnet', solanaAddress, solanaSign))

  const accounts = await getAccounts(NIGHTLY, [Chain.Sui, Chain.Solana])
  // Sui first, then Solana: one wallet prompt at a time.
  assert.deepEqual(calls, ['sui:mainnet', 'solana:mainnet'])
  assert.deepEqual(accounts, [
    { address: `0x${'ef'.repeat(32)}`, network: Chain.Sui, provider: NIGHTLY },
    { address: solanaAddress, network: Chain.Solana, provider: NIGHTLY }
  ])
})
