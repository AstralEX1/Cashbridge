import { USwapNumber } from '@tcswap/core'
import { useTranslations } from 'next-intl'
import { Tooltip } from '@/components/tooltip'
import { formatPercent } from '@/lib/bridge-summary'
import { cn } from '@/lib/utils'

export const PriceImpact = ({ priceImpact, className }: { priceImpact: USwapNumber; className?: string }) => {
  return (
    <span
      className={cn(className, {
        'text-txt-high-contrast': priceImpact.lte(10),
        'text-jacob': priceImpact.gt(10) && priceImpact.lte(20),
        'text-lucian': priceImpact.gt(20)
      })}
    >
      -{priceImpact.toSignificant(2)}%
    </span>
  )
}

// Bridge summaries use signed value differences, including both swap legs and their fees.
export const BridgePriceImpact = ({ percent }: { percent?: number }) => {
  const t = useTranslations('bridge.confirm')
  if (percent === undefined || !Number.isFinite(percent)) return null
  return (
    <Tooltip content={t('impactTooltip')}>
      <span tabIndex={0} className={cn({ 'text-txt-high-contrast': percent >= -10, 'text-jacob': percent < -10 && percent >= -20, 'text-lucian': percent < -20 })}>
        {formatPercent(percent)}
      </span>
    </Tooltip>
  )
}
