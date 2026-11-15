import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { PRESET_PERCENTS, percentOfUnits } from '../src/lib/amount-presets.ts'
import { AmountPresets } from '../src/components/swap/amount-presets.tsx'

const messages = JSON.parse(readFileSync(new URL('../src/i18n/messages/en.json', import.meta.url), 'utf8'))
const render = revealed =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', timeZone: 'UTC', messages },
      createElement(AmountPresets, { revealed, inputId: 'amount', onPercent: () => {}, onMax: () => {} })
    )
  )

test('a share of a balance is rounded down and never above the balance', () => {
  assert.deepEqual(PRESET_PERCENTS, [25, 50, 75])
  assert.equal(percentOfUnits(1_000n, 25), 250n)
  assert.equal(percentOfUnits(1_001n, 50), 500n)
  assert.equal(percentOfUnits(7n, 75), 5n)
  assert.equal(percentOfUnits(3n, 25), 0n)
  for (const percent of PRESET_PERCENTS) assert.ok(percentOfUnits(123_456_789n, percent) < 123_456_789n)
})

test('the chips are drawn only while the field is revealed, staggered 50 ms apart, MAX last', () => {
  assert.equal(render(false), '')
  const html = render(true)
  assert.deepEqual([...html.matchAll(/>(25%|50%|75%|MAX)</g)].map(match => match[1]), ['25%', '50%', '75%', 'MAX'])
  assert.deepEqual([...html.matchAll(/--bridge-preset-delay:(\d+)ms/g)].map(match => Number(match[1])), [0, 50, 100, 150])
  assert.match(html, /aria-label="Use 25% of the available balance"/)
  assert.match(html, /aria-label="Use the maximum available balance"/)
})
