import { useEffect } from 'react'
import { useAssetFrom } from '@/hooks/use-swap'
import { useAccounts, useHasHydrated, useSelectAccount, useSelectedAccount } from '@/hooks/use-wallets'

export const useResolveSource = () => {
  const assetFrom = useAssetFrom()
  const accounts = useAccounts()
  const hasHydrated = useHasHydrated()
  const selectedAccount = useSelectedAccount()
  const selectAccount = useSelectAccount()

  useEffect(() => {
    if (!assetFrom || (!hasHydrated && !accounts.length)) return
    const fromPrevious = accounts.find(
      s => s.provider === selectedAccount?.provider && s.address === selectedAccount?.address && s.network === assetFrom?.chain
    )

    const next = fromPrevious ?? accounts.find(a => a.network === assetFrom.chain)
    if (next !== selectedAccount) selectAccount(next)
  }, [accounts, assetFrom, hasHydrated, selectedAccount, selectAccount])
}
