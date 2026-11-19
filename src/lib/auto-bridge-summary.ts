import { Chain } from '@tcswap/core'
import type { PublicOrder } from '@/lib/auto-bridge-contract'
import type { CompletionTransaction } from '@/lib/bridge-completion'
import { formatBaseUnits } from '@/lib/bridge'
import { isTxid } from '@/lib/bch'
import { PUSD_TOKEN, type CauldronToken } from '@/lib/cauldron-tokens'

export const automaticCompletion = (order: PublicOrder, token: Pick<CauldronToken, 'ticker' | 'decimals'> = PUSD_TOKEN) => {
  const settlement = order.settlement
  if (!settlement?.seen) return undefined
  const refund = settlement.kind === 'refund'
  const amount = refund ? settlement.bchAmount : settlement.pusdAmount
  if (!/^[1-9]\d*$/.test(amount)) return undefined
  return {
    amount: formatBaseUnits(amount, refund ? 8 : token.decimals), ticker: refund ? 'BCH' : token.ticker, refund,
    change: !refund && /^[1-9]\d*$/.test(settlement.bchAmount) ? formatBaseUnits(settlement.bchAmount, 8) : undefined
  }
}
export const automaticTransactions = (order: PublicOrder): CompletionTransaction[] => {
  const result: CompletionTransaction[] = []
  if (order.sourceHash && order.source && Object.values(Chain).includes(order.source.chain as Chain))
    result.push({ key: 'source', kind: 'bridgeFrom', chain: order.source.chain as Chain, hash: order.sourceHash.replace(/-\d+$/, '') })
  for (const receipt of order.bchReceipts ?? []) if (isTxid(receipt.txid))
    result.push({ key: `bch-${receipt.txid}`, kind: 'receiveOn', chain: Chain.BitcoinCash, hash: receipt.txid })
  if (order.settlement?.seen && isTxid(order.settlement.txid))
    result.push({ key: 'payout', kind: order.settlement.kind === 'refund' ? 'refundOn' : 'swapOnCauldron', chain: Chain.BitcoinCash, hash: order.settlement.txid })
  return result
}
