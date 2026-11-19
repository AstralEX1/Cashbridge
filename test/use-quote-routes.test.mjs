// Route compare + NEAR first-leg quoting contracts for CashToken destinations.
// Run: npm run test:bridge (or node --test this file with the TS alias register).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BridgeConfig } from '../src/config.ts'
import { bestRoute } from '../src/hooks/use-quote.ts'
import { nearQuoteBody, NEAR_BCH } from '../src/lib/near-intents.ts'

const quoteSource = readFileSync(new URL('../src/hooks/use-quote.ts', import.meta.url), 'utf8')
const compareSource = readFileSync(new URL('../src/components/swap/route-compare.tsx', import.meta.url), 'utf8')
const flowToastsSource = readFileSync(new URL('../src/components/swap/flow-toasts.tsx', import.meta.url), 'utf8')
const pusdSource = readFileSync(new URL('../src/components/swap/pusd-swap.tsx', import.meta.url), 'utf8')

const usdc = {
  assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
  contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
}
const bch = { assetId: NEAR_BCH, decimals: 8, blockchain: 'bch', symbol: 'BCH', price: 200, contractAddress: null }

test('forward quotes always buy native BCH.BCH (CashToken is a later Cauldron leg)', () => {
  assert.equal(BridgeConfig.buyAsset, 'BCH.BCH')
  assert.match(quoteSource, /buyAsset = reverse \? assetFrom\?\.identifier : BridgeConfig\.buyAsset/)
  assert.match(quoteSource, /buyAsset: reverse \? buyAsset : BridgeConfig\.buyAsset/)
  const body = nearQuoteBody(
    { sellAsset: 'BASE.USDC-0X8335', buyAsset: BridgeConfig.buyAsset, sellAmount: '10', dry: true, slippageBps: 100, now: 0 },
    usdc,
    bch
  )
  assert.equal(body.destinationAsset, NEAR_BCH)
  assert.equal(body.originAsset, usdc.assetId)
})

test('routes stay visible while refetching; RouteCompare does not require a successful NEAR quote', () => {
  assert.match(quoteSource, /routes: error \? undefined : routes/)
  assert.doesNotMatch(compareSource, /if \(!routes\?\.near\) return null/)
  assert.match(compareSource, /nearAllowed/)
  assert.match(compareSource, /amountSet/)
  assert.match(compareSource, /ThorchainMark/)
  assert.match(compareSource, /NearMark/)
})

test('leaving a tracking flow keeps toasts via persist + background owner', () => {
  assert.match(flowToastsSource, /persist\?: boolean/)
  assert.match(pusdSource, /BackgroundBridgeToasts/)
  assert.match(pusdSource, /persistToasts: !terminal/)
})

test('bestRoute still prefers the higher payout and THORChain on a tie', () => {
  const thor = { expectedBuyAmount: '1' }
  assert.equal(bestRoute({ thorchain: thor, near: { expectedBuyAmount: '1.1' } }), 'near')
  assert.equal(bestRoute({ thorchain: thor, near: { expectedBuyAmount: '1' } }), 'thorchain')
  assert.equal(bestRoute({ thorchain: thor }), 'thorchain')
  assert.equal(bestRoute({ near: { expectedBuyAmount: '2' } }), 'near')
})
