import { useTranslations } from 'next-intl'
import { Coins, Loader } from 'lucide-react'
import { DecimalText } from '@/components/decimal/decimal-text'
import { Tooltip } from '@/components/tooltip'
import { useBalance } from '@/hooks/use-balance'
import { useSwap } from '@/hooks/use-swap'

export const SwapBalance = () => {
  const t = useTranslations('swap')
  const { setValueFrom } = useSwap()
  const { balance, isLoading: isBalanceLoading } = useBalance()

  const renderBalance = () => {
    if (isBalanceLoading) {
      return <Loader className="animate-spin" size={18} />
    }

    if (balance) {
      return <DecimalText amount={balance.spendable.toSignificant()} />
    }

    return null
  }

  const balanceContent = renderBalance()

  if (!balanceContent) return null

  return (
    <Tooltip content={t('balance.useMax')}>
      <button
        type="button"
        className="bridge-max-balance"
        aria-label={t('balance.useMax')}
        disabled={isBalanceLoading || !balance || balance.spendable.eqValue(0)}
        onClick={() => balance && setValueFrom(balance.spendable)}
      >
        <Coins size={15} aria-hidden="true" />
        {balanceContent}
      </button>
    </Tooltip>
  )
}
