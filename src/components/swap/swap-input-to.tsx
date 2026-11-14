import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import { BridgeAssetButton, BridgeAssetPicker, type BridgeInputProps } from '@/components/swap/bridge-asset-picker'
import { BridgeWalletBadge } from '@/components/swap/bridge-wallet-badge'
import { PriceImpact } from '@/components/swap/price-impact'
import { usePusdEstimate } from '@/components/swap/pusd-swap'
import { SwapQuoteTimer } from '@/components/swap/swap-quote-timer'
import { Tooltip } from '@/components/tooltip'
import { BridgeConfig } from '@/config'
import { useQuote } from '@/hooks/use-quote'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetTo } from '@/hooks/use-swap'
import { formatBaseUnits } from '@/lib/bridge'
import { toCurrencyFixed } from '@/lib/utils'
import { useSwapStore } from '@/store/swap-store'

export const SwapInputTo = ({ priceImpact, selecting, onSelectOpenChange }: BridgeInputProps & { priceImpact?: USwapNumber }) => {
  const t = useTranslations('bridge.form')
  const tSwap = useTranslations('swap')
  const assetTo = useAssetTo()
  const destination = useSwapStore(state => state.destinationAsset)
  const { quote, isLoading, refetch } = useQuote()
  const estimate = usePusdEstimate()
  const { rateTo } = useSwapRates()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    onSelectOpenChange(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const isPusd = destination === 'PUSD'
  const output = !quote
    ? undefined
    : isPusd
      ? estimate.pusd === undefined || estimate.error
        ? undefined
        : formatBaseUnits(estimate.pusd, BridgeConfig.pusd.decimals)
      : new USwapNumber(quote.expectedBuyAmount).toSignificant()
  const busy = isLoading || (isPusd && estimate.isLoading)

  if (selecting) return <BridgeAssetPicker side="to" onClose={close} />

  return (
    <section className="bridge-input" aria-label={t('to')}>
      <div className="bridge-input-heading">
        <BridgeAssetButton
          ref={trigger}
          asset={assetTo}
          ticker={destination}
          aria-label={t('to')}
          aria-expanded={selecting}
          onClick={() => onSelectOpenChange(true)}
        />
        <BridgeWalletBadge side="to" />
      </div>
      <output className="bridge-amount" aria-label={t('receiveAmount')} aria-live="polite" aria-busy={busy}>
        {busy ? <span className="bridge-muted animate-pulse">···</span> : (output ?? '')}
      </output>
      <div className="bridge-input-meta">
        <span>
          {isPusd
            ? null
            : rateTo && quote
              ? toCurrencyFixed(new USwapNumber(quote.expectedBuyAmount).mul(rateTo).toCurrency('$', { trimTrailingZeros: false }))
              : t('receiveAmount')}
        </span>
        <div className="flex items-center gap-2">
          {priceImpact && (
            <Tooltip content={tSwap('confirm.priceImpact')}>
              <span>
                <PriceImpact priceImpact={priceImpact} />
              </span>
            </Tooltip>
          )}
          <SwapQuoteTimer quote={quote} isLoading={isLoading} refetch={refetch} />
        </div>
      </div>
    </section>
  )
}
