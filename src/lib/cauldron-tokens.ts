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

// Tokens with less BCH than this in their pools are left out: a trade of a few dollars would move them.
const MIN_TVL_SATS = 100_000_000
const LIST_SIZE = 40
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

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
  if (raw.token_id === PUSD_TOKEN.category) return PUSD_TOKEN
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

const withPusdFirst = (tokens: CauldronToken[]) => [PUSD_TOKEN, ...tokens.filter(t => !sameToken(t, PUSD_TOKEN))]

// The bridge's token list: Cauldron's top tokens by score, PUSD first.
export const fetchCauldronTokens = async () => withPusdFirst(await fetchList('tokens/list_cached', { limit: String(LIST_SIZE), offset: '0', by: 'score', order: 'desc' }))

// Tokens matching a ticker, name or category id, searched across all of Cauldron's tokens.
export const searchCauldronTokens = async (query: string) =>
  fetchList('tokens/search_cached', { limit: '20', offset: '0', by: 'score', order: 'desc', q: query.trim().slice(0, 64) })
