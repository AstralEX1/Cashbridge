import { useBchWallet } from '@/components/bch-wallet'
import { BridgeConfig } from '@/config'
import { automaticEligible } from '@/lib/auto-bridge-contract'
import { automaticPreference } from '@/store/auto-bridge-store'
import { useSwapStore } from '@/store/swap-store'
import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}
export const useAutomaticHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false)

export const useAutomaticBridge = () => {
  const reverse = useSwapStore(state => state.reverse)
  const category = useSwapStore(state => state.bchToken?.category)
  const mode = automaticPreference(state => state.mode)
  const address = automaticPreference(state => state.recipient)
  const wallet = useBchWallet()
  const hydrated = useAutomaticHydrated()
  const eligible = automaticEligible(reverse, category, BridgeConfig.pusd.category)
  return { eligible, automatic: hydrated && eligible && mode === 'automatic', recipient: address.trim() || wallet.binding?.tokenAddress || '' }
}
