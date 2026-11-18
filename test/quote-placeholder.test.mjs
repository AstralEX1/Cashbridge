import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { QuotePlaceholder } from '../src/components/swap/quote-placeholder.tsx'
import { refreshBridgeQueries } from '../src/lib/refresh-queries.ts'

const messages = JSON.parse(readFileSync(new URL('../src/i18n/messages/en.json', import.meta.url), 'utf8'))
const render = element => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en', timeZone: 'UTC', messages }, element))

test('a loading quote keeps the previous amount under a sheen, or shows a skeleton when there is none', () => {
  assert.equal(render(createElement(QuotePlaceholder, { previous: '12.5' })), '<span class="bridge-amount-sheen">12.5</span>')
  assert.match(render(createElement(QuotePlaceholder, {})), /class="bridge-skeleton bridge-skeleton--amount"/)
})

test('refresh reloads the quotes and balances, drops cached account balances and leaves transaction queries alone', async () => {
  const client = new QueryClient()
  const refreshed = [['quote', false, '1'], ['token-estimate', 'pusd', '100'], ['token-sale', 'pusd', '100'], ['balance', 'BASE.ETH'], ['bch-side-balance', '76a9']]
  const kept = [['reverse-prepared', 'BCH'], ['bridge-sync', 'u1'], ['assets']]
  for (const key of [...refreshed, ...kept]) client.setQueryData(key, 1)
  client.setQueryData(['account-balance', 'BTC', 'bc1q'], [])

  await refreshBridgeQueries(client)

  for (const key of refreshed) assert.equal(client.getQueryState(key)?.isInvalidated, true, key[0])
  for (const key of kept) assert.equal(client.getQueryState(key)?.isInvalidated, false, key[0])
  assert.equal(client.getQueryData(['account-balance', 'BTC', 'bc1q']), undefined)
})
