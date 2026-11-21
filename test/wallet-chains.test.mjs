import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chain, WalletOption } from '@tcswap/core'

import { getWallets } from '@mysten/wallet-standard'
import { getAccounts, RESTORE_ONLY, supportedChains } from '../src/lib/wallets.ts'
import { NIGHTLY, SLUSH, SUIET } from '../src/lib/sui-wallet.ts'
import { BACKPACK, SOLFLARE } from '../src/lib/solana-wallet.ts'

// Loaded as on a server; the window appears afterwards, so the connectors can look for the wallets registered below.
globalThis.window = Object.assign(new EventTarget(), { location: { origin: 'http://localhost', reload: () => {} } })

test('Phantom is offered for Ethereum, Monad and Solana but not for Bitcoin, where its connector cannot send', () => {
  assert.deepEqual(supportedChains[WalletOption.PHANTOM], [Chain.Ethereum, Chain.Monad, Chain.Solana])
})

test('TON Connect is offered for TON and restores without a wallet prompt', () => {
  assert.deepEqual(supportedChains.TONCONNECT, [Chain.Ton])
  assert.equal(RESTORE_ONLY.has('TONCONNECT'), true)
})

test('Sui and Solana extension wallets restore from an earlier grant only', () => {
  for (const option of [SLUSH, SUIET]) assert.deepEqual(supportedChains[option], [Chain.Sui])
  for (const option of [SOLFLARE, BACKPACK]) assert.deepEqual(supportedChains[option], [Chain.Solana])
  assert.deepEqual(supportedChains[NIGHTLY], [Chain.Sui, Chain.Solana])
  for (const option of [SLUSH, SUIET, NIGHTLY, SOLFLARE, BACKPACK]) assert.equal(RESTORE_ONLY.has(option), true)
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
