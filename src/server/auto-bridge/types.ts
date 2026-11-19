import type { BchBinding, VerifiedOutput } from '@/lib/bch'

import type { OrderIntent, OrderState, SourceRefund } from '@/lib/auto-bridge-contract'
export type { OrderIntent, OrderState, PublicOrder } from '@/lib/auto-bridge-contract'
export { isTerminal } from '@/lib/auto-bridge-contract'
import { BridgeConfig } from '@/config'

export const orderCategory = (intent: Pick<OrderIntent, 'category'>) => intent.category ?? BridgeConfig.pusd.category

// A coin at a sale contract, with the token it carries.
export interface SaleCoin extends VerifiedOutput {
  token?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } }
}

export interface Order extends OrderIntent {
  id: string
  addressIndex: number
  binding: BchBinding
  recipientScript: string
  refundScript: string
  minPusd: string
  maxWaitMs: number
  state: OrderState
  version: number
  createdAt: number
  updatedAt: number
  inboundHash?: string
  sourceHash?: string
  // The 1Click deposit address of a NEAR Intents first leg, set once before the source is sent.
  nearDepositAddress?: string
  funding: VerifiedOutput[]
  receivedAt?: number
  deadline?: number
  payoutTxid?: string
  error?: string
  observedFunding?: VerifiedOutput[]
  lastCheckedAt?: number
  sourceRefunds?: SourceRefund[]
  observation?: { txid: string; seen: boolean; confirmations: number }
  // Set when the deposit is the order's contract (src/lib/router-contract.ts) rather than a plain address.
  contract?: { refundAfter: number }
}
export interface Attempt {
  txid: string
  hex: string
  // A sale order signs its Cauldron sale ('swap') together with the THORChain 'deposit' that spends it.
  kind: 'swap' | 'refund' | 'deposit'
  // The sale a deposit spends.
  parent?: string
  pusdOut: string
  status: 'signed' | 'unknown' | 'rejected' | 'accepted'
  // Definite node refusals of these bytes after a lost first answer.
  refusals?: number
}
export interface Limits {
  maxOrderSats: bigint
  maxPendingSats: bigint
  maxOpenOrders: number
}
export class OrderError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export const positiveAmount = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || BigInt(value) > 2_100_000_000_000_000n)
    throw new OrderError(400, 'Invalid base-unit amount')
  return value
}
