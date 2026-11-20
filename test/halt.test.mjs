import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chain } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import { isAssetHalted } from '../src/lib/swap-helpers.ts'

const baseUsdc = (providers) => ({
  chain: Chain.Base,
  chainId: '8453',
  decimals: 6,
  identifier: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913',
  name: 'USDC',
  ticker: 'USDC',
  providers
})

const halted = { HALTBASETRADING: 1 }
const clear = {}

test('THOR-only Base asset is halted when THORChain pauses Base', () => {
  assert.equal(isAssetHalted(baseUsdc([ProviderName.THORCHAIN]), halted, clear), true)
})

test('NEAR listing keeps Base selectable while THORChain alone is paused', () => {
  assert.equal(isAssetHalted(baseUsdc([ProviderName.THORCHAIN, ProviderName.NEAR]), halted, clear), false)
  assert.equal(isAssetHalted(baseUsdc([ProviderName.NEAR]), halted, clear), false)
})

test('no halt when THORChain is clear', () => {
  assert.equal(isAssetHalted(baseUsdc([ProviderName.THORCHAIN]), clear, clear), false)
})
