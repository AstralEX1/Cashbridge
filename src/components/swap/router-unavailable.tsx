'use client'

import { useTranslations } from 'next-intl'
import { Icon } from '@/components/icons'

// "Cashbridge Router is unavailable" with Try again in the same message. Try again re-runs the step the
// person was on (Send on the form, or Send on Confirm), so what they entered and quoted stays as it was.
export const RouterUnavailable = ({ onRetry, disabled }: { onRetry: () => void; disabled?: boolean }) => {
  const t = useTranslations('automatic')
  return (
    <div role="alert" className="bridge-router-down">
      <span className="text-lucian flex items-center gap-2 text-sm">
        <Icon name="warning" className="size-4 shrink-0" />
        {t('unavailable')}
      </span>
      <button type="button" disabled={disabled} onClick={onRetry}>
        {t('tryAgain')}
      </button>
    </div>
  )
}
