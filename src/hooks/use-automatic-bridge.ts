import { useBchWallet } from '@/components/bch-wallet'
import { automaticEligible } from '@/lib/auto-bridge-contract'
import { bchAddressProblem, bindingFromAddress } from '@/lib/bch'
import { automaticPreference } from '@/store/auto-bridge-store'
import { useSwapStore } from '@/store/swap-store'
import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}
export const useAutomaticHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false)

// The Cashbridge Router toggle covers the forward routes that need no BCH signature from the user:
// a Cauldron token (the service buys it) and plain BCH (nothing to swap). Only a token changes how it executes.
export const useAutomaticBridge = () => {
  const reverse = useSwapStore(state => state.reverse)
  const token = useSwapStore(state => state.bchToken)
  const mode = automaticPreference(state => state.mode)
  const address = automaticPreference(state => state.recipient)
  const wallet = useBchWallet()
  const hydrated = useAutomaticHydrated()
  const eligible = automaticEligible(reverse, token?.category)
  const plainBch = !reverse && token === null
  const routerAvailable = eligible || plainBch
  const automatic = hydrated && eligible && mode === 'automatic'
  // Both routes can pay a pasted address instead of the connected wallet.
  const pasteAllowed = automatic || plainBch
  const pasted = pasteAllowed ? address.trim() : ''
  // On the Router's token route a pasted address has to be token-aware.
  const pastedProblem = pasted ? bchAddressProblem(pasted, automatic) : undefined
  return {
    eligible,
    automatic,
    plainBch,
    routerAvailable,
    routerOn: hydrated && routerAvailable && mode === 'automatic',
    pasteAllowed,
    pasted,
    pastedProblem,
    token,
    recipient: pasted || wallet.binding?.tokenAddress || ''
  }
}

// Where the first leg pays: a pasted plain-BCH address, else the connected BCH wallet.
export const useBchDestination = () => {
  const wallet = useBchWallet()
  const { plainBch, pasted, pastedProblem } = useAutomaticBridge()
  // A typed address never falls back to the wallet: an invalid one leaves no destination at all.
  if (plainBch && pasted) {
    const binding = pastedProblem ? undefined : bindingFromAddress(pasted)
    return { binding, pasted: true, invalid: !binding }
  }
  return { binding: wallet.binding, pasted: false, invalid: false }
}
