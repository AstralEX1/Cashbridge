'use client'

import { useEffect, useRef, useState } from 'react'
import { Chain } from '@tcswap/core'
import { useTranslations } from 'next-intl'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { GenericButton } from '@/components/generic-button'
import { Input } from '@/components/ui/input'
import { AssetIcon } from '@/components/asset-icon'
import { useDialog } from '@/components/global-dialog'
import { TransactionHistoryDialog } from '@/components/header/transaction-history-dialog'
import { BchMark, TokenMark } from '@/components/swap/bridge-marks'
import { SwapError } from '@/components/swap/swap-error'
import {
  BridgeFlow,
  chainTxUrl,
  type FlowBar,
  type FlowStage,
  type FlowToast,
  type FlowToken,
  thorchainTxUrl,
  timeOf,
  usdText,
  useCollapseOnce,
  useTokenQuoteFor,
  WaitingButton
} from '@/components/swap/pusd-swap'
import { useAutomaticHydrated } from '@/hooks/use-automatic-bridge'
import { useAssets } from '@/hooks/use-assets'
import { useRates } from '@/hooks/use-rates'
import { formatAmount, formatMinutes, PUSD_LEG_SECONDS } from '@/lib/bridge-summary'
import { formatStepTime, stepTime } from '@/lib/bridge-tracking'
import { PUSD_TOKEN } from '@/lib/cauldron-tokens'
import { BridgeConfig } from '@/config'
import { isTerminal } from '@/lib/auto-bridge-contract'
import { automaticCompletion, automaticTransactions } from '@/lib/auto-bridge-summary'
import { formatBaseUnits } from '@/lib/bridge'
import { orderRequest, pollAutomaticOrders, restoreAutomaticOrder, type OrderPollSchedule } from '@/lib/auto-bridge-client'
import { sourceTransactionId } from '@/lib/source-transaction'
import { autoBridgeStore, type SavedAutoOrder } from '@/store/auto-bridge-store'

export const AutomaticHistoryRow = ({ reference }: { reference: SavedAutoOrder }) => {
  const t = useTranslations('automatic')
  const { openDialog } = useDialog()
  const order = reference.order
  const token = reference.token ?? PUSD_TOKEN
  const receipt = order && automaticCompletion(order, token)
  const draft = !reference.sourceAttempted && !order?.sourceHash && order?.state === 'awaiting_deposit'
  return <button type="button" className="bridge-auto-history" onClick={() => openDialog(AutomaticOrderDialog, { id: reference.id })}>
    <span><strong>{t('automatic')} · {token.ticker}</strong><small>{t(draft ? 'draft' : order ? `states.${order.state}` : 'restoring')}</small></span>
    <span>{receipt ? `${receipt.amount} ${receipt.ticker}` : t('viewTransfer')}<ExternalLink size={14} aria-hidden="true" /></span>
  </button>
}

// Mounted for both modes: turning automatic off must not stop existing-order recovery.
export const AutomaticOrders = () => {
  const t = useTranslations('automatic')
  const references = autoBridgeStore(state => state.orders)
  const hydrated = useAutomaticHydrated()
  const [offline, setOffline] = useState(false)
  const nextPoll = useRef<OrderPollSchedule>(new Map())
  const ids = references.map(ref => ref.id).join(',')
  useEffect(() => {
    let stopped = false, busy = false
    const poll = async () => {
      if (busy) return
      busy = true
      let failed = false
      try {
        failed = await pollAutomaticOrders(nextPoll.current, () => stopped)
      } finally { busy = false; if (!stopped) setOffline(failed) }
    }
    void poll()
    const timer = setInterval(poll, 5000)
    const rehydrate = () => { void autoBridgeStore.persist?.rehydrate() }
    window.addEventListener('storage', rehydrate)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('storage', rehydrate) }
  }, [ids])
  if (!hydrated) return null
  const active = references.filter(ref => !ref.order || !isTerminal(ref.order.state)).slice(-3)
  if (!active.length && !offline) return null
  return <section className="bridge-auto-orders" aria-label={t('transfers')}>
    {offline && <p role="status" className="bridge-flow-message">{t('offline')}</p>}
    {active.map(reference => <AutomaticHistoryRow key={reference.id} reference={reference} />)}
  </section>
}

const BCH_STAGES = ['awaiting_deposit', 'streaming']

// The automatic transfer's progress, laid out like the manual PUSD bridge: Bridge (1/2), then the
// service's swap (2/2), the same toasts and the same receipt. Nothing here asks for a signature.
export const AutomaticOrderDialog = ({ id, isOpen, onOpenChange }: { id: string; isOpen: boolean; onOpenChange: (open: boolean) => void }) => {
  const t = useTranslations('automatic')
  const tb = useTranslations('bridge')
  const { openDialog } = useDialog()
  const reference = autoBridgeStore(state => state.orders.find(order => order.id === id))
  const token = reference?.token ?? PUSD_TOKEN
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [hint, setHint] = useState('')
  const [dismissed, setDismissed] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const saved = autoBridgeStore.getState().orders.find(ref => ref.id === id)
    if (saved) void restoreAutomaticOrder(saved).catch(() => setError(t('offline')))
  }, [id, t])
  const order = reference?.order
  const source = order?.source ?? reference?.intent?.source
  const { assets } = useAssets()
  const asset = source && assets?.find(item => item.identifier.toLowerCase() === source.asset.toLowerCase())
  const { rates } = useRates(source ? [source.asset, 'BCH.BCH'].sort() : [])
  const receivedSats = order && /^[1-9]\d*$/.test(order.receivedSats) ? BigInt(order.receivedSats) : 0n
  const expectedSats = reference?.intent?.expectedBchSats ?? order?.expectedBchSats
  const bchSats = receivedSats > 0n ? receivedSats : expectedSats && /^\d+$/.test(expectedSats) ? BigInt(expectedSats) : undefined
  const receipt = order && automaticCompletion(order, token)
  const estimate = useTokenQuoteFor(bchSats !== undefined && !receipt ? formatBaseUnits(bchSats, 8) : undefined, token)
  const firstDone = !!order && (!!order.receivedAt || !!order.bchReceipts?.length) && !BCH_STAGES.includes(order.state)
  const terminal = !!order && isTerminal(order.state)
  const animateCollapse = useCollapseOnce(id, firstDone && !!order && order.state !== 'source_refunded')

  const saveHint = async () => {
    if (!reference || !sourceTransactionId(hint) || busy) return
    setBusy(true); setError('')
    try {
      const updated = await orderRequest(reference, 'POST', { sourceHash: hint.trim() })
      autoBridgeStore.getState().patch(id, { order: updated, sourceHash: updated.sourceHash })
      setHint('')
    } catch { setError(t('hintFailed')) }
    finally { setBusy(false) }
  }

  const draft = !!order && !reference?.sourceAttempted && !order.sourceHash && order.state === 'awaiting_deposit'
  const stage: FlowStage = receipt ? 'done' : terminal ? 'ended' : firstDone ? 'swapping' : 'bridging'
  const sourceHash = order?.sourceHash ?? reference?.sourceHash
  const start = order?.createdAt ?? reference?.createdAt ?? now
  const eta = (time: ReturnType<typeof stepTime>) => {
    const label = formatStepTime(time)
    return label.key === 'minutes'
      ? tb('progress.minutes', { minutes: label.value })
      : label.key === 'seconds'
        ? tb('progress.seconds', { seconds: label.value })
        : tb('progress.elapsedTime', { time: label.value })
  }
  const bridgeHref = sourceHash ? thorchainTxUrl(sourceHash) : undefined
  const payoutHref = order?.settlement?.seen ? chainTxUrl(Chain.BitcoinCash, order.settlement.txid) : undefined
  const firstBar: FlowBar = firstDone
    ? { fill: 1, done: true, href: bridgeHref }
    : draft
      ? { fill: 0 }
      : {
          fill: reference?.estimatedSeconds ? Math.min(0.95, Math.max(0.05, (now - start) / (reference.estimatedSeconds * 1000))) : 0.5,
          eta: eta(stepTime(now, start, reference?.estimatedSeconds)),
          live: !terminal,
          href: bridgeHref
        }
  const secondStart = order?.receivedAt ?? now
  const secondBar: FlowBar = receipt
    ? { fill: 1, done: true, href: payoutHref }
    : firstDone && !terminal
      ? { fill: 0.6, live: true, eta: eta(stepTime(now, secondStart, PUSD_LEG_SECONDS)) }
      : { fill: 0, eta: tb('progress.minutes', { minutes: formatMinutes(PUSD_LEG_SECONDS) }) }

  const rateOf = (key: string) => (rates[key] ? Number(rates[key].toSignificant(12)) : undefined)
  const sentUsd = source ? rateOf(source.asset) : undefined
  const bchUsd = rateOf('BCH.BCH')
  const bchAmount = bchSats === undefined ? undefined : Number(bchSats) / 1e8
  const leg = estimate.quote
  const pusdUnits = order?.settlement?.seen && order.settlement.kind === 'swap' ? BigInt(order.settlement.pusdAmount || '0') : leg?.output
  const pusdAmount = pusdUnits === undefined ? undefined : Number(pusdUnits) / 10 ** token.decimals
  const ticker = asset?.ticker ?? source?.asset.split('.')[1]?.split('-')[0] ?? ''
  const sent: FlowToken = {
    amount: source?.amount ?? '—',
    ticker,
    usd: usdText(source && sentUsd !== undefined ? Number(source.amount) * sentUsd : undefined),
    icon: <span className="bridge-flow-icon">{asset ? <AssetIcon asset={asset} showNetworkIcons={false} /> : null}</span>
  }
  const bch: FlowToken = {
    amount: bchAmount === undefined ? '—' : `${receivedSats > 0n ? '' : '≈ '}${formatAmount(bchAmount, receivedSats > 0n ? 8 : 4)}`,
    ticker: 'BCH',
    usd: usdText(bchAmount !== undefined && bchUsd ? bchAmount * bchUsd : undefined),
    icon: <BchMark size={30} />
  }
  const pusdUsd = leg && bchUsd && leg.spotOutput > 0 ? ((Number(leg.sell) / 1e8) * bchUsd) / (leg.spotOutput / 10 ** token.decimals) : undefined
  const final: FlowToken = {
    amount: pusdAmount === undefined ? '—' : `${receipt ? '' : '≈ '}${formatAmount(pusdAmount, 4)}`,
    ticker: token.ticker,
    usd: usdText(pusdAmount !== undefined && pusdUsd ? pusdAmount * pusdUsd : undefined),
    icon: <TokenMark token={token} size={30} />
  }

  const receiptTxids = [...new Set((order?.bchReceipts ?? []).map(item => item.txid))]
  const toasts: FlowToast[] = [
    ...(sourceHash && source && Object.values(Chain).includes(source.chain as Chain)
      ? [{ id: `send:${sourceHash}`, title: tb(firstDone ? 'progress.toastSendConfirmed' : 'progress.toastSent'), hash: sourceHash.replace(/-\d+$/, ''), chain: source.chain as Chain, time: timeOf(start), icon: sent.icon, pending: !firstDone }]
      : []),
    ...receiptTxids.map(hash => ({ id: `receive:${hash}`, title: tb('progress.toastReceived'), hash, chain: Chain.BitcoinCash, icon: bch.icon })),
    ...(order?.settlement?.seen
      ? [{
          id: `payout:${order.settlement.txid}`,
          title: order.settlement.kind === 'refund'
            ? t('toastRefund', { confirmations: order.settlement.confirmations })
            : tb('progress.toastPusdReceived', { ticker: token.ticker, confirmations: order.settlement.confirmations }),
          hash: order.settlement.txid,
          chain: Chain.BitcoinCash,
          icon: order.settlement.kind === 'refund' ? bch.icon : final.icon
        }]
      : [])
  ].filter(item => !dismissed.includes(item.id)).reverse()

  const close = () => onOpenChange(false)
  const hashMissing = !!reference?.sourceAttempted && !order?.sourceHash && !order?.inboundHash && !receipt
  // The service does the rest once the source hash is known; nothing more is asked of the user.
  const handsOff = !!order && !terminal && !draft && !hashMissing && !order.recoveryRequired
  const waiting = order && ['retrying', 'broadcasting', 'awaiting_confirmations'].includes(order.state)
  const details = <>
    {!order && <p role="status" className="bridge-flow-message">{t('restoring')}</p>}
    {draft && <p className="bridge-flow-message">{t('draft')}</p>}
    {waiting && <p role="status" className="bridge-flow-message">{t(`states.${order.state}`)}</p>}
    {stage === 'ended' && <p className="bridge-flow-message">{t(`states.${order!.state}`)}</p>}
    {order?.sourceRefunds?.map((refund, i) => <p className="bridge-flow-message" key={i}>{t('sourceRefund', { asset: refund.asset, amount: formatBaseUnits(refund.amount, 8) })}</p>)}
    {order?.recoveryRequired && <p role="alert" className="bridge-flow-message">{t('recoveryRequired')}</p>}
    {order?.recoverySats && order.recoverySats !== '0' && <p role="status" className="bridge-flow-message">{t('recoveryFunds', { amount: formatBaseUnits(order.recoverySats, 8) })}</p>}
    {order?.error && <SwapError error={new Error(order.error)} />}
    {error && <p role="status" className="bridge-flow-message">{error}</p>}
    {hashMissing && <div className="bridge-auto-recipient">
      <label>{t('sourceHint')}<Input value={hint} onChange={event => setHint(event.target.value)} spellCheck={false} autoComplete="off" /></label>
      <GenericButton onClick={saveHint} disabled={busy || !sourceTransactionId(hint)}>{busy && <LoaderCircle size={14} className="animate-spin" />}{t('saveHint')}</GenericButton>
    </div>}
  </>
  const actions = terminal || draft
    ? <GenericButton className="bridge-flow-primary is-active w-full" onClick={close}>{tb('progress.done')}</GenericButton>
    : firstDone
      ? <WaitingButton>{tb('progress.swapping')}</WaitingButton>
      : <WaitingButton>{tb('progress.swapAction', { ticker: token.ticker })}</WaitingButton>
  const title = receipt ? tb('progress.completeTitle') : firstDone ? tb('progress.swapping') : tb('progress.processing')

  return <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="bridge-flow-layer" showCloseButton={false}>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{t('automaticHint')}</DialogDescription>
      <BridgeFlow
        stage={stage}
        title={title}
        sourceChain={(source?.chain as Chain) ?? Chain.Ethereum}
        sourceAddress={source?.address}
        bchAddress={order?.recipientAddress ?? reference?.intent?.recipientAddress ?? ''}
        sent={sent}
        bch={bch}
        final={final}
        firstBar={firstBar}
        secondBar={secondBar}
        details={details}
        actions={actions}
        completion={receipt && order ? {
          received: { amount: receipt.amount, ticker: receipt.ticker, icon: receipt.refund ? <BchMark size={48} /> : <TokenMark token={token} size={48} /> },
          transactions: automaticTransactions(order),
          liquidityCategory: BridgeConfig.pusd.category,
          additionalReceived: receipt.change ? [{ amount: receipt.change, ticker: 'BCH', icon: <BchMark size={14} /> }] : undefined,
          notice: ['completed', 'refunded'].includes(order.state) ? t('final') : t('confirmations', { count: order.settlement?.confirmations ?? 0 })
        } : undefined}
        toasts={toasts}
        onDismissToast={toastId => setDismissed(list => [...list, toastId])}
        onHistory={() => openDialog(TransactionHistoryDialog, {})}
        onClose={close}
        onBridgeAnother={handsOff ? close : undefined}
        animateCollapse={animateCollapse}
      />
    </DialogContent>
  </Dialog>
}
