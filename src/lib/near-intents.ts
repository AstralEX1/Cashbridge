import { Chain, getChainConfig, ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import type { Asset } from '@/components/swap/asset'
import { nearIntentsApiUrl } from '@/config'
import { formatBaseUnits, toBaseUnits } from '@/lib/bridge'
import type { NearLeg } from '@/store/transaction-store'

// NEAR Intents' 1Click API (docs.near-intents.org, OpenAPI at 1click.chaindefuser.com/docs/v0/openapi.yaml): the
// second route between other chains and native BCH, beside THORChain. A quote gives a one-use deposit address on
// the source chain; solvers fill the swap and pay BCH to the recipient, or refund the deposit to `refundTo`.
// The deposit is a plain transfer (no memo, no router contract, no approval). Browser calls go through
// /api/near-intents so NEAR_INTENTS_JWT stays server-side; with that JWT 1Click uses the partner fee schedule
// (typically 20 bps) instead of the keyless +25 bps surcharge.

export const ONE_CLICK_URL =
  process.env.NEAR_INTENTS_URL || process.env.NEXT_PUBLIC_NEAR_INTENTS_URL || 'https://1click.chaindefuser.com/v0'

// Server-only partner JWT headers for direct upstream calls (agent, Router worker). Empty when unset.
export const nearAuthHeaders = (): Record<string, string> => {
  const jwt = typeof window === 'undefined' ? process.env.NEAR_INTENTS_JWT?.trim() : undefined
  return jwt ? { Authorization: `Bearer ${jwt}` } : {}
}

// The page asks through our proxy; the server (agent / Router) asks 1Click itself with the JWT when set.
const nearEndpoint = (): [string, Record<string, string>] =>
  typeof window === 'undefined' ? [ONE_CLICK_URL, nearAuthHeaders()] : [nearIntentsApiUrl(), {}]

// Native BCH as NEAR Intents holds it. 1Click pays only plain addresses (q…, p…): it refuses token-aware ones.
export const NEAR_BCH = 'nep141:bch.omft.near'

// The quote names this site as the venue (letters, digits and single - _ . only). No app fee is asked.
const REFERRAL = 'cashbridge'

// The refund starts at the deadline, which "must exceed the time required for the deposit transaction to be mined. For
// example, Bitcoin may require around one hour" (1Click): two hours going in, still inside a contract order's three.
// Coming out, NEAR counts a BCH deposit only once it confirms.
export const FORWARD_DEADLINE_MS = 2 * 60 * 60_000
export const REVERSE_DEADLINE_MS = 4 * 60 * 60_000

// The form's slippage is a percentage; 1Click takes basis points.
export const nearSlippageBps = (slippage?: number) => Math.round((slippage ?? 1) * 100)

// THORChain-style chain prefix to 1Click's `blockchain`. Only chains the SDK names, that have a network icon,
// and whose deposit is a plain transfer (XRP and Stellar need a memo/tag the wallet send does not carry).
const CHAINS: Record<string, string> = {
  ADA: 'cardano',
  ARB: 'arb',
  AVAX: 'avax',
  BASE: 'base',
  BCH: 'bch',
  BERA: 'bera',
  BSC: 'bsc',
  BTC: 'btc',
  DASH: 'dash',
  DOGE: 'doge',
  ETH: 'eth',
  GNO: 'gnosis',
  LTC: 'ltc',
  MONAD: 'monad',
  NEAR: 'near',
  OP: 'op',
  POL: 'pol',
  SOL: 'sol',
  SUI: 'sui',
  TON: 'ton',
  TRON: 'tron',
  XLAYER: 'xlayer',
  ZEC: 'zec'
}
export const isNearChain = (chain?: string) => !!chain && chain.toUpperCase() in CHAINS

// 1Click `blockchain` → the Chain enum wallets and the picker already use.
const BLOCKCHAIN_TO_CHAIN: Record<string, Chain> = {
  arb: Chain.Arbitrum,
  avax: Chain.Avalanche,
  base: Chain.Base,
  bch: Chain.BitcoinCash,
  bera: Chain.Berachain,
  bsc: Chain.BinanceSmartChain,
  btc: Chain.Bitcoin,
  cardano: Chain.Cardano,
  dash: Chain.Dash,
  doge: Chain.Dogecoin,
  eth: Chain.Ethereum,
  gnosis: Chain.Gnosis,
  ltc: Chain.Litecoin,
  monad: Chain.Monad,
  near: Chain.Near,
  op: Chain.Optimism,
  pol: Chain.Polygon,
  sol: Chain.Solana,
  sui: Chain.Sui,
  ton: Chain.Ton,
  tron: Chain.Tron,
  xlayer: Chain.XLayer,
  zec: Chain.Zcash
}

const chainPrefix = (blockchain: string) => Object.entries(CHAINS).find(([, value]) => value === blockchain)?.[0]

// Contract as 1Click ships it. `null`/`undefined` = chain native; a blank string is malformed (not a native).
// Solana and TRON keep casing for wallet send.
const catalogContract = (token: OneClickToken): string | undefined | false => {
  if (token.contractAddress == null) return undefined
  if (typeof token.contractAddress !== 'string') return false
  const trimmed = token.contractAddress.trim()
  return trimmed || false
}

// Account names, base58/base64 contracts and Sui type paths must keep catalog casing for wallet send.
const isCaseSensitiveChain = (blockchain?: string) =>
  blockchain === 'sol' || blockchain === 'tron' || blockchain === 'near' || blockchain === 'sui' || blockchain === 'ton' || blockchain === 'cardano'
const isCaseSensitiveAssetChain = (chain: Chain) =>
  chain === Chain.Solana || chain === Chain.Tron || chain === Chain.Near || chain === Chain.Sui || chain === Chain.Ton || chain === Chain.Cardano

// Skip retired rows, unmapped chains, and rows the wallet send cannot fund or identify.
const isSelectableNearToken = (token: OneClickToken) =>
  !!token &&
  typeof token.assetId === 'string' &&
  !!token.assetId &&
  typeof token.symbol === 'string' &&
  !!token.symbol.trim() &&
  Number.isInteger(token.decimals) &&
  token.decimals >= 0 &&
  token.decimals <= 24 &&
  !!chainPrefix(token.blockchain) &&
  !/DEPRECATED|\(OMNI\)/i.test(token.symbol)

// THORChain-style id for a 1Click row (`BASE.USDC-0X8335…`, `SOL.USDC-EPjF…`, `ETH.ETH`). Solana and
// TRON keep the catalog's contract casing; EVM contracts are upper-cased like Midgard.
export const nearAssetIdentifier = (token: OneClickToken): string | undefined => {
  if (!isSelectableNearToken(token)) return undefined
  const prefix = chainPrefix(token.blockchain)!
  const contract = catalogContract(token)
  if (contract === false) return undefined
  if (!contract) return `${prefix}.${token.symbol.trim()}`
  const encoded = isCaseSensitiveChain(token.blockchain) ? contract : contract.toUpperCase()
  return `${prefix}.${token.symbol.trim()}-${encoded}`
}

// Map key: Solana/TRON keep contract case so distinct mints stay distinct; EVM folds case like Midgard.
const nearAssetKey = (chain: Chain, identifier: string) =>
  isCaseSensitiveAssetChain(chain) ? `${chain}-${identifier}` : `${chain}-${identifier}`.toLowerCase()

// Picker rows for 1Click tokens on chains Cashbridge already maps. Tagged NEAR only — never THORCHAIN —
// so a Midgard-missing asset cannot be deposited into an unsupported THORChain vault by provider stamp.
// Malformed / duplicate catalog rows are dropped (first valid wins; Solana/TRON duplicates are exact-contract).
export const assetsFromNearTokens = (tokens: OneClickToken[]): Asset[] => {
  const assets = new Map<string, Asset>()
  if (!Array.isArray(tokens)) return []
  for (const token of tokens) {
    const identifier = nearAssetIdentifier(token)
    const chain = BLOCKCHAIN_TO_CHAIN[token?.blockchain]
    if (!identifier || !chain || !getChainConfig(chain).chain) continue
    const key = nearAssetKey(chain, identifier)
    if (assets.has(key)) continue
    const contract = catalogContract(token)
    if (contract === false) continue
    const ticker = token.symbol.trim()
    assets.set(key, {
      address: contract || undefined,
      chain,
      chainId: getChainConfig(chain).chainId,
      decimals: token.decimals,
      identifier,
      // Natives reuse the network mark; contract tokens get no logoURI (1Click ships none).
      logoURI: contract ? undefined : `/networks/${chain.toLowerCase()}.svg`,
      name: ticker,
      providers: [ProviderName.NEAR],
      ticker
    })
  }
  return Array.from(assets.values())
}

// Same-chain map entry that overlaps this NEAR row: exact Solana/TRON mint first, else one unambiguous
// all-uppercase aggregator mint (THOR). Mixed-case catalog rows that differ only by case stay distinct.
const findMergeTarget = (assets: Map<string, Asset>, nearAsset: Asset, nearAssets: Asset[]): [string, Asset] | undefined => {
  if (isCaseSensitiveAssetChain(nearAsset.chain) && nearAsset.address) {
    const sameChain = [...assets.entries()].filter(([, asset]) => asset.chain === nearAsset.chain && !!asset.address)
    const exact = sameChain.find(([, asset]) => asset.address === nearAsset.address)
    if (exact) return exact
    if (nearAssets.some(asset => asset.chain === nearAsset.chain && asset.address !== nearAsset.address && asset.address?.toUpperCase() === nearAsset.address!.toUpperCase())) return undefined
    const legacy = sameChain.filter(
      ([, asset]) => asset.address === asset.address!.toUpperCase() && asset.address!.toUpperCase() === nearAsset.address!.toUpperCase()
    )
    return legacy.length === 1 ? legacy[0] : undefined
  }
  const key = `${nearAsset.chain}-${nearAsset.identifier}`.toLowerCase()
  const existing = assets.get(key)
  return existing ? [key, existing] : undefined
}

// Fold validated 1Click rows into the THOR-built map. Overlap keeps THOR providers/metadata and adds NEAR;
// Solana/TRON overlap adopts the catalog's case-exact contract for wallet send when the mint is unambiguous.
// Distinct case-sensitive mints stay separate. Catalog failure is the caller's empty list — THOR map unchanged.
export const mergeNearAssets = (assets: Map<string, Asset>, nearList: OneClickToken[]) => {
  const nearAssets = assetsFromNearTokens(nearList)
  for (const nearAsset of nearAssets) {
    const match = findMergeTarget(assets, nearAsset, nearAssets)
    if (match) {
      const [, existing] = match
      if (!existing.providers.includes(ProviderName.NEAR)) existing.providers.push(ProviderName.NEAR)
      if (
        nearAsset.address &&
        isCaseSensitiveAssetChain(nearAsset.chain) &&
        existing.address &&
        existing.address === existing.address.toUpperCase() &&
        existing.address.toUpperCase() === nearAsset.address.toUpperCase()
      ) {
        // Restore catalog casing onto a THOR-uppercased mint; never replace another canonical mint.
        existing.address = nearAsset.address
        existing.identifier = nearAsset.identifier
      }
      continue
    }
    assets.set(nearAssetKey(nearAsset.chain, nearAsset.identifier), nearAsset)
  }
  return assets
}

// Valid addresses for a dry quote, which needs a recipient and a refund address but creates nothing.
// Real quotes always carry the user's own addresses.
const PLACEHOLDERS: Record<string, string> = {
  bch: 'bitcoincash:qq9nq4t6nlzwjr3ntp7693lvzym9hq99egut9wk68z',
  btc: '122ALQhLw63cHbrSnTG9uuUao8SNd3S7K2',
  cardano: 'addr1v8wfpcg4qfhmnzprzysj6j9c53u5j56j8rvhyjp08s53s6g07rfjm',
  dash: 'XqHqWkZHbjDZ5Vu6Dsi4iQLsHWiS9W6wua',
  doge: 'D6AFsfdzEVwtpc33X3FiTfeBgGAfvE3dfi',
  ltc: 'LLF7bd1B1kHfYQYbxbFTBvYM1LoegXHn7P',
  near: 'wrap.near',
  sol: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
  sui: '0x0000000000000000000000000000000000000000000000000000000000000002',
  ton: 'EQAWzEKcdnykvXfUNouqdS62tvrp32bCxuKS6eQrS6ISgcLo',
  tron: 'TAzNLU555pAZSmv5NiusS4AihvBgpMwbKY',
  zec: 't1JtmLk7UuQqCtEuLit5H3iaW3ndTNGTjVH',
  evm: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D'
}
const placeholder = (blockchain: string) => PLACEHOLDERS[blockchain] ?? PLACEHOLDERS.evm

export interface OneClickToken {
  assetId: string
  decimals: number
  blockchain: string
  symbol: string
  price: number
  contractAddress?: string | null
}

export interface OneClickQuote {
  depositAddress?: string
  depositMemo?: string
  amountIn: string
  amountInFormatted: string
  amountInUsd?: string
  minAmountIn: string
  amountOut: string
  amountOutFormatted: string
  amountOutUsd?: string
  minAmountOut: string
  deadline?: string
  timeEstimate: number
}

// Saved with the operation as 1Click asks: the signature settles any dispute about the deposit address.
export interface OneClickQuoteResponse {
  correlationId: string
  timestamp: string
  signature: string
  // 1Click's echo of the request: its `deadline` is when the refund starts.
  quoteRequest?: { deadline?: string }
  quote: OneClickQuote
}

export type NearSwapStatus = 'KNOWN_DEPOSIT_TX' | 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED'

export interface NearStatusResponse {
  status: NearSwapStatus
  updatedAt?: string
  correlationId?: string
  // The signed quote this deposit address was made for.
  quoteResponse?: {
    timestamp?: string
    signature?: string
    quoteRequest?: {
      swapType?: string
      recipient?: string
      refundTo?: string
      originAsset?: string
      destinationAsset?: string
      amount?: string
      deadline?: string
    }
    quote?: { depositAddress?: string; amountIn?: string; minAmountIn?: string; amountOut?: string; minAmountOut?: string; deadline?: string }
  }
  swapDetails?: {
    amountOut?: string
    depositedAmount?: string
    refundedAmount?: string
    refundedAmountFormatted?: string
    refundReason?: string
    originChainTxHashes?: { hash: string; explorerUrl?: string }[]
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[]
  }
}

// A route as the rest of the bridge reads it (confirm screen, wallet send, history), with 1Click's own answer kept.
export type NearRoute = QuoteResponseRoute & { near: OneClickQuoteResponse & { originAsset: string; destinationAsset: string } }
export const isNearRoute = (route?: QuoteResponseRoute): route is NearRoute => route?.providers?.[0] === ProviderName.NEAR && 'near' in route

class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

const request = async <T,>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<T> => {
  const [base, auth] = nearEndpoint()
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      ...auth,
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    // A redirect would carry the server's JWT to another host.
    redirect: 'error',
    signal: init?.signal ?? AbortSignal.timeout(20_000),
    cache: 'no-store'
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) throw new OneClickError(`NEAR Intents: ${(json as { message?: string } | null)?.message ?? `HTTP ${response.status}`}`, response.status)
  return json as T
}

let tokens: Promise<OneClickToken[]> | undefined
export const getNearTokens = () => {
  tokens ??= request<OneClickToken[]>('/tokens').catch(error => {
    tokens = undefined
    throw error
  })
  return tokens
}

// The 1Click token for a THORChain-style identifier (`BASE.USDC-0X8335…`, `ETH.ETH`, `BCH.BCH`): same chain, and the
// same contract or, for a chain's own coin, no contract and its ticker. Solana/TRON prefer an exact contract suffix
// match; uppercase aggregator ids are accepted only when that match is unambiguous. EVM stays case-insensitive.
// When a ticker itself contains `-` (`SOL.kV-gtSOLb-5EB…`), match by chain + contract suffix rather than the first dash.
export const findNearToken = (list: OneClickToken[], identifier: string) => {
  const dot = identifier.indexOf('.')
  const blockchain = CHAINS[identifier.slice(0, dot).toUpperCase()]
  if (dot < 0 || !blockchain) return undefined
  const sameChain = Array.isArray(list) ? list.filter(t => isSelectableNearToken(t) && t.blockchain === blockchain && catalogContract(t) !== false) : []
  const rest = identifier.slice(dot + 1)
  if (rest.includes('-')) {
    const withContract = sameChain.filter(t => typeof t.contractAddress === 'string' && !!t.contractAddress)
    if (isCaseSensitiveChain(blockchain)) {
      const exact = withContract.filter(t => identifier.endsWith(`-${t.contractAddress}`))
      if (exact.length === 1) return exact[0]
      if (exact.length > 1) return undefined
      const contract = rest.slice(rest.lastIndexOf('-') + 1)
      if (contract !== contract.toUpperCase()) return undefined
      const upper = identifier.toUpperCase()
      const folded = withContract.filter(t => upper.endsWith(`-${t.contractAddress!.toUpperCase()}`))
      return folded.length === 1 ? folded[0] : undefined
    }
    const upper = identifier.toUpperCase()
    return withContract.find(t => upper.endsWith(`-${t.contractAddress!.toUpperCase()}`))
  }
  const ticker = rest.toUpperCase()
  return sameChain.find(t => !t.contractAddress && t.symbol.toUpperCase() === ticker)
}

export interface NearQuoteRequest {
  sellAsset: string
  buyAsset: string
  // Decimal, in the sell asset's units.
  sellAmount: string
  // Absent on a dry quote, which uses placeholders.
  recipient?: string
  refundTo?: string
  dry: boolean
  slippageBps: number
  // Selling a Cauldron token for exactly the BCH it fetches: the deposit may land anywhere from the minimum up.
  flexible?: boolean
  now?: number
}

// Base units 1Click wants, from a decimal amount; extra precision is cut, never rounded up.
const baseUnits = (amount: string, decimals: number) => {
  const [whole, fraction = ''] = amount.trim().split('.')
  return toBaseUnits(`${whole}.${fraction.slice(0, decimals) || '0'}`, decimals)
}

export const nearQuoteBody = (req: NearQuoteRequest, origin: OneClickToken, destination: OneClickToken) => {
  const reverse = destination.assetId !== NEAR_BCH
  const now = req.now ?? Date.now()
  return {
    dry: req.dry,
    swapType: req.flexible ? 'FLEX_INPUT' : 'EXACT_INPUT',
    slippageTolerance: req.slippageBps,
    originAsset: origin.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: destination.assetId,
    amount: baseUnits(req.sellAmount, origin.decimals).toString(),
    refundTo: req.refundTo ?? placeholder(origin.blockchain),
    refundType: 'ORIGIN_CHAIN',
    recipient: req.recipient ?? placeholder(destination.blockchain),
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now + (reverse ? REVERSE_DEADLINE_MS : FORWARD_DEADLINE_MS)).toISOString(),
    referral: REFERRAL
  }
}

// The 1Click answer as a bridge route. Amounts are re-read from base units with the tokens' own decimals.
export const nearRoute = (
  response: OneClickQuoteResponse,
  req: NearQuoteRequest & { sourceAddress?: string },
  origin: OneClickToken,
  destination: OneClickToken
): NearRoute => {
  const { quote } = response
  // The swap refunds at the requested deadline; `quote.deadline` is only when the deposit address goes inactive.
  const deadline = Math.floor(Math.min(...[response.quoteRequest?.deadline, quote.deadline].map(d => (d ? Date.parse(d) : NaN)).filter(Number.isFinite)) / 1000)
  return {
    providers: [ProviderName.NEAR],
    sellAsset: req.sellAsset,
    sellAmount: formatBaseUnits(quote.amountIn, origin.decimals),
    buyAsset: req.buyAsset,
    expectedBuyAmount: formatBaseUnits(quote.amountOut, destination.decimals),
    expectedBuyAmountMaxSlippage: formatBaseUnits(quote.minAmountOut, destination.decimals),
    ...(req.recipient && { destinationAddress: req.recipient }),
    ...(req.sourceAddress && { sourceAddress: req.sourceAddress }),
    ...(req.refundTo && { refundAddress: req.refundTo }),
    ...(quote.depositAddress && { inboundAddress: quote.depositAddress, targetAddress: quote.depositAddress }),
    ...(Number.isFinite(deadline) && { expiration: String(deadline) }),
    estimatedTime: { total: quote.timeEstimate },
    fees: [],
    meta: {
      near: {
        sellAsset: origin.assetId,
        buyAsset: destination.assetId,
        sellAmount: quote.amountIn,
        slippage: req.slippageBps,
        sourceAddress: req.refundTo ?? '',
        destinationAddress: req.recipient ?? ''
      }
    },
    near: { ...response, originAsset: origin.assetId, destinationAsset: destination.assetId }
  }
}

// A quote between `sellAsset` and `buyAsset` (native BCH on one side, or a free pair); undefined when NEAR Intents does
// not list either side.
export const getNearQuote = async (req: NearQuoteRequest & { sourceAddress?: string }, signal?: AbortSignal): Promise<NearRoute | undefined> => {
  const list = await getNearTokens()
  const origin = findNearToken(list, req.sellAsset)
  const destination = findNearToken(list, req.buyAsset)
  if (!origin || !destination) return undefined
  const body = nearQuoteBody(req, origin, destination)
  const response = await request<OneClickQuoteResponse>('/quote', { method: 'POST', body, signal })
  if (!req.dry && !response.quote.depositAddress) throw new Error('NEAR Intents returned no deposit address')
  // The wallet send carries no memo, and a deposit address that needs one would not credit the swap.
  if (!req.dry && response.quote.depositMemo) throw new Error('NEAR Intents asks for a deposit memo this transfer cannot send')
  return nearRoute({ ...response, quoteRequest: response.quoteRequest ?? body }, req, origin, destination)
}

// What the operation keeps of an executable route (it has a deposit address).
export const nearLegOf = (route: NearRoute): NearLeg => ({
  depositAddress: route.near.quote.depositAddress!,
  correlationId: route.near.correlationId,
  signature: route.near.signature,
  quotedAt: route.near.timestamp,
  deadline: route.near.quoteRequest?.deadline ?? route.near.quote.deadline,
  amountIn: route.near.quote.amountIn,
  amountOut: route.near.quote.amountOut,
  minAmountOut: route.near.quote.minAmountOut
})

export const getNearStatus = (depositAddress: string) => request<NearStatusResponse>(`/status?depositAddress=${encodeURIComponent(depositAddress)}`)

// Points the solvers at the deposit right away; optional, so a failure is only logged.
export const submitNearDeposit = (depositAddress: string, txHash: string) =>
  request('/deposit/submit', { method: 'POST', body: { depositAddress, txHash } }).catch(error => console.warn('NEAR Intents deposit notice failed', error))

// The public page of a swap, by its deposit address.
export const nearExplorerUrl = (depositAddress: string) => `https://explorer.near-intents.org/transactions/${encodeURIComponent(depositAddress)}`

// What 1Click's status means for the bridge. Payout hashes are only pointers: the payout itself is checked on its chain.
export type NearView =
  | { kind: 'pending'; detail?: string }
  | { kind: 'paid'; txids: string[]; amountOut?: string }
  // `amount`: the refund in 1e8 units, as THORChain counts refunds.
  | { kind: 'refunded'; amount?: string; reason?: string }
  | { kind: 'failed'; reason: string }

export const interpretNearStatus = (status: NearStatusResponse): NearView => {
  const details = status.swapDetails ?? {}
  const payouts = (details.destinationChainTxHashes ?? []).map(t => t.hash).filter(Boolean)
  switch (status.status) {
    case 'SUCCESS':
      return payouts.length ? { kind: 'paid', txids: payouts, amountOut: details.amountOut } : { kind: 'pending', detail: 'NEAR Intents reports the swap done; waiting for the payout hash' }
    case 'REFUNDED':
      return {
        kind: 'refunded',
        amount: details.refundedAmountFormatted ? baseUnits(details.refundedAmountFormatted, 8).toString() : undefined,
        reason: details.refundReason
      }
    case 'FAILED':
      return { kind: 'failed', reason: 'NEAR Intents could not complete the swap; it reviews failed deposits by hand' }
    case 'INCOMPLETE_DEPOSIT':
      return { kind: 'pending', detail: 'NEAR Intents received less than the quote asked for; it refunds the deposit at the deadline' }
    default:
      // A payout can be on its way before the status turns SUCCESS.
      return payouts.length ? { kind: 'paid', txids: payouts, amountOut: details.amountOut } : { kind: 'pending' }
  }
}
