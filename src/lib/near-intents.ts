import { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { BridgeConfig } from '@/config'
import { formatBaseUnits, toBaseUnits } from '@/lib/bridge'
import type { NearLeg } from '@/store/transaction-store'

// NEAR Intents' 1Click API (docs.near-intents.org, OpenAPI at 1click.chaindefuser.com/docs/v0/openapi.yaml): the
// second route between other chains and native BCH, beside THORChain. A quote gives a one-use deposit address on
// the source chain; solvers fill the swap and pay BCH to the recipient, or refund the deposit to `refundTo`.
// The deposit is a plain transfer (no memo, no router contract, no approval). Keyless: without a partner JWT
// 1Click adds 25 bps to the price, which the quote already includes.

export const ONE_CLICK_URL = process.env.NEXT_PUBLIC_NEAR_INTENTS_URL || 'https://1click.chaindefuser.com/v0'

// Native BCH as NEAR Intents holds it. 1Click pays only plain addresses (q…, p…): it refuses token-aware ones.
export const NEAR_BCH = 'nep141:bch.omft.near'

// The quote names this site as the venue (letters, digits and single - _ . only). No app fee is asked.
const REFERRAL = 'cashbridge'

// Going in, the source deposit lands within minutes; coming out, NEAR counts a BCH deposit only once it confirms.
export const FORWARD_DEADLINE_MS = 60 * 60_000
export const REVERSE_DEADLINE_MS = 4 * 60 * 60_000

// The form's slippage is a percentage; 1Click takes basis points.
export const nearSlippageBps = (slippage?: number) => Math.round((slippage ?? 1) * 100)

// THORChain-style chain prefix to 1Click's `blockchain`. Only chains the bridge has wallets for and whose deposit
// is a plain transfer (XRP and Stellar deposits need a memo the wallet send does not carry).
const CHAINS: Record<string, string> = {
  ARB: 'arb',
  AVAX: 'avax',
  BASE: 'base',
  BCH: 'bch',
  BSC: 'bsc',
  BTC: 'btc',
  DOGE: 'doge',
  ETH: 'eth',
  LTC: 'ltc',
  OP: 'op',
  POL: 'pol',
  SOL: 'sol',
  TRON: 'tron',
  ZEC: 'zec'
}
export const isNearChain = (chain?: string) => !!chain && chain.toUpperCase() in CHAINS

// Valid addresses for a dry quote, which needs a recipient and a refund address but creates nothing.
// Real quotes always carry the user's own addresses.
const PLACEHOLDERS: Record<string, string> = {
  bch: 'bitcoincash:qq9nq4t6nlzwjr3ntp7693lvzym9hq99egut9wk68z',
  btc: '122ALQhLw63cHbrSnTG9uuUao8SNd3S7K2',
  doge: 'D6AFsfdzEVwtpc33X3FiTfeBgGAfvE3dfi',
  ltc: 'LLF7bd1B1kHfYQYbxbFTBvYM1LoegXHn7P',
  sol: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
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
  quote: OneClickQuote
}

export type NearSwapStatus = 'KNOWN_DEPOSIT_TX' | 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED'

export interface NearStatusResponse {
  status: NearSwapStatus
  updatedAt?: string
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
  const response = await fetch(`${ONE_CLICK_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
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
// same contract or, for a chain's own coin, no contract and its ticker. Contracts compare without case because
// THORChain upper-cases them, base58 ones too (`TRON.USDT-TR7NHQ…`).
export const findNearToken = (list: OneClickToken[], identifier: string) => {
  const dot = identifier.indexOf('.')
  const blockchain = CHAINS[identifier.slice(0, dot).toUpperCase()]
  if (dot < 0 || !blockchain) return undefined
  const rest = identifier.slice(dot + 1)
  const dash = rest.indexOf('-')
  const ticker = (dash < 0 ? rest : rest.slice(0, dash)).toUpperCase()
  const contract = dash < 0 ? undefined : rest.slice(dash + 1)
  return list.find(
    t =>
      t.blockchain === blockchain &&
      (contract ? t.contractAddress?.toLowerCase() === contract.toLowerCase() : !t.contractAddress && t.symbol.toUpperCase() === ticker)
  )
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
  const deadline = quote.deadline ? Math.floor(Date.parse(quote.deadline) / 1000) : NaN
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

// A quote between `sellAsset` and `buyAsset`, one of them native BCH; undefined when NEAR Intents lists either side.
export const getNearQuote = async (req: NearQuoteRequest & { sourceAddress?: string }, signal?: AbortSignal): Promise<NearRoute | undefined> => {
  if (req.sellAsset.toUpperCase() !== BridgeConfig.buyAsset && req.buyAsset.toUpperCase() !== BridgeConfig.buyAsset) return undefined
  const list = await getNearTokens()
  const origin = findNearToken(list, req.sellAsset)
  const destination = findNearToken(list, req.buyAsset)
  if (!origin || !destination) return undefined
  const response = await request<OneClickQuoteResponse>('/quote', { method: 'POST', body: nearQuoteBody(req, origin, destination), signal })
  if (!req.dry && !response.quote.depositAddress) throw new Error('NEAR Intents returned no deposit address')
  return nearRoute(response, req, origin, destination)
}

// What the operation keeps of an executable route (it has a deposit address).
export const nearLegOf = (route: NearRoute): NearLeg => ({
  depositAddress: route.near.quote.depositAddress!,
  correlationId: route.near.correlationId,
  signature: route.near.signature,
  quotedAt: route.near.timestamp,
  deadline: route.near.quote.deadline,
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
