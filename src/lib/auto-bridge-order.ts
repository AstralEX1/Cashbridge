import { BridgeConfig } from '@/config'
import { addressToLockingBytecode } from '@/lib/bch'
import { orderBinding, saleBinding } from '@/lib/router-contract'
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
  // The deposit must be the contract of exactly these terms, so the Router can only pay the customer from it.
  if (order.sale) {
    const terms = {
      routerKey: order.contract?.routerKey ?? '',
      vaultScript: addressToLockingBytecode(order.sale.vaultAddress) ?? '',
      memo: order.sale.memo,
      refundScript: addressToLockingBytecode(order.refundAddress) ?? '',
      minSats: order.minPusd,
      refundAfter: order.contract?.refundAfter ?? 0,
      ...(order.sale.depositSats !== undefined && { depositSats: order.sale.depositSats })
    }
    if (!order.contract || saleBinding(terms, 0).cashAddress !== order.depositAddress) throw new Error('The automatic order address is not its contract')
  } else if (order.contract) {
    const terms = {
      ...order.contract,
      recipientScript: addressToLockingBytecode(order.recipientAddress) ?? '',
      refundScript: addressToLockingBytecode(order.refundAddress) ?? '',
      category: order.category ?? BridgeConfig.pusd.category,
      minPusd: order.minPusd
    }
    if (orderBinding(terms, 0).cashAddress !== order.depositAddress) throw new Error('The automatic order address is not its contract')
  }
  return order
}
