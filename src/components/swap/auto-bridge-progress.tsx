'use client'

import { useEffect, useRef, useState } from 'react'
import { Chain, getExplorerTxUrl } from '@tcswap/core'
import { useTranslations } from 'next-intl'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { GenericButton } from '@/components/generic-button'
import { Input } from '@/components/ui/input'
import { useDialog } from '@/components/global-dialog'
import { BridgeCompletion } from '@/components/swap/bridge-completion'
import { BchMark, PusdMark } from '@/components/swap/bridge-marks'
import { WalletAddressBadge } from '@/components/swap/bridge-wallet-badge'
import { useAutomaticHydrated } from '@/hooks/use-automatic-bridge'
import { BridgeConfig } from '@/config'
import { isTerminal } from '@/lib/auto-bridge-contract'
import { automaticCompletion, automaticTransactions } from '@/lib/auto-bridge-summary'
import { formatBaseUnits } from '@/lib/bridge'
import { orderRequest, restoreAutomaticOrder } from '@/lib/auto-bridge-client'
import { sourceTransactionId } from '@/lib/source-transaction'
import { autoBridgeStore, type SavedAutoOrder } from '@/store/auto-bridge-store'

export const AutomaticHistoryRow = ({ reference }: { reference: SavedAutoOrder }) => {
  const t = useTranslations('automatic')
  const { openDialog } = useDialog()
  const order = reference.order
  const receipt = order && automaticCompletion(order)
  const draft = !reference.sourceAttempted && !order?.sourceHash && order?.state === 'awaiting_deposit'
  return <button type="button" className="bridge-auto-history" onClick={() => openDialog(AutomaticOrderDialog, { id: reference.id })}>
    <span><strong>{t('automatic')} · PUSD</strong><small>{t(draft ? 'draft' : order ? `states.${order.state}` : 'restoring')}</small></span>
    <span>{receipt ? `${receipt.amount} ${receipt.ticker}` : t('viewTransfer')}<ExternalLink size={14} aria-hidden="true" /></span>
  </button>
}

// Mounted for both modes: turning automatic off must not stop existing-order recovery.
export const AutomaticOrders = () => {
  const t = useTranslations('automatic')
  const references = autoBridgeStore(state => state.orders)
  const hydrated = useAutomaticHydrated()
  const [offline, setOffline] = useState(false)
  const checkedTerminal = useRef(new Set<string>())
  const nextPoll = useRef(new Map<string, { at: number; attempted: boolean; failed: boolean }>())
  const ids = references.map(ref => ref.id).join(',')
  useEffect(() => {
    let stopped = false, busy = false
    const poll = async () => {
      if (busy) return
      busy = true
      let failed = false
      try {
        for (const reference of autoBridgeStore.getState().orders) {
          if (stopped) break
          const terminal = reference.order && isTerminal(reference.order.state)
          if (terminal && checkedTerminal.current.has(reference.id)) continue
          const deferred = nextPoll.current.get(reference.id)
          if (deferred && deferred.at > Date.now() && deferred.attempted === !!reference.sourceAttempted) {
            failed ||= deferred.failed
            continue
          }
          try {
            await restoreAutomaticOrder(reference)
            if (terminal) checkedTerminal.current.add(reference.id)
            nextPoll.current.set(reference.id, { at: Date.now() + (reference.sourceAttempted ? 5000 : 60000), attempted: !!reference.sourceAttempted, failed: false })
          } catch {
            failed = true
            nextPoll.current.set(reference.id, { at: Date.now() + 60000, attempted: !!reference.sourceAttempted, failed: true })
          }
        }
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

export const AutomaticOrderDialog = ({ id, isOpen, onOpenChange }: { id: string; isOpen: boolean; onOpenChange: (open: boolean) => void }) => {
  const t = useTranslations('automatic')
  const reference = autoBridgeStore(state => state.orders.find(order => order.id === id))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [hint, setHint] = useState('')
  const refresh = async () => {
    if (!reference || busy) return
    setBusy(true); setError('')
    try { await restoreAutomaticOrder(reference) }
    catch { setError(t('offline')) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const saved = autoBridgeStore.getState().orders.find(ref => ref.id === id)
    if (saved) void restoreAutomaticOrder(saved).catch(() => setError(t('offline')))
  }, [id, t])
  const saveHint = async () => {
    if (!reference || !sourceTransactionId(hint) || busy) return
    setBusy(true); setError('')
    try {
      const order = await orderRequest(reference, 'POST', { sourceHash: hint.trim() })
      autoBridgeStore.getState().patch(id, { order, sourceHash: order.sourceHash })
      setHint('')
    } catch { setError(t('hintFailed')) }
    finally { setBusy(false) }
  }
  const order = reference?.order
  const receipt = order && automaticCompletion(order)
  const steps = order ? [
    { label: t('sourceStage'), done: !!order.receivedAt || order.state === 'source_refunded' },
    { label: t('bchStage'), done: !['awaiting_deposit', 'streaming', 'awaiting_confirmations'].includes(order.state) && !!order.receivedAt },
    { label: t('payoutStage'), done: !!order.settlement?.seen }
  ] : []
  const current = steps.findIndex(step => !step.done)
  return <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="bridge-auto-dialog max-h-[90dvh] overflow-y-auto p-5 md:max-w-[580px]">
      <DialogTitle className="sr-only">{t('transfer')}</DialogTitle>
      <DialogDescription className="sr-only">{t('automaticHint')}</DialogDescription>
      {receipt && order ? <BridgeCompletion received={{ amount: receipt.amount, ticker: receipt.ticker, icon: receipt.refund ? <BchMark /> : <PusdMark /> }}
        transactions={automaticTransactions(order)} liquidityCategory={BridgeConfig.pusd.category} onClose={() => onOpenChange(false)}
        additionalReceived={receipt.change ? [{ amount: receipt.change, ticker: 'BCH' }] : undefined}
        notice={['completed', 'refunded'].includes(order.state) ? t('final') : t('confirmations', { count: order.settlement?.confirmations ?? 0 })} /> : <div className="bridge-flow">
        <div className="bridge-flow-card space-y-4">
          <p className="font-semibold" aria-live="polite">{t(order ? `states.${order.state}` : 'restoring')}</p>
          <div className="bridge-auto-stages">{steps.map((step, i) => <div key={step.label} data-state={step.done ? 'complete' : current === i ? 'active' : 'pending'}>{step.label}</div>)}</div>
          {order && <>
            <p>{t('minimum', { amount: formatBaseUnits(order.minPusd, 2) })}</p>
            <WalletAddressBadge address={order.recipientAddress} chain={Chain.BitcoinCash} label={t('recipient')} />
            <p className="break-all text-sm">{t('fallback', { address: order.refundAddress })}</p>
            {order.receivedAt ? <p className="text-sm">{t('deadlineHint')}</p> : <p className="text-sm">{t('waitingHint')}</p>}
            {order.deadline && <p className="text-sm">{t('deadline', { time: new Date(order.deadline).toLocaleString() })}</p>}
            {order.payoutTxid && <a className="bridge-progress-link" href={getExplorerTxUrl({ chain: Chain.BitcoinCash, txHash: order.payoutTxid })} target="_blank" rel="noopener noreferrer">{t('payoutTransaction')} <ExternalLink size={14} /></a>}
          </>}
          {reference?.sourceAttempted && !order?.sourceHash && <p className="text-sm">{t('attempted')}</p>}
          {!reference?.sourceAttempted && order?.state === 'awaiting_deposit' && <p className="text-sm">{t('draft')}</p>}
          <GenericButton className="bridge-flow-primary is-active w-full" onClick={() => onOpenChange(false)}>{t('close')}</GenericButton>
        </div>
      </div>}
      {order?.sourceRefunds?.map((refund, i) => <p className="bridge-flow-message" key={i}>{t('sourceRefund', { asset: refund.asset, amount: formatBaseUnits(refund.amount, 8) })}</p>)}
      {order?.recoveryRequired && <p role="alert" className="bridge-flow-message">{t('recoveryRequired')}</p>}
      {order?.recoverySats && order.recoverySats !== '0' && <p role="status" className="bridge-flow-message">{t('recoveryFunds', { amount: formatBaseUnits(order.recoverySats, 8) })}</p>}
      {order?.error && <p className="bridge-flow-message">{order.error}</p>}
      {error && <p role="status" className="bridge-flow-message">{error}</p>}
      {reference?.sourceAttempted && !order?.sourceHash && !order?.inboundHash && !receipt && <div className="space-y-2">
        <label className="block text-sm">{t('sourceHint')}<Input value={hint} onChange={event => setHint(event.target.value)} spellCheck={false} autoComplete="off" /></label>
        <GenericButton onClick={saveHint} disabled={busy || !sourceTransactionId(hint)}>{t('saveHint')}</GenericButton>
      </div>}
      <button type="button" onClick={refresh} disabled={busy} className="bridge-progress-link flex items-center gap-2">{busy && <LoaderCircle size={14} className="animate-spin" />}{t('refresh')}</button>
    </DialogContent>
  </Dialog>
}
