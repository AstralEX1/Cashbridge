import type { BchBinding, VerifiedOutput } from '@/lib/bch'

import type { OrderIntent, OrderState, SourceRefund } from '@/lib/auto-bridge-contract'
export type { OrderIntent, OrderState, PublicOrder } from '@/lib/auto-bridge-contract'
export { isTerminal } from '@/lib/auto-bridge-contract'

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
  funding: VerifiedOutput[]
  receivedAt?: number
  deadline?: number
  payoutTxid?: string
  error?: string
  observedFunding?: VerifiedOutput[]
  lastCheckedAt?: number
  sourceRefunds?: SourceRefund[]
  observation?: { txid: string; seen: boolean; confirmations: number }
}
export interface Attempt {
  txid: string
  hex: string
  kind: 'swap' | 'refund'
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
