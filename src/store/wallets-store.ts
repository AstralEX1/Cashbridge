import { Chain, WalletOption } from '@tcswap/core'
import { toast } from 'sonner'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { readWalletLink, writeWalletLink } from '@/store/wallets-store-cookie'
import { getAccounts, getUSwap, supportedChains, syncBraveAccountWatch } from '@/lib/wallets'

export interface WalletAccount {
  address: string
  network: Chain
  provider: WalletOption
  derivationPath?: number[]
}

interface WalletState {
  accounts: WalletAccount[]
  selected?: WalletAccount
  connectedWallets: WalletOption[]
  hasHydrated: boolean
  externalWalletMode: boolean

  select: (account?: WalletAccount) => void
  connect: (wallet: WalletOption, chains: Chain[], config?: any) => Promise<void>
  disconnect: (wallet: WalletOption) => void
  setExternalWalletMode: (enabled: boolean) => void
}

// A disconnect or newer connect invalidates older async replies, including session restoration.
const connectionVersions = new Map<WalletOption, number>()
const nextConnectionVersion = (wallet: WalletOption) => {
  const version = (connectionVersions.get(wallet) ?? 0) + 1
  connectionVersions.set(wallet, version)
  return version
}

export const connectedAccount = (state: Pick<WalletState, 'accounts' | 'selected'>) =>
  state.accounts.find(
    account => account.provider === state.selected?.provider && account.network === state.selected?.network && account.address === state.selected?.address
  )

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      accounts: [],
      connectedWallets: [],
      selected: undefined,
      hasHydrated: false,
      externalWalletMode: false,

      select: (account?: WalletAccount) => {
        // A chosen source wallet overrides a saved deposit-only preference.
        set({ selected: account, ...(account ? { externalWalletMode: false } : {}) })
      },

      connect: async (wallet: WalletOption, chains: Chain[], config?: any) => {
        const version = nextConnectionVersion(wallet)
        try {
          const newAccounts = await getAccounts(wallet, chains, config)
          if (connectionVersions.get(wallet) !== version) return
          if (!newAccounts.length) {
            throw new Error(`Failed to get addresses for ${wallet}`)
          }

          set(state => {
            const replacedChains = new Set(newAccounts.map(a => a.network))
            const filtered = state.accounts.filter(acc => acc.provider !== wallet || !replacedChains.has(acc.network))
            const accounts = [...filtered, ...newAccounts]

            return {
              accounts,
              selected: newAccounts.find(account => account.network === state.selected?.network) ?? state.selected ?? newAccounts[0],
              externalWalletMode: false,
              connectedWallets: Array.from(new Set([...state.connectedWallets, wallet]))
            }
          })
        } catch (err: any) {
          if (connectionVersions.get(wallet) !== version) return
          toast.error(err.message)
          throw err
        }
      },

      setExternalWalletMode: (enabled: boolean) => {
        set({ externalWalletMode: enabled })
      },

      disconnect: (wallet: WalletOption) => {
        nextConnectionVersion(wallet)
        const uSwap = getUSwap()
        // `disconnectChain` acts on whichever wallet holds the chain's slot, so skip chains another wallet holds.
        supportedChains[wallet as keyof typeof supportedChains]?.forEach(chain => {
          if (uSwap.getWalletByChain(chain)?.walletType === wallet) uSwap.disconnectChain(chain)
        })

        set(state => {
          const accounts = state.accounts.filter(acc => acc.provider !== wallet)
          const wallets = state.connectedWallets.filter(w => w !== wallet)

          return {
            accounts,
            selected: state.selected?.provider === wallet ? accounts.find(account => account.network === state.selected?.network) : state.selected,
            connectedWallets: wallets
          }
        })
      }
    }),
    {
      name: 'tc-wallet-store',
      version: 1,
      skipHydration: true, // Rehydrate on the client to avoid an import-cycle TDZ.
      partialize: state => ({
        selected: state.selected,
        externalWalletMode: state.externalWalletMode
      }),
      onRehydrateStorage: () => () => {
        const link = readWalletLink()
        if (link.length === 0) {
          useWalletStore.setState({ accounts: [], connectedWallets: [], selected: undefined, hasHydrated: true })
          return
        }

        const versions = new Map(link.map(wallet => [wallet.provider, nextConnectionVersion(wallet.provider)]))
        // Chains with a stored derivation path reconnect one by one — hardware wallets share a single transport.
        const reconnect = async (w: (typeof link)[number]) => {
          const pathChains = w.chains.filter(chain => w.paths?.[chain])
          const defaultChains = w.chains.filter(chain => !w.paths?.[chain])

          const accounts: WalletAccount[] = []
          if (defaultChains.length > 0) accounts.push(...(await getAccounts(w.provider, defaultChains)))
          for (const chain of pathChains) {
            accounts.push(...(await getAccounts(w.provider, [chain], { derivationPath: w.paths?.[chain] })))
          }

          return accounts
        }

        Promise.allSettled(link.map(reconnect))
          .then(res => {
            const rehydrated = res.flatMap((result, index) =>
              result.status === 'fulfilled' && connectionVersions.get(link[index].provider) === versions.get(link[index].provider) ? result.value : []
            )

            // Accounts connected while rehydration was in flight win.
            useWalletStore.setState(state => {
              const connected = new Set(state.accounts.map(a => `${a.provider}:${a.network}`))
              const accounts = [...state.accounts, ...rehydrated.filter(a => !connected.has(`${a.provider}:${a.network}`))]

              return {
                accounts,
                connectedWallets: Array.from(new Set(accounts.map(w => w.provider)))
              }
            })
          })
          .finally(() => useWalletStore.setState({ hasHydrated: true }))
      }
    }
  )
)

// Mirror connected providers/chains to the shared cookie when they change.
useWalletStore.subscribe(state => {
  syncBraveAccountWatch(state.accounts)
  if (!state.hasHydrated) return
  writeWalletLink(state.accounts)
})
