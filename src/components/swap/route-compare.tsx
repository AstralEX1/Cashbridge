'use client'

import { useTranslations } from 'next-intl'
import { NearMark, ShapeShiftMark, ThorchainMark } from '@/components/swap/bridge-marks'
import { useTokenQuoteFor } from '@/components/swap/pusd-swap'
import { useQuote } from '@/hooks/use-quote'
import { useAssetFrom, useAssetTo, useSwap } from '@/hooks/use-swap'
import { formatBaseUnits } from '@/lib/bridge'
import { firstLegSeconds, formatAmount, formatMinutes } from '@/lib/bridge-summary'
import { useSwapStore } from '@/store/swap-store'

const ROUTES = [
  { key: 'thorchain', name: 'THORChain', Mark: ThorchainMark },
  { key: 'near', name: 'NEAR Intents', Mark: NearMark },
  { key: 'shapeshift', name: 'ShapeShift', Mark: ShapeShiftMark }
] as const

// The routes side by side when NEAR or ShapeShift is allowed and an amount is set — even if one quote fails.
// What each would deliver, all rounded alike (into BCH: the token through the same Cauldron swap, else BCH; back from BCH:
// the other chain's asset) and how long it takes. The better one is taken unless the user picks the other.
export const RouteCompare = () => {
  const t = useTranslations('bridge.routes')
  const { routes, quote, best, nearAllowed, shapeshiftAllowed, isLoading } = useQuote()
  const { valueFrom } = useSwap()
  const reverse = useSwapStore(state => state.reverse)
  const openNetworks = useSwapStore(state => state.openNetworks)
  const payout = useAssetFrom()
  const bought = useAssetTo()
  // Back from BCH the store's token is the one sold, not one bought. Open networks has no Cauldron leg.
  const bchToken = useSwapStore(state => state.bchToken)
  const token = openNetworks || reverse ? null : bchToken
  const setChoice = useSwapStore(state => state.setRouteChoice)
  const estimates = {
    thorchain: useTokenQuoteFor(token ? routes?.thorchain?.expectedBuyAmount : undefined, token),
    near: useTokenQuoteFor(token ? routes?.near?.expectedBuyAmount : undefined, token),
    shapeshift: useTokenQuoteFor(token ? routes?.shapeshift?.expectedBuyAmount : undefined, token)
  }
  const amountSet = !valueFrom.eqValue(0)
  // Show the route cards whenever an extra route is in play and the user typed an amount — not only when it succeeds.
  if (!(nearAllowed || shapeshiftAllowed) || !amountSet) return null

  return (
    <div className="bridge-routes" role="radiogroup" aria-label={t('label')} data-loading={isLoading || undefined}>
      {ROUTES.filter(({ key }) => key === 'thorchain' || (key === 'near' ? nearAllowed : shapeshiftAllowed)).map(({ key, name, Mark }) => {
        const route = routes?.[key]
        const estimate = estimates[key]
        const amount = !route
          ? undefined
          : token
            ? estimate.output === undefined
              ? estimate.isLoading
                ? '…'
                : `${formatAmount(Number(route.expectedBuyAmount))} BCH`
              : `${formatBaseUnits(estimate.output, token.decimals)} ${token.ticker}`
            : `${formatAmount(Number(route.expectedBuyAmount))} ${(openNetworks ? bought?.ticker : reverse ? payout?.ticker : 'BCH') ?? ''}`
        const seconds = route ? firstLegSeconds(route.estimatedTime) : undefined
        const selected = !!route && !!quote && route === quote
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            className="bridge-route"
            disabled={!route}
            onClick={() => setChoice(key === best ? 'auto' : key)}
          >
            <Mark size={22} />
            <span className="bridge-route-name">
              <strong>{name}</strong>
              <span>{route ? (seconds ? t('minutes', { minutes: formatMinutes(seconds) }) : '') : key === 'thorchain' && routes?.thorchainHalted ? t('halted') : t('unavailable')}</span>
            </span>
            <span className="bridge-route-amount">
              {amount ?? (isLoading && !routes ? '…' : '—')}
              {key === best && route && <span className="bridge-route-best">{t('best')}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
