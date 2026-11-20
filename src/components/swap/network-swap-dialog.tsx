import { useRef, useState } from 'react'
import { Chain, FeeOption, getChainConfig } from '@tcswap/core'
import type { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { useTranslations } from 'next-intl'
import { LoaderCircle } from 'lucide-react'
import { Credenza, CredenzaContent } from '@/components/ui/credenza'
import { GenericButton } from '@/components/generic-button'
import { SwapRecipient } from '@/components/swap/swap-recipient'
import { SwapConfirm } from '@/components/swap/swap-confirm'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { SwapError } from '@/components/swap/swap-error'
import { useBalance } from '@/hooks/use-balance'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetFrom, useAssetTo, useSwap } from '@/hooks/use-swap'
import { useConnectedAccount } from '@/hooks/use-wallets'
import { readableError } from '@/lib/errors'
import { FirstLegRejected } from '@/lib/bridge-first-leg'
import { startNetworkSwap } from '@/lib/network-swap'
import { resolvePriceImpact } from '@/lib/swap-helpers'
import { getUSwap } from '@/lib/wallets'
import { toast } from '@/lib/toast'

// The selected pair signs directly in its source wallet; BCH bridge authorization stays separate.
export const NetworkSwapDialog = ({ provider, isOpen, onOpenChange }: {
  provider: ProviderName
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const t = useTranslations('swap')
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const source = useConnectedAccount(assetFrom?.chain, true)
  const { valueFrom, setAmountFrom } = useSwap()
  const { refetch } = useBalance()
  const { rateFrom, rateTo } = useSwapRates()
  const [quote, setQuote] = useState<QuoteResponseRoute>()
  const [submitting, setSubmitting] = useState(false)
  const signing = useRef(false)
  const [error, setError] = useState<Error>()
  const [accepted, setAccepted] = useState(false)
  const priceImpact = resolvePriceImpact(quote, rateFrom, rateTo)
  const highImpact = !!priceImpact && priceImpact.gt(2)

  const confirm = async () => {
    if (!quote || !assetFrom || !assetTo || !source || signing.current || (highImpact && !accepted)) return
    signing.current = true
    setSubmitting(true)
    setError(undefined)
    // Tron expects a relative extension, whereas the quote carries an absolute Unix deadline.
    const route = assetFrom.chain === Chain.Tron ? { ...quote, expiration: undefined } : quote
    try {
      await startNetworkSwap({
        route: quote,
        base: {
          provider: quote.providers[0], chainId: getChainConfig(assetFrom.chain).chainId,
          timestamp: new Date(), estimatedTime: quote.estimatedTime?.total,
          assetFrom, assetTo, amountFrom: valueFrom.toSignificant(), amountTo: quote.expectedBuyAmount,
          addressFrom: source.address, addressTo: quote.destinationAddress ?? '', addressDeposit: quote.inboundAddress
        },
        execute: () => getUSwap().swap({ route: route as any, feeOptionKey: FeeOption.Fast }) as Promise<string>
      })
      toast.success(t('toast.transactionSubmitted'))
      onOpenChange(false)
      try { setAmountFrom(''); refetch() } catch { /* The broadcast already succeeded. */ }
    } catch (failure) {
      if (failure instanceof FirstLegRejected) {
        signing.current = false
        setSubmitting(false)
        return
      }
      // A wallet timeout may have sent funds: keep Confirm disabled and its history record unknown.
      setError(new Error(readableError(failure, t('toast.errorSubmitting'))))
      setSubmitting(false)
    }
  }

  return (
    <Credenza open={isOpen} onOpenChange={open => { if (!signing.current || !submitting) onOpenChange(open) }}>
      <CredenzaContent className="flex h-auto max-h-5/6 flex-col md:max-w-xl">
        {quote ? <>
          <SwapConfirm quote={quote} priceImpact={priceImpact} />
          <div className="space-y-3 p-4 md:p-8">
            {highImpact && <SwapAddressWarning checked={accepted} onCheckedChange={setAccepted} text={t('warning.highPriceImpact')} />}
            {error && <SwapError error={error} />}
            <GenericButton colorType="3" size="large" className="w-full" onClick={confirm} disabled={!source || submitting || !!error || (highImpact && !accepted)}>
              {submitting && <LoaderCircle size={20} className="animate-spin" />}
              {submitting ? t('confirm.confirming') : t('confirm.button')}
            </GenericButton>
          </div>
        </> : <SwapRecipient provider={provider} onFetchQuote={setQuote} />}
      </CredenzaContent>
    </Credenza>
  )
}
