import { formatBaseUnits } from '@/lib/bridge'
import { confirmPayout, destinationChainOf, payoutByHash } from '@/lib/reverse-bridge'
import { getNearStatus, interpretNearStatus } from '@/lib/near-intents'
import { getShapeShiftStatus, interpretShapeShiftStatus } from '@/lib/shapeshift'
import { getTransferStatus } from '@/lib/transfer-status'
import type { SwapTransaction } from '@/store/transaction-store'

// ShapeShift names the payout; it counts once the destination chain shows it paying the destination at least the minimum.
const syncShapeShiftSwap = async (tx: SwapTransaction, quoteId: string): Promise<Partial<SwapTransaction>> => {
  const view = interpretShapeShiftStatus(await getShapeShiftStatus(quoteId))
  if (view.kind === 'failed') return { hash: tx.hash, status: 'failed' }
  if (view.kind === 'pending') return { hash: tx.hash, status: 'pending' }
  const payout = await payoutByHash(destinationChainOf(tx.assetTo.identifier), view.txid, { destination: tx.addressTo, buyAsset: tx.assetTo.identifier }).catch(() => undefined)
  if (!payout || BigInt(payout.amount) < BigInt(tx.networkSwap!.minOutput)) return { hash: tx.hash, status: 'pending' }
  return { hash: tx.hash, status: 'completed', amountTo: formatBaseUnits(payout.amount, tx.assetTo.decimals), networkSwap: { ...tx.networkSwap!, payout } }
}

// 1Click names the payouts; together they count once the destination chain shows them paying at least the minimum.
const syncNearSwap = async (tx: SwapTransaction, depositAddress: string): Promise<Partial<SwapTransaction>> => {
  const view = interpretNearStatus(await getNearStatus(depositAddress))
  if (view.kind === 'refunded') return { hash: tx.hash, status: 'refunded' }
  if (view.kind === 'failed') return { hash: tx.hash, status: 'failed' }
  if (view.kind === 'pending') return { hash: tx.hash, status: 'pending' }
  const chain = destinationChainOf(tx.assetTo.identifier)
  const payouts = await Promise.all(view.txids.map(txid => payoutByHash(chain, txid, { destination: tx.addressTo, buyAsset: tx.assetTo.identifier }).catch(() => undefined)))
  const paid = payouts.filter(p => !!p)
  const amount = paid.reduce((sum, p) => sum + BigInt(p.amount), 0n)
  if (!paid.length || amount < BigInt(tx.networkSwap!.minOutput)) return { hash: tx.hash, status: 'pending' }
  const payout = { hash: paid[0].hash, amount: amount.toString() }
  return { hash: tx.hash, status: 'completed', amountTo: formatBaseUnits(amount, tx.assetTo.decimals), networkSwap: { ...tx.networkSwap!, payout } }
}

export const syncNetworkSwap = async (tx: SwapTransaction): Promise<Partial<SwapTransaction>> => {
  if (!tx.hash || !tx.networkSwap) return {}
  if (tx.networkSwap.near) return syncNearSwap(tx, tx.networkSwap.near.depositAddress)
  if (tx.networkSwap.shapeshift) return syncShapeShiftSwap(tx, tx.networkSwap.shapeshift.quoteId)
  const source = await getTransferStatus(tx.assetFrom.chain, tx.hash)
  if (source === 'failed') return { hash: tx.hash, status: 'failed' }
  if (source !== 'completed') return { hash: tx.hash, status: 'pending' }
  const payout = await confirmPayout({ depositTxid: tx.hash, buyAsset: tx.assetTo.identifier, destination: tx.addressTo })
  if (!payout || BigInt(payout.amount) < BigInt(tx.networkSwap.minOutput)) return { hash: tx.hash, status: 'pending' }
  return {
    hash: tx.hash, status: 'completed', amountTo: formatBaseUnits(payout.amount, tx.assetTo.decimals),
    networkSwap: { ...tx.networkSwap, payout }
  }
}
