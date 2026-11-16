import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { QuotePlaceholder } from '../src/components/swap/quote-placeholder.tsx'
import { SwapQuoteTimer } from '../src/components/swap/swap-quote-timer.tsx'

const messages = JSON.parse(readFileSync(new URL('../src/i18n/messages/en.json', import.meta.url), 'utf8'))
const render = element => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en', timeZone: 'UTC', messages }, element))

test('a loading quote keeps the previous amount under a sheen, or shows a skeleton when there is none', () => {
  assert.equal(render(createElement(QuotePlaceholder, { previous: '12.5' })), '<span class="bridge-amount-sheen">12.5</span>')
  assert.match(render(createElement(QuotePlaceholder, {})), /class="bridge-skeleton bridge-skeleton--amount"/)
})

test('the refresh ring is hidden until a quote has arrived', () => {
  const quote = { expectedBuyAmount: '1' }
  assert.equal(render(createElement(SwapQuoteTimer, { quote, isLoading: true, refetch: () => {} })), '')
  assert.equal(render(createElement(SwapQuoteTimer, { quote: undefined, isLoading: false, refetch: () => {} })), '')
})
