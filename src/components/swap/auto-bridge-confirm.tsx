'use client'

import { useEffect, useRef, useState } from 'react'
import { Chain, FeeOption, USwapNumber } from '@tcswap/core'
import type { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { useTranslations } from 'next-intl'
import { LoaderCircle } from 'lucide-react'
import { Credenza, CredenzaContent, CredenzaDescription, CredenzaHeader, CredenzaTitle } from '@/components/ui/credenza'
import { Input } from '@/components/ui/input'
import { GenericButton } from '@/components/generic-button'
import { BridgeConfirm } from '@/components/swap/swap-confirm'
import { SwapError } from '@/components/swap/swap-error'
import { PUSD_TOKEN } from '@/lib/cauldron-tokens'
import { useAutomaticBridge } from '@/hooks/use-automatic-bridge'
import { useAssetFrom, useSlippage, useSwap } from '@/hooks/use-swap'
import { useConnectedAccount } from '@/hooks/use-wallets'
import { useQuote } from '@/hooks/use-quote'
import { useSwapRates } from '@/hooks/use-rates'
import { AppConfig, BridgeConfig } from '@/config'
import { addressToLockingBytecode } from '@/lib/bch'
import { toBaseUnits } from '@/lib/bridge'
import { getQuotes, isBridgeRoute } from '@/lib/api'
import { assertAutomaticSaved, orderRequest, startAutomaticSource } from '@/lib/auto-bridge-client'
import { getUSwap } from '@/lib/wallets'
import { resolvePriceImpact } from '@/lib/swap-helpers'
import { autoBridgeStore, type SavedAutoOrder } from '@/store/auto-bridge-store'
import type { OrderIntent } from '@/lib/auto-bridge-contract'

interface Props { provider: ProviderName; isOpen: boolean; onOpenChange: (open: boolean) => void }
export const AutoBridgeDialog = ({ provider, isOpen, onOpenChange }: Props) => {
  const t = useTranslations('automatic')
  const from = useAssetFrom(), account = useConnectedAccount(from?.chain)
  const { valueFrom, setAmountFrom } = useSwap(), { quote: indicative } = useQuote()
  const { automatic, recipient } = useAutomaticBridge()
  const slippage = useSlippage(), { rateFrom, rateTo } = useSwapRates()
  const [refund, setRefund] = useState(''), [reference, setReference] = useState<SavedAutoOrder>()
  const [prepared, setPrepared] = useState<{ route: QuoteResponseRoute; key: string }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error>()
  const [acceptedImpact, setAcceptedImpact] = useState(false), [acceptedLtc, setAcceptedLtc] = useState(false)
  const captured = from && account ? {
    recipientAddress: recipient, refundAddress: refund.trim() || recipient,
    source: { chain: from.chain, asset: from.identifier, amount: valueFrom.toSignificant(), address: account.address }
  } : undefined
  const key = automatic && captured ? JSON.stringify(captured) : ''
  const current = useRef(key), mounted = useRef(true)
  current.current = key
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const fresh = !!prepared && prepared.key === key && !!key
  const attempted = autoBridgeStore(state => !!reference && !!state.orders.find(order => order.id === reference.id)?.sourceAttempted)
  const impact = resolvePriceImpact(prepared?.route, rateFrom, rateTo)
  const blocked = (!!impact && impact.gt(2) && !acceptedImpact) || (from?.ticker === 'LTC' && !acceptedLtc)

  const prepare = async () => {
    if (!captured || !indicative || busy || !key || attempted) return
    setBusy(true); setError(undefined); setPrepared(undefined)
    try {
      if (!addressToLockingBytecode(captured.recipientAddress) || !addressToLockingBytecode(captured.refundAddress)) throw new Error(t('invalidAddress'))
      const intent: OrderIntent = { ...captured, expectedBchSats: toBaseUnits(indicative.expectedBuyAmount, 8).toString() }
      const ref = reference?.intent && JSON.stringify(reference.intent.source) === JSON.stringify(intent.source) &&
        reference.intent.recipientAddress === intent.recipientAddress && reference.intent.refundAddress === intent.refundAddress
        ? reference : { id: crypto.randomUUID(), capability: (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', ''), createdAt: Date.now(), intent }
      autoBridgeStore.getState().save(ref)
      assertAutomaticSaved(ref)
      setReference(ref)
      const order = ref.order ?? await orderRequest(ref, 'POST', { id: ref.id, ...ref.intent })
      if (order.apiVersion !== 2 || order.recoveryRequired) throw new Error(t('serviceUpdate'))
      autoBridgeStore.getState().patch(ref.id, { order })
      const saved = { ...ref, order }
      setReference(saved)
      const quotes = await getQuotes({ buyAsset: BridgeConfig.buyAsset, sellAsset: captured.source.asset, sellAmount: captured.source.amount,
        sourceAddress: captured.source.address, destinationAddress: order.depositAddress, refundAddress: captured.source.address,
        dry: false, slippage: slippage ?? 99, providers: AppConfig.providers })
      const route = quotes.find(q => q.providers[0] === provider) ?? quotes[0]
      if (!route || !isBridgeRoute(route, { sellAsset: captured.source.asset, destinationAddress: order.depositAddress }) || !new USwapNumber(route.sellAmount).eqValue(captured.source.amount))
        throw new Error(t('noRoute'))
      if (!mounted.current || current.current !== key) return
      setPrepared({ route, key }); setAcceptedImpact(false); setAcceptedLtc(false)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure : new Error(t('unavailable'))) }
    finally { if (mounted.current) setBusy(false) }
  }
  const send = async () => {
    if (!fresh || !prepared || !reference?.order || !reference.intent?.source || busy || attempted || blocked) return
    setBusy(true); setError(undefined)
    try {
      const latest = await orderRequest(reference, 'GET')
      if (latest.apiVersion !== 2 || latest.recoveryRequired) throw new Error(t('serviceUpdate'))
      if (latest.minPusd !== reference.order.minPusd || latest.depositAddress !== reference.order.depositAddress) throw new Error(t('changed'))
      autoBridgeStore.getState().patch(reference.id, { order: latest })
      const route = from?.chain === Chain.Tron && prepared.route.expiration ? { ...prepared.route, expiration: undefined } : prepared.route
      await startAutomaticSource(reference, prepared.route, reference.intent.source.asset, () => {
        if (!mounted.current || current.current !== prepared.key) throw new Error(t('changed'))
        return getUSwap().swap({ route, feeOptionKey: FeeOption.Fast }) as Promise<string>
      }, hash => orderRequest(reference, 'POST', { sourceHash: hash }), () => mounted.current && current.current === prepared.key)
      setAmountFrom(''); onOpenChange(false)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure : new Error(t('unavailable'))) }
    finally { if (mounted.current) setBusy(false) }
  }

  return <Credenza open={isOpen} onOpenChange={onOpenChange}>
    <CredenzaContent className="flex max-h-[90dvh] flex-col md:max-w-xl">
      {fresh && reference?.order && prepared ? <BridgeConfirm quote={prepared.route} token={PUSD_TOKEN} bchAddress={reference.order.recipientAddress}
        automatic={{ minPusd: reference.order.minPusd, refundAddress: reference.order.refundAddress }} /> : <>
        <CredenzaHeader><CredenzaTitle>{t('reviewTitle')}</CredenzaTitle><CredenzaDescription>{t('automaticHint')}</CredenzaDescription></CredenzaHeader>
        <div className="space-y-4 px-6 pb-3">
          <p className="break-all text-sm">{t('recipient')}: {recipient || t('enterRecipient')}</p>
          <label className="block space-y-2 text-sm"><span>{t('fallbackLabel')}</span>
            <Input value={refund} onChange={event => setRefund(event.target.value)} placeholder={recipient} spellCheck={false} autoComplete="off" disabled={busy || attempted} />
          </label>
          <p className="text-sm">{t('custody')}</p>
        </div>
      </>}
      <div className="space-y-3 px-6 pb-6">
        {fresh && !!impact && impact.gt(2) && <label className="flex gap-2 text-sm"><input type="checkbox" checked={acceptedImpact} onChange={event => setAcceptedImpact(event.target.checked)} />{t('highImpact')}</label>}
        {fresh && from?.ticker === 'LTC' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={acceptedLtc} onChange={event => setAcceptedLtc(event.target.checked)} />{t('ltcWarning')}</label>}
        {error && <SwapError error={error} />}
        {attempted && <p role="status" className="text-sm">{t('attempted')}</p>}
        <GenericButton className="bridge-flow-primary is-active w-full" disabled={busy || attempted || (fresh && blocked) || !key}
          onClick={fresh ? send : prepare}>{busy && <LoaderCircle size={18} className="animate-spin" />}{t(fresh ? 'confirm' : 'review')}</GenericButton>
      </div>
    </CredenzaContent>
  </Credenza>
}
