import axios from 'axios'

// A stalled provider would otherwise hold a poll open forever.
const thornode = axios.create({ baseURL: 'https://gateway.liquify.com/chain/thorchain_api', timeout: 15_000 })

export interface ThorNameAlias {
  chain: string
  address: string
}

export interface ThorName {
  name: string
  expire_block_height: number
  owner: string
  preferred_asset: string
  preferred_asset_swap_threshold_rune?: string
  affiliate_collector_rune?: string
  aliases: ThorNameAlias[]
}

// "Available" only when THORNode reports the name doesn't exist; any other
// failure is unknown, not a free name.
//
// Up to THORNode 3.19.x an unregistered name answers 500, not 404, with only a
// wrapper message ({"code":2,"message":"fail to fetch THORName"}). Matching that
// exact body keeps real outages — 5xx, rate limits, timeouts — reported as
// errors. 3.20.0 returns 4xx, which the status check already covers, so the
// message match can go once every node has upgraded.
const isNameNotFound = (err: unknown): boolean => {
  if (!axios.isAxiosError(err)) return false
  if (err.response?.status === 404) return true
  const message = err.response?.data?.message ?? err.response?.data?.error
  if (typeof message !== 'string') return false
  return message.includes("doesn't exist") || message.includes('fail to fetch THORName')
}

export const getThorName = async (name: string): Promise<ThorName | null> => {
  try {
    const res = await thornode.get(`/thorchain/thorname/${encodeURIComponent(name)}`)
    // A 200 with a name means it's taken — registered (has `owner`) or a reserved
    // chain name (no `owner`). Either way, not registerable.
    return typeof res.data?.name === 'string' ? res.data : null
  } catch (err) {
    if (isNameNotFound(err)) return null
    throw err
  }
}

export interface ThorNetwork {
  tns_register_fee_rune?: string
  tns_fee_per_block_rune?: string
  rune_price_in_tor?: string
}

export const getThorNetwork = async (): Promise<ThorNetwork> => {
  return thornode.get('/thorchain/network').then(res => res.data ?? {})
}

export interface ThorPool {
  asset: string
  status: string
  balance_asset: string
  balance_rune: string
  asset_tor_price: string
  pool_units: string
}

export const getThorPools = async (): Promise<ThorPool[]> => {
  return thornode.get('/thorchain/pools').then(res => res.data)
}

// USD prices from THORNode's TOR prices (1e8 = $1), the protocol's own valuation of each pool. Undefined when
// no pool has a TOR price, so the caller can fall back to Midgard.
export const torPoolPrices = (pools?: ThorPool[], network?: ThorNetwork) => {
  const priced = (pools ?? []).filter(pool => Number(pool.asset_tor_price) > 0)
  if (!priced.length) return undefined
  return {
    pools: priced.map(pool => ({ asset: pool.asset, assetPriceUSD: String(Number(pool.asset_tor_price) / 1e8) })),
    runePrice: Number(network?.rune_price_in_tor) / 1e8
  }
}

