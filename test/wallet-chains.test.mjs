import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chain, WalletOption } from '@tcswap/core'
import { supportedChains } from '../src/lib/wallets.ts'

test('Phantom is offered for Ethereum, Monad and Solana but not for Bitcoin, where its connector cannot send', () => {
  assert.deepEqual(supportedChains[WalletOption.PHANTOM], [Chain.Ethereum, Chain.Monad, Chain.Solana])
})
