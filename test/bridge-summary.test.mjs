import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { bridgeSummary, formatPercent, valueImpact } from '../src/lib/bridge-summary.ts'
import { BridgePriceImpact } from '../src/components/swap/price-impact.tsx'
import { torPoolPrices } from '../src/lib/thorchain-api.ts'

const messages = JSON.parse(readFileSync(new URL('../src/i18n/messages/en.json', import.meta.url), 'utf8'))
const renderImpact = percent => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en', timeZone: 'UTC', messages }, createElement(BridgePriceImpact, { percent })))

test('the route percentage includes Cauldron instead of the THORChain-only 0.24%', () => {
  const thorchain = { sent: 100, sentUsd: 100, bch: 0.9976, bchUsd: 100 }
  const firstLeg = bridgeSummary(thorchain)
  const fullRoute = bridgeSummary({
    ...thorchain,
    pusd: { output: 98, spotOutput: 99.76, sell: 0.9976, tradeFee: 0.0029928 }
  })
  assert.equal(formatPercent(firstLeg.impactPercent), '−0.24%')
  assert.equal(formatPercent(fullRoute.impactPercent), '−2.00%')
  assert.match(renderImpact(fullRoute.impactPercent), /−2\.00%/)
  assert.doesNotMatch(renderImpact(fullRoute.impactPercent), /0\.24%/)
})

test('forward route impact preserves BCH change and treats miner fees as gas', () => {
  const summary = bridgeSummary({
    sent: 100, sentUsd: 100, bch: 1, bchUsd: 100,
    pusd: { output: 97, spotOutput: 99, sell: 0.99, tradeFee: 0.003, minerFee: 0.001 }
  })
  assert.equal(summary.receivedUsd, 97)
  assert.equal(summary.bchGasUsd, 0.1)
  assert.equal(formatPercent(summary.impactPercent), '−2.00%')
})

test('reverse route impact values the token at spot before either swap', () => {
  const bchUsd = 400
  const sale = { spotOutput: 25_000_000, output: 24_500_000n }
  const receivedUsd = 97
  const impact = valueImpact((sale.spotOutput / 1e8) * bchUsd, receivedUsd)
  assert.equal(impact.impactUsd, -3)
  assert.equal(formatPercent(impact.impactPercent), '−3.00%')
  assert.notEqual(impact.impactPercent, valueImpact((Number(sale.output) / 1e8) * bchUsd, receivedUsd).impactPercent)
})

test('missing, non-finite or zero input value cannot produce a route percentage', () => {
  for (const [sent, received] of [[undefined, 99], [100, undefined], [NaN, 99], [100, Infinity], [0, 99], [-1, 99]]) {
    const impact = valueImpact(sent, received)
    assert.equal(impact.impactUsd, undefined)
    assert.equal(impact.impactPercent, undefined)
    assert.equal(renderImpact(impact.impactPercent), '')
  }
  assert.equal(bridgeSummary({ sent: 100, bch: 1 }).impactPercent, undefined)
  assert.equal(renderImpact(NaN), '')
  assert.equal(renderImpact(Infinity), '')
})

test('the form uses the same signed formatting as Confirm for gains, zero and losses', () => {
  for (const [sent, received] of [[100, 101], [100, 100], [100, 99.76], [100, 85], [100, 70]]) {
    const { impactPercent } = valueImpact(sent, received)
    assert.ok(renderImpact(impactPercent).includes(formatPercent(impactPercent)))
  }
  assert.match(renderImpact(0), />0\.00%</)
  assert.match(renderImpact(1), />\+1\.00%</)
  assert.match(renderImpact(-15), /text-jacob/)
  assert.match(renderImpact(-30), /text-lucian/)
})

test('USD prices come from THORNode TOR prices, not drifted Midgard depths', () => {
  // Live 2026-11-19: Midgard priced ETH.USDT at $0.8513, so 100 USDT → 0.481373 BCH showed +18.4%.
  const pools = [
    { asset: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', asset_tor_price: '99988586' },
    { asset: 'BCH.BCH', asset_tor_price: '20621423703' },
    { asset: 'BNB.BNB', asset_tor_price: '0' }
  ]
  const tor = torPoolPrices(pools, { rune_price_in_tor: '52956868' })
  const price = asset => Number(tor.pools.find(pool => pool.asset === asset).assetPriceUSD)
  assert.equal(price('ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7'), 0.99988586)
  assert.equal(tor.pools.length, 2)
  assert.equal(tor.runePrice, 0.52956868)
  const { impactPercent } = bridgeSummary({ sent: 100, sentUsd: 100 * 0.99988586, bch: 0.481373, bchUsd: price('BCH.BCH') })
  assert.ok(impactPercent < 0 && impactPercent > -1, `impact ${impactPercent}`)

  assert.equal(torPoolPrices(undefined), undefined)
  assert.equal(torPoolPrices([{ asset: 'BCH.BCH', asset_tor_price: '0' }]), undefined)
  assert.ok(Number.isNaN(torPoolPrices(pools).runePrice))
})
