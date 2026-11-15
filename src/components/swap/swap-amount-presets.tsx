import { AmountPresets } from '@/components/swap/amount-presets'
import { useBalance } from '@/hooks/use-balance'
import { useSwap } from '@/hooks/use-swap'

// The chips of the forward form: shares of the source wallet's spendable balance.
export const SwapAmountPresets = ({ revealed }: { revealed: boolean }) => {
  const { setValueFrom } = useSwap()
  const { balance } = useBalance()
  const spendable = balance?.spendable
  if (!spendable || spendable.eqValue(0)) return null

  return (
    <AmountPresets
      revealed={revealed}
      inputId="swap-sell-amount"
      onPercent={percent => setValueFrom(spendable.mul(percent).div(100))}
      onMax={() => setValueFrom(spendable)}
    />
  )
}
