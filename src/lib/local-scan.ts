import { binToHex, cashAddressToLockingBytecode, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth'
import { ProviderName } from '@tcswap/helpers'
import type { FeedOrder } from '@/lib/auto-bridge-contract'
import { formatBaseUnits } from '@/lib/bridge'
import { bridgeOutcome } from '@/lib/bridge-completion'
import { PUSD_TOKEN } from '@/lib/cauldron-tokens'
import { nearExplorerUrl } from '@/lib/near-intents'
import { bchTxUrl, chainName, leg, rowFromOrder, sideOf, sourceTxUrl, thorchainTxUrl, type ScanLeg, type ScanRow, type ScanStatus } from '@/lib/scanner'
import type { SavedAutoOrder } from '@/store/auto-bridge-store'
import { operationToken, type Transaction } from '@/store/transaction-store'

// This browser's own transfers, for the scanner's wallet search. Only ones with a transaction on a chain are
// rows: a draft, a deposit address nobody paid or a wallet that never sent is not a transfer.

const bchScript = (address: string) => {
  const text = address.toLowerCase()
  const decoded = cashAddressToLockingBytecode(text.includes(':') ? text : `bitcoincash:${text}`)
  return typeof decoded === 'string' ? undefined : binToHex(decoded.bytecode)
}

// A BCH address in both CashAddr forms, without the prefix, as THORChain's Midgard may hold it; empty for any other chain.
export const bchForms = (address: string) => {
  const script = bchScript(address.trim())
  if (!script) return []
  return [false, true].flatMap(tokenSupport => {
    const encoded = lockingBytecodeToCashAddress({ prefix: 'bitcoincash', bytecode: hexToBin(script), tokenSupport })
    return typeof encoded === 'string' ? [] : [encoded.address.slice('bitcoincash:'.length)]
  })
}

// Two spellings of one wallet: EVM in any case, BCH in any CashAddr form (prefix or not, token-aware or not).
export const sameWallet = (a: string | undefined, b: string | undefined) => {
  const x = a?.trim(), y = b?.trim()
  if (!x || !y) return false
  if (x === y || (/^0x[0-9a-f]{40}$/i.test(x) && x.toLowerCase() === y.toLowerCase())) return true
  const script = bchScript(x)
  return !!script && script === bchScript(y)
}

const STATUS: Partial<Record<Transaction['status'], ScanStatus>> = { completed: 'completed', refunded: 'refunded', failed: 'review', expired: 'review', unknown: 'review' }

const transactionLegs = (tx: Transaction): ScanLeg[] => {
  const legs: ScanLeg[] = []
  const add = (label: string, chain: string, hash?: string, url?: string) => {
    const id = hash?.replace(/-\d+$/, '')
    if (id) legs.push(leg(label, url ?? (chain === 'BCH' ? bchTxUrl(id) : sourceTxUrl(chain, id)), id))
  }
  const from = tx.assetFrom.chain, to = tx.assetTo.chain
  if (tx.kind === 'send') {
    add(`${chainName(from)} send`, from, tx.hash)
    return legs
  }
  const op = tx.bridge
  if (op?.direction === 'reverse') {
    const r = op.reverse
    add('Tokens to contract', 'BCH', r?.router?.sendTxid)
    add('Cauldron sale', 'BCH', r?.sale?.txid)
    add('BCH deposit', 'BCH', r?.deposit?.txid)
    if (r?.deposit?.near) add(`${r.route === 'shapeshift' ? 'ShapeShift' : 'NEAR Intents'} swap`, 'NEAR', r.deposit.near.depositAddress, nearExplorerUrl(r.deposit.near.depositAddress))
    else if (r?.deposit?.txid) add('THORChain swap', 'THOR', r.deposit.txid, thorchainTxUrl(r.deposit.txid))
    add('Payout', to, r?.payout?.hash)
    add('BCH refund', 'BCH', r?.refund?.txid)
  } else if (op) {
    add(`${chainName(from)} deposit`, from, tx.hash)
    if (op.near) add('NEAR Intents swap', 'NEAR', op.near.depositAddress, nearExplorerUrl(op.near.depositAddress))
    else if (tx.hash) add('THORChain swap', 'THOR', tx.hash, thorchainTxUrl(tx.hash))
    for (const output of op.received ?? []) add('BCH received', 'BCH', output.txid)
    if (op.stage === 'completed' || op.stage === 'second_leg_pending') add('Cauldron swap', 'BCH', op.secondLeg?.txid)
    for (const refund of op.refunds ?? []) if (!refund.pending) add('Refund', from, refund.txid)
  } else {
    add(`${chainName(from)} deposit`, from, tx.hash)
    if (tx.provider === ProviderName.THORCHAIN && tx.hash) add('THORChain swap', 'THOR', tx.hash, thorchainTxUrl(tx.hash))
    if (tx.networkSwap?.near) add('NEAR Intents swap', 'NEAR', tx.networkSwap.near.depositAddress, nearExplorerUrl(tx.networkSwap.near.depositAddress))
    add('Payout', to, tx.networkSwap?.payout?.hash)
  }
  // A NEAR Intents deposit address is quoted before anyone pays it: on its own it is not a sent transaction.
  return legs.every(item => item.label === 'NEAR Intents swap' || item.label === 'ShapeShift swap') ? [] : legs
}

export const rowFromTransaction = (tx: Transaction): ScanRow | undefined => {
  const legs = transactionLegs(tx)
  if (!legs.length) return undefined
  const op = tx.kind !== 'send' ? tx.bridge : undefined
  // A bridge that stopped with BCH kept, or was refunded, ends in what the user actually holds.
  const outcome = op && tx.kind !== 'send' ? bridgeOutcome({ ...tx, bridge: op }) : undefined
  const token = op && op.direction !== 'reverse' ? operationToken(op) : undefined
  const to = outcome
    ? outcome.asset === 'bch'
      ? sideOf('BCH', 'BCH', outcome.amount)
      : sideOf(tx.assetFrom.ticker, tx.assetFrom.chain, outcome.amount, tx.assetFrom.logoURI)
    : tx.kind === 'send'
      ? sideOf(tx.assetFrom.ticker, tx.assetFrom.chain, tx.amountFrom, tx.assetFrom.logoURI)
      : token
        ? sideOf(token.ticker, 'BCH', tx.amountTo, token.icon)
        : sideOf(tx.assetTo.ticker, tx.assetTo.chain, tx.amountTo, tx.assetTo.logoURI)
  return {
    key: `local:${tx.uid}`,
    time: new Date(tx.timestamp).getTime(),
    router: false,
    verified: false,
    from: sideOf(tx.assetFrom.ticker, tx.assetFrom.chain, tx.amountFrom, tx.assetFrom.logoURI),
    to,
    status: STATUS[tx.status] ?? 'pending',
    legs
  }
}

export const transactionAddresses = (tx: Transaction) => {
  const op = tx.kind !== 'send' ? tx.bridge : undefined
  return [tx.addressFrom, tx.addressTo, tx.details?.fromAddress, tx.details?.toAddress, op?.binding?.cashAddress, op?.binding?.tokenAddress, op?.reverse?.destination]
}

// The user signed something for this order and a chain has it. Opening the wallet (sourceAttempted) is not enough:
// the prompt may still be open, or closed without signing. Anything less is a draft and is never listed.
export const orderSent = ({ order, sourceHash }: SavedAutoOrder) =>
  !!(sourceHash || order?.sourceHash || order?.inboundHash || order?.bchReceipts?.length || BigInt(order?.receivedSats || '0') > 0n || order?.payoutTxid || order?.settlement)

// A saved Cashbridge Router order in the shape the Router's feed gives it, once a chain has seen it.
export const rowFromSavedOrder = (reference: SavedAutoOrder): ScanRow | undefined => {
  const order = reference.order
  const sourceHash = order?.sourceHash ?? order?.inboundHash ?? reference.sourceHash
  if (!order || !orderSent(reference)) return undefined
  const routed = order.nearDepositAddress ?? (order.sale?.route ? order.sale.vaultAddress : undefined)
  const feed: FeedOrder = {
    ref: reference.id,
    kind: order.sale ? 'sale' : 'forward',
    state: order.state,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    contract: !!order.contract,
    ...(routed && { near: true, nearDeposit: routed }),
    ...((order.shapeshiftQuoteId || order.sale?.route === 'shapeshift') && { shapeshift: true }),
    category: order.sale?.category ?? order.category ?? PUSD_TOKEN.category,
    expectedBchSats: order.expectedBchSats,
    ...(order.source && { source: { chain: order.source.chain, asset: order.source.asset, amount: order.source.amount } }),
    ...(order.sale && { sale: { tokenAmount: order.sale.tokenAmount, buyAsset: order.sale.buyAsset } }),
    ...(sourceHash && { sourceHash }),
    bchReceipts: (order.bchReceipts ?? []).map(({ txid, amountSats }) => ({ txid, amountSats })),
    ...(order.settlement && {
      settlement: { kind: order.settlement.kind, txid: order.settlement.txid, tokenAmount: order.settlement.pusdAmount, bchAmount: order.settlement.bchAmount }
    })
  }
  const row = rowFromOrder(feed)
  // The token's own mark and decimals, when it is not one the scanner pins.
  const token = reference.token
  if (token && feed.kind === 'forward' && order.settlement?.kind !== 'refund' && row.to.ticker !== token.ticker)
    row.to = sideOf(token.ticker, 'BCH', order.settlement && formatBaseUnits(order.settlement.pusdAmount, token.decimals), token.icon)
  return { ...row, key: `local:${reference.id}` }
}

export const orderAddresses = (reference: SavedAutoOrder) => {
  const intent = reference.order ?? reference.intent
  return [intent?.recipientAddress, intent?.refundAddress, intent?.source?.address, intent?.sale?.destination]
}

// This browser's transfers tied to `address`, as scanner rows.
export const localRows = (address: string, transactions: Transaction[], orders: SavedAutoOrder[]): ScanRow[] => [
  ...orders.filter(ref => orderAddresses(ref).some(a => sameWallet(a, address))).flatMap(ref => rowFromSavedOrder(ref) ?? []),
  ...transactions.filter(tx => transactionAddresses(tx).some(a => sameWallet(a, address))).flatMap(tx => rowFromTransaction(tx) ?? [])
]

// The wallets this browser has transfers from, with the chain each is on, newest first: one tap searches each.
export const localWallets = (transactions: Transaction[], orders: SavedAutoOrder[]) => {
  const wallets: { address: string; chain: string; time: number }[] = []
  for (const ref of orders) {
    const row = rowFromSavedOrder(ref)
    const intent = ref.order ?? ref.intent
    if (!row || !intent) continue
    wallets.push({ address: intent.recipientAddress, chain: 'BCH', time: row.time ?? 0 })
    if (intent.source?.address) wallets.push({ address: intent.source.address, chain: intent.source.chain, time: row.time ?? 0 })
  }
  for (const tx of transactions) {
    const row = rowFromTransaction(tx)
    if (!row) continue
    const op = tx.kind !== 'send' ? tx.bridge : undefined
    if (op?.binding?.cashAddress) wallets.push({ address: op.binding.cashAddress, chain: 'BCH', time: row.time ?? 0 })
    if (tx.addressFrom) wallets.push({ address: tx.addressFrom, chain: tx.assetFrom.chain, time: row.time ?? 0 })
    if (op?.reverse?.destination) wallets.push({ address: op.reverse.destination, chain: tx.assetTo.chain, time: row.time ?? 0 })
  }
  return wallets
    .sort((a, b) => b.time - a.time)
    .filter((wallet, i, all) => all.findIndex(other => sameWallet(other.address, wallet.address)) === i)
    .map(({ address, chain }) => ({ address, chain: chain.toUpperCase() }))
}
