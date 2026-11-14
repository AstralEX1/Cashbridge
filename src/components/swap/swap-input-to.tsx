import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import { Skeleton } from '@/components/ui/skeleton'
import { AssetIcon } from '@/components/asset-icon'
import { chainLabel } from '@/components/connect-wallet/config'
import { DecimalInput } from '@/components/decimal/decimal-input'
import { PriceImpact } from '@/components/swap/price-impact'
import { SwapQuoteTimer } from '@/components/swap/swap-quote-timer'
import { Tooltip } from '@/components/tooltip'
import { useQuote } from '@/hooks/use-quote'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetTo } from '@/hooks/use-swap'
import { useIsLimitSwap, useIsPrivateSend, useLimitSwapBuyAmount } from '@/store/limit-swap-store'
import { toCurrencyFixed } from '@/lib/utils'

export const SwapInputTo = ({ priceImpact }: { priceImpact?: USwapNumber }) => {
  const t = useTranslations('swap')
  const assetTo = useAssetTo()
  const { quote, isLoading, refetch } = useQuote()
  const { rateTo } = useSwapRates()
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()
  const isPrivateSend = useIsPrivateSend()
  const buyLabel = isPrivateSend ? t('input.recipientGets') : t('input.buy')

  const value =
    isLimitSwap && limitSwapBuyAmount ? USwapNumber.fromBigInt(BigInt(limitSwapBuyAmount), 8) : quote && new USwapNumber(quote.expectedBuyAmount)

  const fiatValueTo = (rateTo && value && value.mul(rateTo)) || new USwapNumber(0)

  return (
    <div className="bg-swap-bloc rounded-15 border p-7">
      <div className="mb-3 flex items-center justify-between">
        <label htmlFor="swap-buy-amount" className="text-txt-label-small font-semibold">
          {buyLabel}
        </label>
        <SwapQuoteTimer quote={quote} isLoading={isLoading} refetch={refetch} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex-1">
          <DecimalInput
            id="swap-buy-amount"
            className="text-txt-high-contrast w-full bg-transparent text-2xl font-medium outline-none"
            amount={value ? value.toSignificant() : ''}
            onAmountChange={() => null}
            autoComplete="off"
            disabled
          />
          <div className="flex gap-2 text-sm font-medium">
            <span className="text-txt-label-small">{toCurrencyFixed(fiatValueTo.toCurrency('$', { trimTrailingZeros: false }))}</span>
            {priceImpact && (
              <Tooltip content={t('confirm.priceImpact')}>
                <span>
                  (<PriceImpact priceImpact={priceImpact} />)
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        {/* The buy side is fixed to native BCH (the bridge's first leg), so there is nothing to pick. */}
        <span className="flex items-center gap-2 px-2" aria-label={`${buyLabel}: ${assetTo?.ticker ?? ''}`}>
          <AssetIcon asset={assetTo} />
          <span className="flex w-16 flex-col items-start gap-1 text-left">
            <span className="inline-block w-full truncate text-base leading-none font-medium">
              {assetTo ? assetTo.ticker : <Skeleton className="h-4 w-12" />}
            </span>
            <span className="text-icon-btn-default inline-block w-full truncate text-xs leading-none font-medium">
              {assetTo?.chain ? chainLabel(assetTo.chain) : <Skeleton className="h-3 w-16" />}
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}
