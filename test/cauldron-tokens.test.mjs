import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FEATURED_TOKENS, PUSD_TOKEN, parseIndexedToken, withFeaturedFirst } from '../src/lib/cauldron-tokens.ts'

const MUSD = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366'
const MUSD_V0 = '4046913cba6b70b2214a048a3df92252849f481ffa1455ed7faf17243c36bf67'

test('the picker opens on PUSD, MUSD and the three most liquid tokens, each once', () => {
  assert.deepEqual(FEATURED_TOKENS.map(t => t.ticker), ['PUSD', 'MUSD', 'RES', 'OLA', 'LIFT'])
  assert.equal(FEATURED_TOKENS[0], PUSD_TOKEN)
  assert.equal(new Set(FEATURED_TOKENS.map(t => t.category)).size, FEATURED_TOKENS.length)

  const indexed = [{ category: MUSD_V0, ticker: 'MUSDv0', decimals: 2 }, FEATURED_TOKENS[2], { category: 'a'.repeat(64), ticker: 'X', decimals: 0 }]
  const list = withFeaturedFirst(indexed)
  assert.deepEqual(list.map(t => t.ticker), ['PUSD', 'MUSD', 'RES', 'OLA', 'LIFT', 'MUSDv0', 'X'])
})

test('a featured token keeps its checked decimals whatever the indexer says', () => {
  const musd = parseIndexedToken({ token_id: MUSD, display_symbol: 'MUSD', tvl_sats: 1e10, bcmr: { token: { category: MUSD, decimals: 8 } } })
  assert.equal(musd?.decimals, 2)
  assert.equal(musd?.name, 'Moria USD')

  const v0 = parseIndexedToken({ token_id: MUSD_V0, display_symbol: 'MUSDv0', bcmr: { token: { category: MUSD_V0, decimals: 2 } } })
  assert.equal(v0?.ticker, 'MUSDv0')
  assert.notEqual(v0?.category, MUSD)
})
