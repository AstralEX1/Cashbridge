'use client'

import { useTranslations } from 'next-intl'
import { NearMark, ThorchainMark } from '@/components/swap/bridge-marks'
import { useTokenQuoteFor } from '@/components/swap/pusd-swap'
import { useQuote } from '@/hooks/use-quote'
import { useAssetFrom, useSwap } from '@/hooks/use-swap'
import { formatBaseUnits } from '@/lib/bridge'
import { firstLegSeconds, formatMinutes } from '@/lib/bridge-summary'
import { useSwapStore } from '@/store/swap-store'

const ROUTES = [
  { key: 'thorchain', name: 'THORChain', Mark: ThorchainMark },
  { key: 'near', name: 'NEAR Intents', Mark: NearMark }
] as const

// The two bridges side by side when NEAR is allowed and an amount is set — even if one quote fails.
// What each would deliver (into BCH: the token through the same Cauldron swap, else BCH; back from BCH:
// the other chain's asset) and how long it takes. The better one is taken unless the user picks the other.
export const RouteCompare = () => {
  const t = useTranslations('bridge.routes')
  const { routes, quote, best, nearAllowed, isLoading } = useQuote()
  const { valueFrom } = useSwap()
  const reverse = useSwapStore(state => state.reverse)
  const payout = useAssetFrom()
  // Back from BCH the store's token is the one sold, not one bought.
  const bchToken = useSwapStore(state => state.bchToken)
  const token = reverse ? null : bchToken
  const setChoice = useSwapStore(state => state.setRouteChoice)
  const estimates = {
    thorchain: useTokenQuoteFor(token ? routes?.thorchain?.expectedBuyAmount : undefined, token),
    near: useTokenQuoteFor(token ? routes?.near?.expectedBuyAmount : undefined, token)
  }
  const amountSet = !valueFrom.eqValue(0)
  // Show both route cards whenever NEAR is in play and the user typed an amount — not only when NEAR succeeds.
  if (!nearAllowed || !amountSet) return null

  return (
    <div className="bridge-routes" role="radiogroup" aria-label={t('label')} data-loading={isLoading || undefined}>
      {ROUTES.map(({ key, name, Mark }) => {
        const route = routes?.[key]
        const estimate = estimates[key]
        const amount = !route
          ? undefined
          : token
            ? estimate.output === undefined
              ? estimate.isLoading
                ? '…'
                : `${route.expectedBuyAmount} BCH`
              : `${formatBaseUnits(estimate.output, token.decimals)} ${token.ticker}`
            : `${route.expectedBuyAmount} ${reverse ? (payout?.ticker ?? '') : 'BCH'}`
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
              <span>{route ? (seconds ? t('minutes', { minutes: formatMinutes(seconds) }) : '') : t('unavailable')}</span>
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
