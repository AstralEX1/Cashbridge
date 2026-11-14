import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import { DecimalInput } from '@/components/decimal/decimal-input'
import { BridgeAssetButton, BridgeAssetPicker, type BridgeInputProps } from '@/components/swap/bridge-asset-picker'
import { SwapBalance } from '@/components/swap/swap-balance'
import { BridgeWalletBadge } from '@/components/swap/bridge-wallet-badge'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetFrom, useSwap } from '@/hooks/use-swap'
import { toCurrencyFixed } from '@/lib/utils'

export const SwapInputFrom = ({ selecting, onSelectOpenChange }: BridgeInputProps) => {
  const t = useTranslations('bridge.form')
  const assetFrom = useAssetFrom()
  const { amountFrom, setAmountFrom, valueFrom } = useSwap()
  const { rateFrom } = useSwapRates()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    onSelectOpenChange(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  if (selecting) return <BridgeAssetPicker side="from" onClose={close} />

  return (
    <section className="bridge-input" aria-label={t('from')}>
      <div className="bridge-input-heading">
        <BridgeAssetButton
          ref={trigger}
          asset={assetFrom}
          aria-label={t('from')}
          aria-expanded={selecting}
          onClick={() => onSelectOpenChange(true)}
        />
        <BridgeWalletBadge side="from" />
      </div>
      <label htmlFor="swap-sell-amount" className="sr-only">
        {t('sendAmount')}
      </label>
      <div className="bridge-amount-row">
        <DecimalInput id="swap-sell-amount" className="bridge-amount" amount={amountFrom} onAmountChange={setAmountFrom} autoComplete="off" />
        <SwapBalance />
      </div>
      <div className="bridge-input-meta">
        <span>{toCurrencyFixed(valueFrom.mul(rateFrom || new USwapNumber(0)).toCurrency('$', { trimTrailingZeros: false }))}</span>
      </div>
    </section>
  )
}
