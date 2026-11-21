import { BridgeConfig } from '@/config'
import { addressToLockingBytecode } from '@/lib/bch'
import { minOutputFor } from '@/lib/bridge'
import { orderBinding, REFUND_AFTER_SECONDS, SALE_FLOOR_TOLERANCE_BPS, saleBinding, type OrderTerms, type SaleTerms } from '@/lib/router-contract'
import { sameSale, type OrderIntent, type PublicOrder } from '@/lib/auto-bridge-contract'

// Every order the Router answers with, for the page and the agent endpoint alike: it is this order, it echoes the
// terms it was asked for, and its deposit is the contract of exactly those terms.
export const checkOrder = (order: PublicOrder | undefined, id: string, intent?: OrderIntent): PublicOrder => {
  if (!order) throw new Error('The automatic order response is invalid')
  if (order.id !== id || !addressToLockingBytecode(order.depositAddress) || !/^[1-9]\d*$/.test(order.minPusd))
    throw new Error('The automatic order response is invalid')
  if (intent && (order.expectedBchSats !== intent.expectedBchSats ||
    addressToLockingBytecode(order.recipientAddress) !== addressToLockingBytecode(intent.recipientAddress) ||
    addressToLockingBytecode(order.refundAddress) !== addressToLockingBytecode(intent.refundAddress) ||
    order.category !== intent.category ||
    !sameSale(order.sale, intent.sale)))
    throw new Error('The automatic order does not match the confirmed transfer')
  // Nobody can be made to wait for a refund much past the Router's own three hours.
  if (order.contract && (!Number.isSafeInteger(order.contract.refundAfter) || order.contract.refundAfter * 1000 > Date.now() + (REFUND_AFTER_SECONDS + 3600) * 1000))
    throw new Error('The automatic order response is invalid')
  // The deposit must be the contract of exactly these terms, so the Router can only pay the customer from it.
  if (order.sale) {
    if (!order.contract || saleBinding(saleTermsOf(order), 0).cashAddress !== order.depositAddress) throw new Error('The automatic order address is not its contract')
  } else if (order.contract) {
    const { version, pageKey } = order.contract
    if (version !== undefined && (version !== 2 || !/^0[23][0-9a-f]{64}$/.test(pageKey ?? ''))) throw new Error('The automatic order response is invalid')
    // A Router that knows the page key must name it, or the page could not settle its own order.
    if (intent?.pageKey && version === 2 && pageKey !== intent.pageKey) throw new Error('The automatic order does not match the confirmed transfer')
    if (orderBinding(orderTermsOf(order), 0).cashAddress !== order.depositAddress) throw new Error('The automatic order address is not its contract')
  }
  return order
}

// A forward order about to be paid must pay through its contract, at a minimum near this side's own Cauldron quote of
// the same BCH (`secondLegSellAmount` of its expected sats). Saved orders from before contracts still poll through checkOrder.
export const checkNewOrder = (order: PublicOrder, quotedOutput?: bigint) => {
  if (!order.contract) throw new Error('The Cashbridge Router answered without an order contract')
  if (quotedOutput !== undefined && BigInt(order.minPusd) < minOutputFor(quotedOutput, BridgeConfig.pusdSlippageBps + SALE_FLOOR_TOLERANCE_BPS))
    throw new Error('The Cashbridge Router offered a lower minimum than this quote')
  return order
}

// The terms of a forward order's contract, from the order the Router answered with.
export const orderTermsOf = (order: PublicOrder): OrderTerms => ({
  routerKey: order.contract?.routerKey ?? '',
  refundAfter: order.contract?.refundAfter ?? 0,
  recipientScript: addressToLockingBytecode(order.recipientAddress) ?? '',
  refundScript: addressToLockingBytecode(order.refundAddress) ?? '',
  category: order.category ?? BridgeConfig.pusd.category,
  minPusd: order.minPusd,
  ...(order.contract?.version === 2 && { version: 2 as const, pageKey: order.contract.pageKey, quotedSats: order.expectedBchSats })
})

// The terms of a sale order's contract, from the order the Router answered with.
export const saleTermsOf = (order: PublicOrder): SaleTerms => ({
  routerKey: order.contract?.routerKey ?? '',
  vaultScript: addressToLockingBytecode(order.sale?.vaultAddress ?? '') ?? '',
  memo: order.sale?.memo ?? '',
  refundScript: addressToLockingBytecode(order.refundAddress) ?? '',
  minSats: order.minPusd,
  refundAfter: order.contract?.refundAfter ?? 0,
  ...(order.sale?.depositSats !== undefined && { depositSats: order.sale.depositSats })
})
