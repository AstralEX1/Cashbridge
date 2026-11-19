// Browser-safe order contract. No worker, database or signing imports belong here.
export type OrderState = 'awaiting_deposit' | 'streaming' | 'awaiting_confirmations' | 'ready' | 'retrying' | 'broadcasting' | 'submitted' | 'completed' | 'refunded' | 'source_refunded' | 'manual_review'

export interface AutomaticSource {
  chain: string
  asset: string
  amount: string
  address: string
}
// A transfer back from BCH: the customer sends `tokenAmount` of the token to the order's sale contract, and the
// Router sells it and pays the BCH to THORChain's vault with `memo`, which swaps it to `buyAsset` for `destination`.
export interface SaleIntent {
  category: string
  tokenAmount: string
  buyAsset: string
  destination: string
  memo: string
  vaultAddress: string
}
export const SALE_KEYS = ['category', 'tokenAmount', 'buyAsset', 'destination', 'memo', 'vaultAddress'] as const
export const sameSale = (a?: SaleIntent, b?: SaleIntent) => (!a && !b) || (!!a && !!b && SALE_KEYS.every(key => a[key] === b[key]))

export interface OrderIntent {
  // The customer's BCH address. For a sale it is also where unsold tokens or returned BCH go, equal to the refund address.
  recipientAddress: string
  refundAddress: string
  // The BCH the first leg brings: THORChain's payout, or for a sale what selling the tokens is quoted at.
  expectedBchSats: string
  // The Cauldron token the Router buys (hex category); PUSD when absent.
  category?: string
  source?: AutomaticSource
  sale?: SaleIntent
}
export interface Settlement {
  // A sale settles with its THORChain deposit, or a refund of the coins.
  kind: 'swap' | 'refund' | 'deposit'
  txid: string
  seen: boolean
  confirmations: number
  pusdAmount: string
  bchAmount: string
  recipientAddress: string
  refundAddress: string
}
export interface SourceRefund {
  asset: string
  amount: string
  txid?: string
  pending: boolean
  evidence: 'thorchain' | 'near_intents'
}
export interface PublicOrder extends OrderIntent {
  apiVersion?: 2
  id: string
  depositAddress: string
  // Present when the deposit is the order's contract: with the addresses and amounts above, it gives the address.
  contract?: { routerKey: string; refundAfter: number }
  minPusd: string
  maxWaitSeconds: number
  state: OrderState
  createdAt: number
  updatedAt: number
  sourceHash?: string
  inboundHash?: string
  // Set when the first leg goes through NEAR Intents: the source deposits here, and 1Click pays the order address.
  nearDepositAddress?: string
  receivedSats: string
  receivedAt?: number
  bchReceipts?: { txid: string; amountSats: string; confirmations: number }[]
  deadline?: number
  payoutTxid?: string
  settlement?: Settlement
  sourceRefunds?: SourceRefund[]
  recoveryRequired?: boolean
  recoverySats?: string
  error?: string
  attempts: { txid: string; kind: 'swap' | 'refund' | 'deposit'; pusdOut: string; status: 'signed' | 'unknown' | 'rejected' | 'accepted' }[]
}
// One order as the public scanner lists it: what the chains show anyway. No addresses, order id or capability.
export interface FeedOrder {
  // A short hash of the order id, stable across reads.
  ref: string
  kind: 'forward' | 'sale'
  state: OrderState
  createdAt: number
  updatedAt: number
  contract: boolean
  // The first leg went through NEAR Intents rather than THORChain.
  near?: boolean
  // The token bought (forward) or sold (sale).
  category: string
  expectedBchSats: string
  source?: { chain: string; asset: string; amount: string }
  sale?: { tokenAmount: string; buyAsset: string }
  sourceHash?: string
  bchReceipts: { txid: string; amountSats: string }[]
  settlement?: { kind: 'swap' | 'refund' | 'deposit'; txid: string; tokenAmount: string; bchAmount: string }
}
const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/
const STATES: OrderState[] = [
  'awaiting_deposit',
  'streaming',
  'awaiting_confirmations',
  'ready',
  'retrying',
  'broadcasting',
  'submitted',
  'completed',
  'refunded',
  'source_refunded',
  'manual_review'
]
// The worker is ours, but its answer still crosses the network: the scanner builds explorer links from these hashes.
export const isFeedOrder = (value: unknown): value is FeedOrder => {
  const o = value as FeedOrder
  return (
    !!o &&
    typeof o.ref === 'string' &&
    ['forward', 'sale'].includes(o.kind) &&
    STATES.includes(o.state) &&
    Number.isFinite(o.createdAt) &&
    /^[0-9a-f]{64}$/.test(o.category) &&
    /^\d+$/.test(o.expectedBchSats) &&
    Array.isArray(o.bchReceipts) &&
    o.bchReceipts.every(r => HEX64.test(r?.txid) && /^\d+$/.test(r.amountSats)) &&
    (o.sourceHash === undefined || /^[0-9a-zA-Z-]{64,88}$/.test(o.sourceHash)) &&
    (o.near === undefined || typeof o.near === 'boolean') &&
    (o.settlement === undefined ||
      (HEX64.test(o.settlement.txid) && /^\d+$/.test(o.settlement.tokenAmount) && /^\d+$/.test(o.settlement.bchAmount))) &&
    (o.source === undefined || ['chain', 'asset', 'amount'].every(key => typeof o.source![key as 'chain'] === 'string')) &&
    (o.sale === undefined || (/^\d+$/.test(o.sale.tokenAmount) && typeof o.sale.buyAsset === 'string'))
  )
}
export const isTerminal = (state: OrderState) => ['completed', 'refunded', 'source_refunded', 'manual_review'].includes(state)
// The Router buys any Cauldron token on a forward transfer, and sells one on a transfer back when sales are on.
export const automaticEligible = (reverse: boolean, category: string | undefined, sales = false) => !!category && (!reverse || sales)
