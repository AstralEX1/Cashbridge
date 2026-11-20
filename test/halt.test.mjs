import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chain } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import { isAssetHalted, thorchainPayoutsHalted } from '../src/lib/swap-helpers.ts'

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

test('THOR-only free-pair halt checks preserve the canonical NEAR bridge fallback', () => {
  const asset = baseUsdc([ProviderName.THORCHAIN, ProviderName.NEAR])
  assert.equal(isAssetHalted({ ...asset, providers: [ProviderName.THORCHAIN] }, halted, clear), true)
  assert.equal(isAssetHalted(asset, halted, clear), false)
  assert.deepEqual(asset.providers, [ProviderName.THORCHAIN, ProviderName.NEAR])
})

test('a signing or outbound halt on either end holds THORChain payouts', () => {
  assert.equal(thorchainPayoutsHalted({ HALTSIGNINGBCH: 1 }, ['BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', 'BCH.BCH']), true)
  assert.equal(thorchainPayoutsHalted({ HALTOUTBOUNDBASE: 1 }, ['BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', 'BCH.BCH']), true)
  assert.equal(thorchainPayoutsHalted({ HALTOUTBOUND: 1 }, ['ETH.ETH', 'BCH.BCH']), true)
  assert.equal(thorchainPayoutsHalted({ HALTSIGNINGETH: 1, HALTBASETRADING: 1 }, ['BASE.ETH', 'BCH.BCH']), false)
  assert.equal(thorchainPayoutsHalted({ HALTSIGNINGBTC: 0 }, ['BTC.BTC', undefined]), false)
})
