import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { useQuote } from '@/hooks/use-quote'
import { refreshBridgeQueries } from '@/lib/refresh-queries'

const QUOTE_EXPIRATION_MS = 60000

// Reloads the quote and the wallet balances. A ring around the icon fills up until that happens on its
// own; the ring is a CSS animation that restarts with each new quote, so the countdown costs no re-renders.
export const RefreshButton = () => {
  const t = useTranslations('swap')
  const queryClient = useQueryClient()
  const { quote, isLoading } = useQuote()
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    setBusy(true)
    void refreshBridgeQueries(queryClient).finally(() => setBusy(false))
  }, [queryClient])

  useEffect(() => {
    setStartedAt(quote && !isLoading ? Date.now() : null)
  }, [quote, isLoading])

  useEffect(() => {
    if (!startedAt) return
    const timer = setTimeout(refresh, QUOTE_EXPIRATION_MS)
    return () => clearTimeout(timer)
  }, [startedAt, refresh])

  return (
    <button type="button" className="bridge-refresh" aria-label={t('quoteTimer.refresh')} data-busy={busy || undefined} onClick={refresh}>
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="12" className="bridge-refresh__track" />
        {startedAt && (
          <circle
            key={startedAt}
            cx="14"
            cy="14"
            r="12"
            className="bridge-refresh__ring"
            style={{ animationDuration: `${QUOTE_EXPIRATION_MS}ms` }}
          />
        )}
      </svg>
      <RotateCw size={12} strokeWidth={2.4} aria-hidden="true" />
    </button>
  )
}
