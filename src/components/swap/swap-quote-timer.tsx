import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefetchOptions } from '@tanstack/react-query'
import { QuoteResponseRoute } from '@tcswap/helpers/api'
import { RotateCw } from 'lucide-react'
import { Tooltip } from '@/components/tooltip'

const QUOTE_EXPIRATION_MS = 60000

interface SwapQuoteTimerProps {
  quote?: QuoteResponseRoute | undefined
  refetch: (options?: RefetchOptions) => void
  isLoading: boolean
}

// A ring around the refresh icon fills up until the quote is refreshed. The ring is a CSS animation that
// restarts with each new quote, so the countdown costs no re-renders.
export const SwapQuoteTimer = ({ quote, isLoading, refetch }: SwapQuoteTimerProps) => {
  const t = useTranslations('swap')
  const [startedAt, setStartedAt] = useState<number | null>(null)

  useEffect(() => {
    setStartedAt(quote && !isLoading ? Date.now() : null)
  }, [quote, isLoading])

  useEffect(() => {
    if (!startedAt) return
    const timer = setTimeout(() => refetch(), QUOTE_EXPIRATION_MS)
    return () => clearTimeout(timer)
  }, [startedAt, refetch])

  if (!quote || isLoading || !startedAt) return null

  return (
    <Tooltip content={t('quoteTimer.refresh')}>
      <button type="button" className="bridge-quote-timer" aria-label={t('quoteTimer.refresh')} onClick={() => refetch()}>
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="12" className="bridge-quote-timer__track" />
          <circle
            key={startedAt}
            cx="14"
            cy="14"
            r="12"
            className="bridge-quote-timer__ring"
            style={{ animationDuration: `${QUOTE_EXPIRATION_MS}ms` }}
          />
        </svg>
        <RotateCw size={11} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
