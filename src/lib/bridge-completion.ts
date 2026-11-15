import { Chain } from '@tcswap/core'
import { sourceTransactionId } from '@/lib/source-transaction'
import type { BridgeOperation, SwapTransaction } from '@/store/transaction-store'

export interface CompletionTransaction {
  key: string
  kind: 'bridgeFrom' | 'receiveOn' | 'swapOnCauldron' | 'refundOn'
  chain: Chain
  hash: string
}

// Read the operation, not dismissible toasts: every delivered transaction stays in the receipt.
export const bridgeCompletionTransactions = (tx: SwapTransaction & { bridge: BridgeOperation }): CompletionTransaction[] => {
  const op = tx.bridge
  if (op.stage !== 'completed' && op.stage !== 'kept_bch') return []
  const transactions: CompletionTransaction[] = []
  const seen = new Set<string>()
  const add = (kind: CompletionTransaction['kind'], chain: Chain, hash?: string) => {
    if (typeof hash !== 'string') return
    // Preserve older alphanumeric receipt IDs; only source authorization uses the strict parser.
    const id = sourceTransactionId(hash) ?? (/^[a-zA-Z0-9]+$/.test(hash) ? hash : undefined)
    if (!id) return
    const key = `${chain}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    transactions.push({ key, kind, chain, hash: hash.replace(/-\d+$/, '') })
  }

  if (op.direction === 'reverse') {
    add('swapOnCauldron', Chain.BitcoinCash, op.reverse?.sale?.txid)
    if (op.stage === 'completed') {
      add('bridgeFrom', Chain.BitcoinCash, op.reverse?.deposit?.txid)
      add('receiveOn', tx.assetTo.chain, op.reverse?.payout?.hash)
    }
    add('refundOn', Chain.BitcoinCash, op.reverse?.refund?.txid)
  } else {
    add('bridgeFrom', tx.assetFrom.chain, tx.hash)
    for (const output of op.received ?? []) add('receiveOn', Chain.BitcoinCash, output.txid)
    if (op.stage === 'completed') add('swapOnCauldron', Chain.BitcoinCash, op.secondLeg?.txid)
    for (const refund of op.refunds ?? []) if (!refund.pending) add('refundOn', tx.assetFrom.chain, refund.txid)
  }
  return transactions
}
