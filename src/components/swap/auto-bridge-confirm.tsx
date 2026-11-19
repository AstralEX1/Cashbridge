'use client'

import { useEffect, useRef, useState } from 'react'
import { Chain, FeeOption, USwapNumber } from '@tcswap/core'
import type { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { useTranslations } from 'next-intl'
import { LoaderCircle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Credenza, CredenzaContent } from '@/components/ui/credenza'
import { GenericButton } from '@/components/generic-button'
import { BridgeConfirm } from '@/components/swap/swap-confirm'
import { SwapError } from '@/components/swap/swap-error'
import { RouterUnavailable } from '@/components/swap/router-unavailable'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { useDialog } from '@/components/global-dialog'
import { AutomaticOrderDialog } from '@/components/swap/auto-bridge-progress'
import { chainLabel } from '@/components/connect-wallet/config'
import { PUSD_TOKEN } from '@/lib/cauldron-tokens'
import { useAssetFrom, useSwap } from '@/hooks/use-swap'
import { useSwapRates } from '@/hooks/use-rates'
import { AppConfig, BridgeConfig } from '@/config'
import { bchAddressProblem } from '@/lib/bch'
import { toBaseUnits } from '@/lib/bridge'
import { firstLegSeconds } from '@/lib/bridge-summary'
import { getQuotes, isBridgeRoute } from '@/lib/api'
import { assertAutomaticSaved, createAutomaticOrder, orderRequest, RouterUnavailableError, startAutomaticSource } from '@/lib/auto-bridge-client'
import { getUSwap } from '@/lib/wallets'
import { resolvePriceImpact } from '@/lib/swap-helpers'
import { autoBridgeStore, type SavedAutoOrder } from '@/store/auto-bridge-store'
import type { AutomaticSource, OrderIntent } from '@/lib/auto-bridge-contract'

export interface PreparedAutomatic {
  reference: SavedAutoOrder
  route: QuoteResponseRoute
}

const sameIntent = (a: OrderIntent | undefined, b: OrderIntent) =>
  !!a && JSON.stringify(a.source) === JSON.stringify(b.source) && a.recipientAddress === b.recipientAddress && a.refundAddress === b.refundAddress

// Runs behind the main button's "Preparing swap": saves the order reference (before any request, so a
// lost answer is recoverable), creates the order and takes an executable quote to its deposit
// address. An unpaid order for the same transfer is reused rather than created again. The BCH
// fallback is the recipient itself.
export const prepareAutomatic = async ({
  source,
  recipient,
  expectedBuyAmount,
  provider,
  slippage,
  messages
}: {
  source: AutomaticSource
  recipient: string
  expectedBuyAmount: string
  provider: ProviderName
  slippage?: number
  messages: { invalidAddress: string; serviceUpdate: string; noRoute: string }
}): Promise<PreparedAutomatic> => {
  if (bchAddressProblem(recipient, true)) throw new Error(messages.invalidAddress)
  const intent: OrderIntent = { recipientAddress: recipient, refundAddress: recipient, source, expectedBchSats: toBaseUnits(expectedBuyAmount, 8).toString() }
  const reusable = autoBridgeStore
    .getState()
    .orders.find(ref => !ref.sourceAttempted && sameIntent(ref.intent, intent) && (!ref.order || (ref.order.state === 'awaiting_deposit' && !ref.order.sourceHash)))
  const ref: SavedAutoOrder = reusable ?? { id: crypto.randomUUID(), capability: (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', ''), createdAt: Date.now(), intent }
  autoBridgeStore.getState().save(ref)
  assertAutomaticSaved(ref)
  const order = ref.order ?? (await createAutomaticOrder(ref))
  if (order.apiVersion !== 2 || order.recoveryRequired) throw new Error(messages.serviceUpdate)
  autoBridgeStore.getState().patch(ref.id, { order })
  const quotes = await getQuotes({
    buyAsset: BridgeConfig.buyAsset,
    sellAsset: source.asset,
    sellAmount: source.amount,
    sourceAddress: source.address,
    destinationAddress: order.depositAddress,
    refundAddress: source.address,
    dry: false,
    slippage: slippage ?? 99,
    providers: AppConfig.providers
  })
  const route = quotes.find(q => q.providers[0] === provider) ?? quotes[0]
  if (!route || !isBridgeRoute(route, { sellAsset: source.asset, destinationAddress: order.depositAddress }) || !new USwapNumber(route.sellAmount).eqValue(source.amount))
    throw new Error(messages.noRoute)
  return { reference: { ...ref, order }, route }
}

interface Props {
  prepared: PreparedAutomatic
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

// The automatic transfer's confirm: the manual bridge's Confirm Swap with the guaranteed PUSD minimum,
// and one signature in the source wallet. Its progress then opens like the manual bridge's.
export const AutoBridgeDialog = ({ prepared, isOpen, onOpenChange }: Props) => {
  const t = useTranslations('automatic')
  const tSwap = useTranslations('swap')
  const tConfirm = useTranslations('bridge.confirm')
  const from = useAssetFrom()
  const { setAmountFrom } = useSwap()
  const { rateFrom, rateTo } = useSwapRates()
  const { openDialog } = useDialog()
  const { reference, route } = prepared
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [acceptedImpact, setAcceptedImpact] = useState(false)
  const [acceptedLtc, setAcceptedLtc] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const attempted = autoBridgeStore(state => !!state.orders.find(order => order.id === reference.id)?.sourceAttempted)
  const impact = resolvePriceImpact(route, rateFrom, rateTo)
  const needsImpact = !!impact && impact.gt(2)
  const needsLtc = from?.ticker === 'LTC'
  const blocked = (needsImpact && !acceptedImpact) || (needsLtc && !acceptedLtc)
  const order = reference.order!
  const source = reference.intent!.source!

  const send = async () => {
    if (busy || attempted || blocked) return
    setBusy(true)
    setError(undefined)
    try {
      const latest = await orderRequest(reference, 'GET')
      if (latest.apiVersion !== 2 || latest.recoveryRequired) throw new Error(t('serviceUpdate'))
      if (latest.minPusd !== order.minPusd || latest.depositAddress !== order.depositAddress) throw new Error(t('changed'))
      autoBridgeStore.getState().patch(reference.id, { order: latest, estimatedSeconds: firstLegSeconds(route.estimatedTime) })
      const executable = from?.chain === Chain.Tron && route.expiration ? { ...route, expiration: undefined } : route
      await startAutomaticSource(
        reference,
        route,
        source.asset,
        () => getUSwap().swap({ route: executable as QuoteResponseRoute, feeOptionKey: FeeOption.Fast }) as Promise<string>,
        hash => orderRequest(reference, 'POST', { sourceHash: hash }),
        () => mounted.current
      )
      toast.success(tSwap('toast.transactionSubmitted'))
      setAmountFrom('')
      onOpenChange(false)
      openDialog(AutomaticOrderDialog, { id: reference.id })
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure : new Error(t('unavailable')))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="bridge-confirm-dialog flex h-auto max-h-5/6 flex-col md:max-w-[620px]">
        <BridgeConfirm quote={route} token={PUSD_TOKEN} bchAddress={order.recipientAddress} automatic={{ minPusd: order.minPusd, refundAddress: order.refundAddress, contract: !!order.contract }} />
        <div className="space-y-3 p-4 pt-2 md:px-7 md:pb-7">
          {needsLtc && <SwapAddressWarning checked={acceptedLtc} onCheckedChange={setAcceptedLtc} text={t('ltcWarning')} />}
          {needsImpact && <SwapAddressWarning checked={acceptedImpact} onCheckedChange={setAcceptedImpact} text={t('highImpact')} />}
          {error instanceof RouterUnavailableError ? <RouterUnavailable onRetry={send} disabled={busy} /> : error && <SwapError error={error} />}
          {attempted && !busy && <p role="status" className="text-sm">{t('attempted')}</p>}
          <GenericButton colorType="3" size="large" className="w-full whitespace-normal" disabled={busy || attempted || blocked} onClick={send} aria-busy={busy}>
            {busy && <LoaderCircle size={20} className="animate-spin" />}
            <span>
              {busy
                ? tConfirm('openWallet', { chain: from ? chainLabel(from.chain) : '' })
                : tConfirm('send', { amount: new USwapNumber(route.sellAmount).toSignificant(), ticker: from?.ticker ?? '' })}
            </span>
          </GenericButton>
        </div>
      </CredenzaContent>
    </Credenza>
  )
}
