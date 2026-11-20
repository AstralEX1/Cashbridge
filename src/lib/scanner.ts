import { getExplorerTxUrl, type Chain } from '@tcswap/core'
import type { FeedOrder, OrderState } from '@/lib/auto-bridge-contract'
import { formatBaseUnits } from '@/lib/bridge'
import { FEATURED_TOKENS } from '@/lib/cauldron-tokens'
import type { Run } from '@/lib/mainnet-runs'
import { isEvmChain } from '@/lib/payout-chains'
import { nearExplorerUrl } from '@/lib/near-intents'

// The scanner's view of one transfer, from a Cashbridge Router order or from a run verified by hand.
export type ScanStatus = 'completed' | 'pending' | 'refunded' | 'review'
export interface ScanSide {
  amount?: string
  ticker: string
  chain: string
  icon?: string
  // The chain's mark on the coin, when the coin alone does not say which chain it is on.
  badge?: string
}
export interface ScanLeg {
  label: string
  url: string
  hash: string
  // The chain whose explorer the link opens.
  icon?: string
}
export interface ScanRow {
  key: string
  // Router orders carry the time they were created; a verified run carries its date as written in the proof table.
  time?: number
  date?: string
  router: boolean
  verified: boolean
  from: ScanSide
  to: ScanSide
  status: ScanStatus
  legs: ScanLeg[]
}

// Chains with a logo in public/networks.
const CHAIN_ICONS = new Set(['arb', 'avax', 'base', 'bch', 'bsc', 'btc', 'doge', 'eth', 'gaia', 'ltc', 'near', 'op', 'pol', 'sol', 'thor', 'tron', 'xrp', 'zec'])
export const chainIcon = (chain: string) => (CHAIN_ICONS.has(chain.toLowerCase()) ? `/networks/${chain.toLowerCase()}.svg` : undefined)

const CHAIN_NAMES: Record<string, string> = {
  ARB: 'Arbitrum',
  AVAX: 'Avalanche',
  BASE: 'Base',
  BCH: 'Bitcoin Cash',
  BSC: 'BNB Chain',
  BTC: 'Bitcoin',
  DOGE: 'Dogecoin',
  ETH: 'Ethereum',
  GAIA: 'Cosmos',
  LTC: 'Litecoin',
  OP: 'Optimism',
  POL: 'Polygon',
  SOL: 'Solana',
  THOR: 'THORChain',
  TRON: 'TRON',
  XRP: 'XRP Ledger',
  ZEC: 'Zcash'
}
export const chainName = (chain: string) => CHAIN_NAMES[chain.toUpperCase()] ?? chain

// Coins with a mark in public/, and the chain each native coin belongs to.
const TICKER_ICONS: Record<string, string> = {
  BTC: 'btc', ETH: 'eth', BNB: 'bsc', AVAX: 'avax', SOL: 'sol', DOGE: 'doge', LTC: 'ltc', XRP: 'xrp', TRX: 'tron', ATOM: 'gaia', RUNE: 'thor', ZEC: 'zec', BCH: 'bch'
}
const DOLLARS: Record<string, string> = { USDC: '/tokens/usdc.svg', USDT: '/tokens/usdt.svg' }
const NATIVE_CHAIN: Record<string, string> = { BNB: 'BSC', TRX: 'TRON', ATOM: 'GAIA', RUNE: 'THOR' }
const mark = (ticker: string, chain: string, icon?: string): Pick<ScanSide, 'icon' | 'badge'> => {
  const t = ticker.toUpperCase()
  const own = icon ?? DOLLARS[t] ?? (TICKER_ICONS[t] && chainIcon(TICKER_ICONS[t]))
  const native = TICKER_ICONS[t] && (NATIVE_CHAIN[t] ?? t) === chain.toUpperCase()
  const badge = native ? undefined : chainIcon(chain)
  return { ...(own && { icon: own }), ...(badge && { badge }) }
}

// Explorers by address, for the chain mark on each step's link.
const EXPLORERS: [RegExp, string][] = [
  [/thorchain\.net|runescan/, 'thor'],
  [/near-intents/, 'near'],
  [/bitcoin-cash|bch\.|cashscript|salemkode/, 'bch'],
  [/bscscan/, 'bsc'],
  [/snowscan|snowtrace|avascan/, 'avax'],
  [/basescan/, 'base'],
  [/arbiscan/, 'arb'],
  [/optimistic\.etherscan/, 'op'],
  [/polygonscan/, 'pol'],
  [/etherscan/, 'eth'],
  [/solscan|solana\.fm/, 'sol'],
  [/tronscan/, 'tron'],
  [/xrpscan|xrpl/, 'xrp'],
  [/mintscan/, 'gaia'],
  [/blockchair\.com\/bitcoin\/|mempool\.space/, 'btc'],
  [/litecoin/, 'ltc'],
  [/dogecoin/, 'doge'],
  [/zcash/, 'zec']
]
export const explorerIcon = (url: string) => {
  const found = EXPLORERS.find(([pattern]) => pattern.test(url))
  return found && chainIcon(found[1])
}
const leg = (label: string, url: string, hash: string, mark?: string): ScanLeg => {
  const icon = mark ?? explorerIcon(url)
  return { label, url, hash, ...(icon && { icon }) }
}

const tokenOf = (category: string) => FEATURED_TOKENS.find(token => token.category === category)
const bchSide = (category: string, amount?: string): ScanSide => {
  const token = tokenOf(category)
  return {
    ticker: token?.ticker ?? `${category.slice(0, 6)}…`,
    chain: 'BCH',
    ...mark('', 'BCH', token?.icon),
    // A token outside the pinned list has unknown decimals here, so its amount is left to the explorer.
    ...(token && amount !== undefined && { amount: formatBaseUnits(amount, token.decimals) })
  }
}
// THORChain asset ids: CHAIN.TICKER or CHAIN.TICKER-CONTRACT.
const assetSide = (asset: string, amount?: string): ScanSide => {
  const [chain, rest = ''] = asset.split('.')
  const ticker = rest.split('-')[0] || chain
  return { ticker, chain, ...mark(ticker, chain), ...(amount !== undefined && { amount }) }
}

export const thorchainTxUrl = (hash: string) => `https://thorchain.net/tx/${hash.replace(/^0x/i, '').toLowerCase()}`
export const bchTxUrl = (txid: string) => getExplorerTxUrl({ chain: 'BCH' as Chain, txHash: txid })
const sourceTxUrl = (chain: string, hash: string) =>
  getExplorerTxUrl({ chain: chain as Chain, txHash: isEvmChain(chain) && /^[0-9a-f]{64}$/i.test(hash) ? `0x${hash}` : hash }) || thorchainTxUrl(hash)

const STATUS: Partial<Record<OrderState, ScanStatus>> = {
  completed: 'completed',
  refunded: 'refunded',
  source_refunded: 'refunded',
  manual_review: 'review'
}

// The bridge that carried the order's BCH leg, and its own tracker for that leg.
const bridgeOf = (order: FeedOrder) => (order.shapeshift ? 'ShapeShift' : order.near ? 'NEAR Intents' : 'THORChain')
const bridgeLeg = (order: FeedOrder, thorchainHash: string) =>
  !order.near
    ? leg('THORChain swap', thorchainTxUrl(thorchainHash), thorchainHash)
    : order.nearDeposit
      ? leg(`${bridgeOf(order)} swap`, nearExplorerUrl(order.nearDeposit), order.nearDeposit, order.shapeshift ? '/providers/shapeshift.svg' : undefined)
      : undefined

export const rowFromOrder = (order: FeedOrder): ScanRow => {
  const legs: ScanLeg[] = []
  const add = (step?: ScanLeg) => step && legs.push(step)
  const paid = order.settlement
  if (order.kind === 'forward') {
    if (order.sourceHash && order.source) {
      add(leg(`${chainName(order.source.chain)} deposit`, sourceTxUrl(order.source.chain, order.sourceHash), order.sourceHash))
      add(bridgeLeg(order, order.sourceHash))
    } else if (order.near) add(bridgeLeg(order, ''))
    for (const receipt of order.bchReceipts) add(leg('BCH to order', bchTxUrl(receipt.txid), receipt.txid))
    if (paid) add(leg(paid.kind === 'refund' ? 'BCH refund' : `${bchSide(order.category).ticker} payout`, bchTxUrl(paid.txid), paid.txid))
  } else {
    for (const receipt of order.bchReceipts) add(leg('Tokens to contract', bchTxUrl(receipt.txid), receipt.txid))
    if (paid?.kind === 'deposit') {
      add(leg(`Sale and ${bridgeOf(order)} deposit`, bchTxUrl(paid.txid), paid.txid))
      add(bridgeLeg(order, paid.txid))
    } else if (paid) add(leg('Refund', bchTxUrl(paid.txid), paid.txid))
  }
  const bch = (sats: string): ScanSide => ({ ticker: 'BCH', chain: 'BCH', ...mark('BCH', 'BCH'), amount: formatBaseUnits(sats, 8) })
  // An order saved without its source starts at the BCH that reached the Router.
  const from =
    order.kind === 'sale' && order.sale
      ? bchSide(order.category, order.sale.tokenAmount)
      : order.source
        ? assetSide(order.source.asset, order.source.amount)
        : bch(order.expectedBchSats)
  const to =
    order.kind === 'sale' && order.sale
      ? assetSide(order.sale.buyAsset)
      : paid?.kind === 'refund'
        ? bch(paid.bchAmount)
        : bchSide(order.category, paid?.tokenAmount)
  return { key: order.ref, time: order.createdAt, router: true, verified: false, from, to, status: STATUS[order.state] ?? 'pending', legs }
}

const side = (text: string): ScanSide => {
  const [amount, ticker = ''] = text.trim().split(/\s+/)
  const token = FEATURED_TOKENS.find(t => t.ticker === ticker)
  const chain = token || ticker === 'BCH' ? 'BCH' : ticker === 'BNB' ? 'BSC' : ticker
  return { amount, ticker, chain, ...mark(ticker, chain, token?.icon) }
}

// A proof-table run: its amounts read "0.0062 BNB → 0.01639004 BCH → 3.39 PUSD", first and last are the two ends.
export const rowFromRun = (run: Run): ScanRow => {
  const amounts = run.amounts.split('→')
  return {
    key: run.links[0][1],
    date: run.date,
    router: !!run.router,
    verified: true,
    from: side(amounts[0]),
    to: side(amounts[amounts.length - 1]),
    status: 'completed',
    legs: run.links.map(([label, url]) => leg(label, url, url.slice(url.lastIndexOf('/') + 1)))
  }
}

// Router orders first (newest first), then the verified runs, newest last-added first; a run the Router feed also lists is kept once.
export const scanRows = (orders: FeedOrder[], runs: Run[]) => {
  const live = orders.map(rowFromOrder).sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  const seen = new Set(live.flatMap(row => row.legs.map(leg => normalHash(leg.hash))))
  return [
    ...live,
    ...runs
      .map(rowFromRun)
      .reverse()
      .filter(row => !row.legs.some(leg => seen.has(normalHash(leg.hash))))
  ]
}

const normalHash = (hash: string) => hash.replace(/^0x/i, '').toLowerCase()

export const matchesQuery = (row: ScanRow, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hash = normalHash(q)
  return (
    row.legs.some(leg => normalHash(leg.hash).includes(hash)) ||
    [row.from, row.to].some(s => s.ticker.toLowerCase() === q || s.chain.toLowerCase() === q || chainName(s.chain).toLowerCase().includes(q))
  )
}

// Where to look up a hash the list does not have.
export const hashLookups = (query: string): ScanLeg[] => {
  const q = query.trim()
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(q)) return []
  return [
    leg('THORChain explorer', thorchainTxUrl(q), q),
    ...(q.startsWith('0x') ? [] : [leg('Bitcoin Cash explorer', bchTxUrl(q), q)])
  ]
}

export const shortHash = (hash: string) => (hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash)
