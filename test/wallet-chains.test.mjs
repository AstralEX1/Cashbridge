import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chain, WalletOption } from '@tcswap/core'
import { RESTORE_ONLY, supportedChains } from '../src/lib/wallets.ts'

test('Phantom is offered for Ethereum, Monad and Solana but not for Bitcoin, where its connector cannot send', () => {
  assert.deepEqual(supportedChains[WalletOption.PHANTOM], [Chain.Ethereum, Chain.Monad, Chain.Solana])
})

test('TON Connect is offered for TON and restores without a wallet prompt', () => {
  assert.deepEqual(supportedChains.TONCONNECT, [Chain.Ton])
  assert.equal(RESTORE_ONLY.has('TONCONNECT'), true)
})
