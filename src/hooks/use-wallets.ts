import { useIsMemolessHalted } from '@/hooks/use-mimir'
import { accountForChain, connectedAccount, useWalletStore } from '@/store/wallets-store'
import type { Chain } from '@tcswap/core'

export const useAccounts = () => useWalletStore(state => state.accounts)
export const useHasHydrated = () => useWalletStore(state => state.hasHydrated)
export const useDisconnect = () => useWalletStore(state => state.disconnect)
export const useConnectedWallets = () => useWalletStore(state => state.connectedWallets)
export const useSelectAccount = () => useWalletStore(state => state.select)
export const useSetExternalWalletMode = () => useWalletStore(state => state.setExternalWalletMode)

// External wallet mode is the memoless (deposit-channel) entry point, so HALTMEMOLESS makes it
// unusable. The stored preference is kept but ignored until the network lifts the halt, otherwise
// anyone who left the toggle on would silently lose access to their connected wallets.
export const useExternalWalletMode = () => {
  const enabled = useWalletStore(state => state.externalWalletMode)
  const isMemolessHalted = useIsMemolessHalted()

  return enabled && !isMemolessHalted
}

export const useSelectedAccount = () => {
  const selected = useWalletStore(connectedAccount)
  const externalWalletMode = useExternalWalletMode()

  return externalWalletMode ? null : selected
}

export const useConnectedAccount = (chain?: Chain, independent = false) => {
  const selected = useSelectedAccount()
  const connected = useWalletStore(state => chain && independent ? accountForChain(state, chain) : undefined)
  const external = useExternalWalletMode()
  if (independent) return external ? undefined : connected
  return selected && (!chain || selected.network === chain) ? selected : undefined
}

export const useWallets = () => {
  const accounts = useWalletStore(s => s.accounts)
  const selected = useSelectedAccount()
  const connectedWallets = useWalletStore(s => s.connectedWallets)
  const select = useWalletStore(s => s.select)
  const connect = useWalletStore(s => s.connect)
  const disconnect = useWalletStore(s => s.disconnect)

  return {
    accounts,
    selected,
    connectedWallets,
    select,
    connect,
    disconnect
  }
}
