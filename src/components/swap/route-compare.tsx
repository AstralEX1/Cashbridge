'use client'

import { useTranslations } from 'next-intl'
import { NearMark, ThorchainMark } from '@/components/swap/bridge-marks'
import { useTokenQuoteFor } from '@/components/swap/pusd-swap'
import { useQuote } from '@/hooks/use-quote'
import { formatBaseUnits } from '@/lib/bridge'
import { firstLegSeconds, formatMinutes } from '@/lib/bridge-summary'
import { useSwapStore } from '@/store/swap-store'

const ROUTES = [
  { key: 'thorchain', name: 'THORChain', Mark: ThorchainMark },
  { key: 'near', name: 'NEAR Intents', Mark: NearMark }
] as const

// The two bridges side by side when both quote: what each would deliver (the token through the same Cauldron
// swap, else BCH) and how long it takes. The better one is taken unless the user picks the other.
export const RouteCompare = () => {
  const t = useTranslations('bridge.routes')
  const { routes, quote, best } = useQuote()
  const token = useSwapStore(state => state.bchToken)
  const setChoice = useSwapStore(state => state.setRouteChoice)
  const estimates = {
    thorchain: useTokenQuoteFor(token ? routes?.thorchain?.expectedBuyAmount : undefined, token),
    near: useTokenQuoteFor(token ? routes?.near?.expectedBuyAmount : undefined, token)
  }
  if (!routes?.near) return null

  return (
    <div className="bridge-routes" role="radiogroup" aria-label={t('label')}>
      {ROUTES.map(({ key, name, Mark }) => {
        const route = routes[key]
        const estimate = estimates[key]
        const amount = !route
          ? undefined
          : token
            ? estimate.output === undefined
              ? estimate.isLoading
                ? '…'
                : `${route.expectedBuyAmount} BCH`
              : `${formatBaseUnits(estimate.output, token.decimals)} ${token.ticker}`
            : `${route.expectedBuyAmount} BCH`
        const seconds = route ? firstLegSeconds(route.estimatedTime) : undefined
        const selected = !!route && route === quote
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
              {amount ?? '—'}
              {key === best && <span className="bridge-route-best">{t('best')}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
