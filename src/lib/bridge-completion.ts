import { Chain } from '@tcswap/core'
import { formatBaseUnits } from '@/lib/bridge'
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

export interface BridgeOutcome {
  // 'bch': native BCH; 'source': the operation's own source asset, refunded to where it came from.
  asset: 'bch' | 'source'
  // Decimal amount (BCH and THORChain refunds both count in 1e8 units).
  amount: string
}

const sats = (values: (string | undefined)[]) => values.reduce((sum, value) => sum + (value && /^\d+$/.test(value) ? BigInt(value) : 0n), 0n)
const outcomeOf = (asset: BridgeOutcome['asset'], total: bigint): BridgeOutcome | undefined =>
  total > 0n ? { asset, amount: formatBaseUnits(total, 8) } : undefined

// What a finished operation actually left the user holding when it is not the planned payout: the
// BCH kept after step 1, or a refund. Undefined while it runs, or when the planned asset arrived.
export const bridgeOutcome = (tx: SwapTransaction & { bridge: BridgeOperation }): BridgeOutcome | undefined => {
  const op = tx.bridge
  if (op.direction === 'reverse') {
    if (op.stage === 'kept_bch') return outcomeOf('bch', sats((op.reverse?.sale?.outputs ?? []).map(output => output.value)))
    if (op.stage === 'refunded') return outcomeOf('bch', sats([op.reverse?.refund?.amountSats]))
    return undefined
  }
  if (op.stage === 'kept_bch') return outcomeOf('bch', sats((op.received ?? []).map(output => output.value)))
  if (op.stage === 'refunded') {
    const source = tx.assetFrom.identifier.toUpperCase()
    return outcomeOf(
      'source',
      sats((op.refunds ?? []).filter(refund => !refund.pending && refund.asset.toUpperCase() === source).map(refund => refund.amount))
    )
  }
  return undefined
}
