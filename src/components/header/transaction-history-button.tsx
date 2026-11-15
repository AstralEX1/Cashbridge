'use client'

import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/global-dialog'
import { TransactionHistoryDialog } from '@/components/header/transaction-history-dialog'
import { Icon } from '@/components/icons'
import { GenericButton } from '@/components/generic-button'
import { useHasTransactions, usePendingTransactions } from '@/store/transaction-store'
import { autoBridgeStore } from '@/store/auto-bridge-store'
import { isTerminal } from '@/lib/auto-bridge-contract'
import { useAutomaticHydrated } from '@/hooks/use-automatic-bridge'

export const TransactionHistoryButton = () => {
  const t = useTranslations('header')
  const { openDialog } = useDialog()

  const hasTransactions = useHasTransactions()
  const pendingTransactions = usePendingTransactions()
  const automatic = autoBridgeStore(state => state.orders)
  const hydrated = useAutomaticHydrated()
  const pendingAutomatic = hydrated && automatic.some(ref => ref.sourceAttempted && (!ref.order || !isTerminal(ref.order.state)))

  if (!hasTransactions && !(hydrated && automatic.length)) {
    return null
  }

  const onClick = () => {
    openDialog(TransactionHistoryDialog, {})
  }

  return (
    <div className="relative">
      <GenericButton size="medium" className="hidden md:flex" onClick={onClick}>
        {t('history')}
      </GenericButton>
      <GenericButton size="medium" aria-label={t('history')} icon={<Icon name="clock" />} className="flex md:hidden" onClick={onClick} />

      {(pendingTransactions.length > 0 || pendingAutomatic) && <div className="bg-green-default absolute top-0 right-0 -mr-1 size-3 rounded-full" />}
    </div>
  )
}
