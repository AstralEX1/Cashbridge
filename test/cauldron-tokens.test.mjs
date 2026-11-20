import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FEATURED_TOKENS, PUSD_TOKEN, iconUrl, parseIndexedToken, readTokenSlug, tokenSlug, withFeaturedFirst } from '../src/lib/cauldron-tokens.ts'

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

test('a page link names the BCH side by ticker for pinned tokens and by category id otherwise', () => {
  const other = { category: 'a'.repeat(64), ticker: 'MUSD', decimals: 0 }
  assert.equal(tokenSlug(null), 'BCH')
  assert.equal(tokenSlug(FEATURED_TOKENS[1]), 'MUSD')
  assert.equal(tokenSlug(other), other.category)

  assert.deepEqual(readTokenSlug('BCH'), { token: null })
  assert.deepEqual(readTokenSlug('bch.bch'), { token: null })
  assert.equal(readTokenSlug('musd').token, FEATURED_TOKENS[1])
  assert.equal(readTokenSlug(MUSD).token, FEATURED_TOKENS[1])
  assert.deepEqual(readTokenSlug(MUSD_V0), { category: MUSD_V0 })
  // Only the pinned tickers are read as tokens; anything else is the other chain's asset.
  assert.equal(readTokenSlug('MUSDv0'), undefined)
  assert.equal(readTokenSlug('BSC.BNB'), undefined)
  assert.equal(readTokenSlug(null), undefined)
})

test('BCMR IPFS icons go through the same-origin proxy', () => {
  assert.equal(iconUrl('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/icon.png'), '/api/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/icon.png')
  assert.equal(iconUrl('https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/icon.png'), '/api/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/icon.png')
  assert.equal(iconUrl('https://ipfs.tapswap.cash/ipfs/QmXVcVZUdeiMgTfMvY3RM4N4dmBEWuRiV8wcF9GYkuzBeM'), '/api/ipfs/QmXVcVZUdeiMgTfMvY3RM4N4dmBEWuRiV8wcF9GYkuzBeM')
  assert.equal(iconUrl('https://example.com/icon.png'), 'https://example.com/icon.png')
  assert.equal(iconUrl('data:image/png;base64,aa'), 'data:image/png;base64,aa')
  assert.equal(iconUrl(''), undefined)
})
