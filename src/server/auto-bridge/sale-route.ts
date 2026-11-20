import { addressToLockingBytecode } from '@/lib/bch'
import type { SaleIntent } from '@/lib/auto-bridge-contract'
import { NEAR_BCH, type NearStatusResponse } from '@/lib/near-intents'
import { sameAddress } from '@/lib/payout-chains'
import { REFUND_FEE_CAP } from '@/lib/router-contract'

// How long a routed sale's deposit address must stay open when the order is made (the customer still sends the tokens,
// and the Router sells them within its wait) and when the Router deposits (NEAR Intents counts BCH once it confirms).
export const SALE_ROUTE_OPEN_MS = 2 * 60 * 60_000
export const SALE_ROUTE_DEPOSIT_MS = 60 * 60_000

// A routed sale pays a one-use NEAR Intents deposit address: its own quote ('near', any amount from the minimum up) or
// one ShapeShift made ('shapeshift', exactly `depositSats`). 1Click's status of the address carries the signed quote,
// which must swap native BCH to the sale's asset for its destination and refund the customer. Undefined when it does.
// `destinationAsset` is 1Click's id for the sale's asset; without it the assets were already checked at creation.
export const saleRouteProblem = (
  status: NearStatusResponse | undefined,
  sale: SaleIntent,
  terms: { refundScript: string; minSats: bigint },
  until: number,
  destinationAsset?: string
): string | undefined => {
  const request = status?.quoteResponse?.quoteRequest
  const quote = status?.quoteResponse?.quote
  if (!status || !request || !quote) return 'NEAR Intents does not know this deposit address'
  if (status.status !== 'PENDING_DEPOSIT') return 'The deposit address was already used'
  if (quote.depositAddress !== sale.vaultAddress) return 'The quote is for another deposit address'
  if (request.originAsset !== NEAR_BCH || (destinationAsset !== undefined && request.destinationAsset !== destinationAsset))
    return 'The quote does not swap BCH to the asked asset'
  if (!request.recipient || !sameAddress(request.recipient, sale.destination)) return 'The quote pays another recipient'
  if (!request.refundTo || addressToLockingBytecode(request.refundTo) !== terms.refundScript) return 'The quote refunds another address'
  const deadline = Date.parse(request.deadline ?? '')
  if (!Number.isFinite(deadline) || deadline < until) return 'The quote expires too soon'
  if (sale.route === 'shapeshift') {
    if (request.swapType !== 'EXACT_INPUT' || !sale.depositSats || quote.amountIn !== sale.depositSats || request.amount !== sale.depositSats)
      return 'The quote is not for the exact deposit'
    return undefined
  }
  // The deposit is the sale's BCH less a miner fee within the contract's cap.
  if (request.swapType !== 'FLEX_INPUT' || !/^\d{1,16}$/.test(quote.minAmountIn ?? '') || BigInt(quote.minAmountIn!) > terms.minSats - REFUND_FEE_CAP)
    return 'The quote asks for more BCH than the sale guarantees'
  return undefined
}
