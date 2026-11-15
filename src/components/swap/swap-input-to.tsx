import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import { BridgeAssetButton, BridgeAssetPicker, type BridgeInputProps } from '@/components/swap/bridge-asset-picker'
import { BridgeInputSwitcher } from '@/components/swap/bridge-input-switcher'
import { BridgeWalletBadge } from '@/components/swap/bridge-wallet-badge'
import { PriceImpact } from '@/components/swap/price-impact'
import { useTokenEstimate } from '@/components/swap/pusd-swap'
import { SwapQuoteTimer } from '@/components/swap/swap-quote-timer'
import { Tooltip } from '@/components/tooltip'
import { useQuote } from '@/hooks/use-quote'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetTo } from '@/hooks/use-swap'
import { formatBaseUnits } from '@/lib/bridge'
import { formatUsd, pusdUsdPrice } from '@/lib/bridge-summary'
import { PUSD_TOKEN, sameToken } from '@/lib/cauldron-tokens'
import { useSwapStore } from '@/store/swap-store'
import { BchDestinationMenu, DestinationAddressInput } from '@/components/swap/automatic-bridge-controls'
import { useAutomaticBridge } from '@/hooks/use-automatic-bridge'

export const SwapInputTo = ({ priceImpact, selecting, onSelectOpenChange }: BridgeInputProps & { priceImpact?: USwapNumber }) => {
  const t = useTranslations('bridge.form')
  const tSwap = useTranslations('swap')
  const assetTo = useAssetTo()
  const token = useSwapStore(state => state.bchToken)
  const { pasteAllowed } = useAutomaticBridge()
  const { quote, isLoading, refetch } = useQuote()
  const estimate = useTokenEstimate()
  const { rateTo } = useSwapRates()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    onSelectOpenChange(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const output = !quote
    ? undefined
    : token
      ? estimate.output === undefined || estimate.error
        ? undefined
        : formatBaseUnits(estimate.output, token.decimals)
      : new USwapNumber(quote.expectedBuyAmount).toSignificant()
  const busy = isLoading || (!!token && estimate.isLoading)

  // USD of what arrives: BCH at its pool price; a token at the live Cauldron price (BCH price × pool
  // rate). PUSD falls back to its $1 peg, marked "≈", when BCH has no price.
  const bchUsd = rateTo ? Number(rateTo.toSignificant(12)) : undefined
  const usd = (() => {
    if (busy || output === undefined || !quote) return undefined
    if (!token) return bchUsd === undefined ? undefined : formatUsd(Number(quote.expectedBuyAmount) * bchUsd)
    const leg = estimate.quote && { sell: Number(estimate.quote.sell) / 1e8, spotOutput: estimate.quote.spotOutput / 10 ** token.decimals }
    if (!sameToken(token, PUSD_TOKEN) && (bchUsd === undefined || !leg)) return undefined
    const { price, estimate: approx } = pusdUsdPrice(bchUsd, leg)
    return `${approx ? '≈ ' : ''}${formatUsd(Number(output) * price)}`
  })()

  return (
    <BridgeInputSwitcher selecting={selecting}>
      <div className="bridge-input-switcher__slot" aria-hidden={selecting} inert={selecting}>
        <section className="bridge-input" aria-label={t('to')}>
          <div className="bridge-input-heading">
            <BridgeAssetButton
              ref={trigger}
              asset={assetTo}
              bch
              token={token}
              aria-label={t('to')}
              aria-expanded={selecting}
              onClick={() => onSelectOpenChange(true)}
            />
            {pasteAllowed ? <BchDestinationMenu /> : <BridgeWalletBadge kind="bch" />}
          </div>
          <DestinationAddressInput />
          <output className="bridge-amount" aria-label={t('receiveAmount')} aria-live="polite" aria-busy={busy}>
            {busy ? <span className="bridge-muted animate-pulse">···</span> : (output ?? '')}
          </output>
          <div className="bridge-input-meta">
            <span>
              {usd ?? t('receiveAmount')}
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
      </div>
      <div className="bridge-input-switcher__slot bridge-input-switcher__picker-slot" aria-hidden={!selecting} inert={!selecting}>
        <BridgeAssetPicker side="to" bch open={selecting} onClose={close} />
      </div>
    </BridgeInputSwitcher>
  )
}
