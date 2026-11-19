// Browser-safe order contract. No worker, database or signing imports belong here.
export type OrderState = 'awaiting_deposit' | 'streaming' | 'awaiting_confirmations' | 'ready' | 'retrying' | 'broadcasting' | 'submitted' | 'completed' | 'refunded' | 'source_refunded' | 'manual_review'

export interface AutomaticSource {
  chain: string
  asset: string
  amount: string
  address: string
}
export interface OrderIntent {
  recipientAddress: string
  refundAddress: string
  expectedBchSats: string
  source?: AutomaticSource
}
export interface Settlement {
  kind: 'swap' | 'refund'
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
  evidence: 'thorchain'
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
  attempts: { txid: string; kind: 'swap' | 'refund'; pusdOut: string; status: 'signed' | 'unknown' | 'rejected' | 'accepted' }[]
}
export const isTerminal = (state: OrderState) => ['completed', 'refunded', 'source_refunded', 'manual_review'].includes(state)
export const automaticEligible = (reverse: boolean, category: string | undefined, pusdCategory: string) => !reverse && category === pusdCategory
