import { BridgeConfig } from '@/config'

// The CashTokens the bridge can reach on Cauldron: the indexer's own token list (ranked by its
// score, metadata from each token's BCMR). A token is identified by its category id only; the
// ticker and name are display text the token's issuer chose, so two tokens may share a ticker.

export interface CauldronToken {
  category: string
  ticker: string
  name?: string
  decimals: number
  // An https or data: image URL, when the token's metadata has one.
  icon?: string
}

// ParyonUSD, checked against paryonusd.com and its BCMR; listed first whatever the indexer says.
export const PUSD_TOKEN: CauldronToken = {
  category: BridgeConfig.pusd.category,
  ticker: BridgeConfig.pusd.ticker,
  name: 'ParyonUSD',
  decimals: BridgeConfig.pusd.decimals,
  icon: '/tokens/pusd.svg'
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

// Pinned at the top of the picker, so they show even when the indexer is down: the two dollar
// stablecoins, then the three most liquid other tokens on Cauldron (indexer tvl_sats, 19 November:
// RES 817 BCH, OLA 134 BCH, LIFT 97 BCH; NWB, third, is left out for its name). Category, ticker
// and decimals agree in each token's BCMR on bcmr.paytaca.com and indexer.riften.net.
export const FEATURED_TOKENS: readonly CauldronToken[] = [
  PUSD_TOKEN,
  // Moria USD v1; Cauldron also lists the older MUSDv0 (4046913c…), which this is not.
  { category: 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366', ticker: 'MUSD', name: 'Moria USD', decimals: 2, icon: 'https://meta.moria.money/m1.png' },
  { category: '5e4a058f6593be30090ce6e03282ab0a85ad393275f246c2fb34fae15da017da', ticker: 'RES', name: 'RES', decimals: 6, icon: 'https://bcmr.res.cash/.well-known/res.svg' },
  { category: '7fa887fd4eac015478b95392c4984721fbe3060223c30b342d43cc06817f07f6', ticker: 'OLA', name: 'olando', decimals: 2, icon: `${IPFS_GATEWAY}bafybeidlal7oyr7pf3nshvqqydnrl3nlugv4jwy25fjglouh7yxuwqfype/7fa887fd4eac015478b95392c4984721fbe3060223c30b342d43cc06817f07f6.png` },
  { category: '5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc', ticker: 'LIFT', name: 'Paytaca LIFT Token', decimals: 2, icon: `${IPFS_GATEWAY}bafybeictwoxb4ma2ywxl545dhuvqqufiwyhacvauygcj43u2orq3zm2c4e/5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc.png` }
]

// Tokens with less BCH than this in their pools are left out: a trade of a few dollars would move them.
const MIN_TVL_SATS = 100_000_000
const LIST_SIZE = 40

const isCategory = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export const isCauldronToken = (value: unknown): value is CauldronToken => {
  const t = value as CauldronToken
  return !!t && isCategory(t.category) && typeof t.ticker === 'string' && Number.isSafeInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 18
}

export const sameToken = (a?: Pick<CauldronToken, 'category'> | null, b?: Pick<CauldronToken, 'category'> | null) => !!a && !!b && a.category === b.category

const iconUrl = (uri: unknown) => {
  if (typeof uri !== 'string' || !uri) return undefined
  if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}${uri.slice('ipfs://'.length)}`
  if (uri.startsWith('https://') || uri.startsWith('data:image/')) return uri
  return undefined
}

// Display text from the indexer is trimmed and cut short; it is never markup.
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

interface IndexedToken {
  token_id?: unknown
  display_symbol?: unknown
  display_name?: unknown
  tvl_sats?: unknown
  bcmr?: { name?: unknown; token?: { category?: unknown; decimals?: unknown; symbol?: unknown }; uris?: { icon?: unknown } } | null
}

export const parseIndexedToken = (raw: IndexedToken): CauldronToken | undefined => {
  if (!isCategory(raw.token_id)) return undefined
  const featured = FEATURED_TOKENS.find(t => t.category === raw.token_id)
  if (featured) return featured
  const meta = raw.bcmr ?? undefined
  // Decimals come from the token's own metadata, and only when it describes this category.
  if (meta?.token?.category !== undefined && meta.token.category !== raw.token_id) return undefined
  const decimals = Number(meta?.token?.decimals ?? 0)
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) return undefined
  const ticker = text(raw.display_symbol, 16) || text(meta?.token?.symbol, 16) || raw.token_id.slice(0, 6)
  return { category: raw.token_id, ticker, name: text(raw.display_name, 48) || text(meta?.name, 48) || undefined, decimals, icon: iconUrl(meta?.uris?.icon) }
}

const fetchList = async (path: string, params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`${BridgeConfig.cauldronIndexerUrl}/cauldron/${path}?${query}`, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error('Could not read the Cauldron token list')
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) throw new Error('Unexpected Cauldron token list')
  return (body as IndexedToken[]).filter(t => Number(t.tvl_sats) >= MIN_TVL_SATS).flatMap(t => parseIndexedToken(t) ?? [])
}

// The BCH side of a page link: `BCH` for native BCH, a pinned token's ticker, or any token's category id.
export const tokenSlug = (token: CauldronToken | null) => (!token ? 'BCH' : FEATURED_TOKENS.some(t => sameToken(t, token)) ? token.ticker : token.category)

// Reads a link segment back: a token or null (native BCH), a category id to look up, or undefined
// when the segment names no BCH side. Tickers other than the pinned ones are not trusted.
export const readTokenSlug = (slug: string | null): { token: CauldronToken | null } | { category: string } | undefined => {
  const lower = slug?.toLowerCase()
  if (!lower) return undefined
  if (lower === 'bch' || lower === 'bch.bch') return { token: null }
  const featured = FEATURED_TOKENS.find(t => t.ticker.toLowerCase() === lower || t.category === lower)
  if (featured) return { token: featured }
  return isCategory(lower) ? { category: lower } : undefined
}

export const withFeaturedFirst = (tokens: CauldronToken[]) => [...FEATURED_TOKENS, ...tokens.filter(t => !FEATURED_TOKENS.some(f => sameToken(f, t)))]

// The bridge's token list: the featured tokens, then Cauldron's top tokens by score.
export const fetchCauldronTokens = async () => withFeaturedFirst(await fetchList('tokens/list_cached', { limit: String(LIST_SIZE), offset: '0', by: 'score', order: 'desc' }))

// Tokens matching a ticker, name or category id, searched across all of Cauldron's tokens.
export const searchCauldronTokens = async (query: string) =>
  fetchList('tokens/search_cached', { limit: '20', offset: '0', by: 'score', order: 'desc', q: query.trim().slice(0, 64) })
