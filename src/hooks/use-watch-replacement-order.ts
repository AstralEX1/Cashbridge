import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { USwapNumber } from '@tcswap/core'
import { getTxStatus } from '@/lib/api'
import { ORDER_POLL_MS } from '@/lib/limit-swap'
import { findOrderRefund } from '@/lib/memo-helpers'
import { useMarkReplacementRefunded, useReplacementOrder } from '@/store/replacement-order-store'

// A refund that never shows up should not be polled for forever.
const GIVE_UP_MS = 24 * 60 * 60 * 1000

// Watches the cancelled order for its refund outbound. THORChain publishes the refund against the
// order's own inbound hash, and `out_txs` only appears once bifrost has observed the outbound on the
// source chain - by which point the deposit is back in the wallet and the replacement can be placed.
export const useWatchReplacementOrder = () => {
  const replacement = useReplacementOrder()
  const markRefunded = useMarkReplacementRefunded()

  const orderTxId = replacement?.orderTxId
  const createdAt = replacement?.createdAt ?? 0

  const { data } = useQuery({
    queryKey: ['tx-status', orderTxId],
    queryFn: () => getTxStatus(orderTxId!),
    enabled: !!orderTxId && !replacement?.refunded,
    // Evaluated on every tick, so the give-up is enforced without needing a re-render.
    refetchInterval: () => (Date.now() - createdAt > GIVE_UP_MS ? false : ORDER_POLL_MS),
    retry: false
  })

  useEffect(() => {
    if (!replacement || replacement.refunded) return

    // Orders parked before the sender was stored fall back to the inbound's own sender.
    const recipient = replacement.refundAddress ?? data?.tx?.from_address
    if (!recipient) return

    const refund = findOrderRefund(data, { asset: replacement.assetFrom.identifier, chain: replacement.assetFrom.chain, recipient })
    if (!refund) return

    markRefunded(USwapNumber.fromBigInt(BigInt(refund), 8).toSignificant())
  }, [data, replacement, markRefunded])
}
