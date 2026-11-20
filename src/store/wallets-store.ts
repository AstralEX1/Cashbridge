import { Chain, EVMChain, EVMChains, WalletOption } from '@tcswap/core'
import { toast } from '@/lib/toast'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { readWalletLink, type WalletLink, writeWalletLink } from '@/store/wallets-store-cookie'
import { isTonConnectDismissed } from '@/lib/ton-wallet'
import {
  getAccounts,
  getUSwap,
  hasAuthorizedAccount,
  isWalletconnectDismissed,
  onWalletconnectDisconnect,
  RESTORE_CHECKED,
  RESTORE_ONLY,
  supportedChains,
  syncBraveAccountWatch,
  watchEvmAccounts
} from '@/lib/wallets'

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
  // `quiet` (a background restore) skips the error toast; `describeError` words it.
  connect: (wallet: WalletOption, chains: Chain[], config?: any, options?: ConnectOptions) => Promise<void>
  disconnect: (wallet: WalletOption) => void
  setExternalWalletMode: (enabled: boolean) => void
}

interface ConnectOptions {
  quiet?: boolean
  describeError?: (error: unknown) => string | undefined
}

// A disconnect or newer connect invalidates older async replies, including session restoration.
const connectionVersions = new Map<WalletOption, number>()
// Saved wallets not (fully) restored this visit (locked, not injected yet, or a failed reconnect)
// stay in the cookie until an explicit disconnect or a newer connect of that provider.
const keptLinks = new Map<WalletOption, WalletLink>()
// Providers with a connect in flight: the accountsChanged events it causes are the grant itself.
const connecting = new Map<WalletOption, number>()
const track = async <T>(wallet: WalletOption, run: () => Promise<T>): Promise<T> => {
  connecting.set(wallet, (connecting.get(wallet) ?? 0) + 1)
  try {
    return await run()
  } finally {
    const left = (connecting.get(wallet) ?? 1) - 1
    if (left > 0) connecting.set(wallet, left)
    else connecting.delete(wallet)
  }
}
const nextConnectionVersion = (wallet: WalletOption) => {
  const version = (connectionVersions.get(wallet) ?? 0) + 1
  connectionVersions.set(wallet, version)
  return version
}

export const connectedAccount = (state: Pick<WalletState, 'accounts' | 'selected'>) =>
  state.accounts.find(
    account => account.provider === state.selected?.provider && account.network === state.selected?.network && account.address === state.selected?.address
  )

export const accountForChain = (state: Pick<WalletState, 'accounts' | 'selected'>, chain: Chain) => {
  const selected = connectedAccount(state)
  return selected?.network === chain ? selected : state.accounts.find(account => account.network === chain)
}

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

      connect: async (wallet: WalletOption, chains: Chain[], config?: any, options?: ConnectOptions) => {
        const version = nextConnectionVersion(wallet)
        try {
          const newAccounts = await track(wallet, () => getAccounts(wallet, chains, config))
          if (connectionVersions.get(wallet) !== version) return
          if (!newAccounts.length) {
            throw new Error(`Failed to get addresses for ${wallet}`)
          }
          // This connect is now the provider's entry.
          keptLinks.delete(wallet)

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
          // Closing WalletConnect's or TON Connect's QR window is a cancel, not a failure.
          if (!options?.quiet && !isWalletconnectDismissed(err) && !isTonConnectDismissed(err)) toast.error(options?.describeError?.(err) ?? err.message)
          throw err
        }
      },

      setExternalWalletMode: (enabled: boolean) => {
        set({ externalWalletMode: enabled })
      },

      disconnect: (wallet: WalletOption) => {
        nextConnectionVersion(wallet)
        keptLinks.delete(wallet)
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
        // Until its restore lands, every saved entry is kept.
        for (const w of link) keptLinks.set(w.provider, w)
        // Chains with a stored derivation path reconnect one by one — hardware wallets share a single transport.
        const reconnect = (w: (typeof link)[number]) => track(w.provider, async () => {
          // Locked or not authorized: restore later, without a popup on page load.
          if ((await hasAuthorizedAccount(w.provider, w.chains)) === false) return []

          const pathChains = w.chains.filter(chain => w.paths?.[chain])
          const defaultChains = w.chains.filter(chain => !w.paths?.[chain])

          const accounts: WalletAccount[] = []
          // WalletConnect and TON Connect reuse a stored session, the Sui and Cardano extensions an earlier grant; with
          // none left the wallet stays disconnected rather than show a QR code or a prompt.
          const config = RESTORE_ONLY.has(w.provider) ? { restoreOnly: true } : undefined
          if (defaultChains.length > 0) accounts.push(...(await getAccounts(w.provider, defaultChains, config)))
          for (const chain of pathChains) {
            accounts.push(...(await getAccounts(w.provider, [chain], { derivationPath: w.paths?.[chain] })))
          }

          return accounts
        })

        Promise.allSettled(link.map(reconnect))
          .then(res => {
            const rehydrated = res.flatMap((result, index) => {
              const w = link[index]
              // A disconnect or newer connect during the restore already settled this provider's entry.
              if (connectionVersions.get(w.provider) !== versions.get(w.provider)) return []
              // A chain the phone ended while it was set up is no longer in core.
              const restored = result.status === 'fulfilled' ? result.value.filter(isInCore) : []
              // Fully restored entries are written from the accounts; partial or failed ones stay kept, except a
              // restore-only wallet's: a chain its stored session or grant lacks never comes back on a retry.
              if (RESTORE_ONLY.has(w.provider) || w.chains.every(chain => restored.some(a => a.network === chain))) {
                keptLinks.delete(w.provider)
              }
              return restored
            })

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

// The phone ended a WalletConnect session (or it expired): its chains are no longer connected. Core decides
// what is left, as the store's accounts may not be in yet (rehydration, a connect in flight).
onWalletconnectDisconnect(chains => {
  getUSwap().disconnectWallet(WalletOption.WALLETCONNECT, chains)

  useWalletStore.setState(state => {
    const accounts = state.accounts.filter(a => a.provider !== WalletOption.WALLETCONNECT || isInCore(a))
    return {
      accounts,
      selected: state.selected && isInCore(state.selected) ? state.selected : accounts.find(a => a.network === state.selected?.network),
      connectedWallets: Array.from(new Set(accounts.map(a => a.provider)))
    }
  })
})

// Whether core still holds the account's wallet; a WalletConnect chain the phone ended is dropped from it.
function isInCore(account: WalletAccount): boolean {
  return account.provider !== WalletOption.WALLETCONNECT || !!getUSwap().getWallet(account.provider, account.network)
}

// Mirror connected providers/chains to the shared cookie when they change.
useWalletStore.subscribe(state => {
  syncBraveAccountWatch(state.accounts)
  if (!state.hasHydrated) return
  syncEvmAccountWatch(state.accounts)
  writeWalletLink(state.accounts, [...keptLinks.values()])
})

// Like wagmi's injected connector: a saved browser wallet follows what the extension says, so nothing
// needs a manual reconnect. An account switch reconnects to the new account; a lock or revoke parks the
// wallet (kept in the cookie, not forgotten); an unlock or a fresh grant brings it back. Brave reloads
// on its own watch (syncBraveAccountWatch), so it is left out here.
const evmWatches = new Map<WalletOption, () => void>()
const isEvm = (chain: Chain) => EVMChains.includes(chain as EVMChain)

function syncEvmAccountWatch(accounts: WalletAccount[]) {
  const wanted = new Set(
    [...accounts.map(a => a.provider), ...keptLinks.keys()].filter(w => RESTORE_CHECKED.has(w) && w !== WalletOption.BRAVE)
  )
  for (const [wallet, unwatch] of evmWatches) {
    if (wanted.has(wallet)) continue
    unwatch()
    evmWatches.delete(wallet)
  }
  for (const wallet of wanted) {
    if (evmWatches.has(wallet)) continue
    const unwatch = watchEvmAccounts(wallet, addresses => onEvmAccountsChanged(wallet, addresses))
    if (unwatch) evmWatches.set(wallet, unwatch)
  }
}

const restoreQuietly = (wallet: WalletOption, chains: Chain[]) => {
  if (connecting.has(wallet) || chains.length === 0) return
  void useWalletStore
    .getState()
    .connect(wallet, chains, undefined, { quiet: true })
    .catch(() => {})
}

export function onEvmAccountsChanged(wallet: WalletOption, addresses: string[]) {
  if (connecting.has(wallet)) return
  const accounts = useWalletStore.getState().accounts.filter(a => a.provider === wallet)
  const kept = keptLinks.get(wallet)

  if (addresses.length === 0) {
    if (accounts.length === 0) return
    // Locked or revoked: drop the accounts (they cannot sign) but keep the wallet saved.
    const chains = [...new Set([...accounts.map(a => a.network), ...(kept?.chains ?? [])])]
    useWalletStore.getState().disconnect(wallet)
    keptLinks.set(wallet, { provider: wallet, chains })
    // The disconnect above already wrote the cookie and dropped the watch without this entry.
    syncEvmAccountWatch(useWalletStore.getState().accounts)
    writeWalletLink(useWalletStore.getState().accounts, [...keptLinks.values()])
    return
  }

  const current = addresses[0].toLowerCase()
  const evm = accounts.filter(a => isEvm(a.network))
  if (!kept && evm.length > 0 && evm.every(a => a.address.toLowerCase() === current)) return
  restoreQuietly(wallet, [...new Set([...accounts.map(a => a.network), ...(kept?.chains ?? [])])])
}

// A wallet that was locked or not injected yet at load is retried when the user comes back to the tab
// (after unlocking it in the extension), silently and only once it reports an authorized account.
export function retryKeptWallets() {
  if (!useWalletStore.getState().hasHydrated) return
  syncEvmAccountWatch(useWalletStore.getState().accounts)
  for (const [wallet, link] of keptLinks) {
    if (connecting.has(wallet)) continue
    void hasAuthorizedAccount(wallet, link.chains).then(ok => {
      if (ok && keptLinks.get(wallet) === link) restoreQuietly(wallet, link.chains)
    })
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', retryKeptWallets)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryKeptWallets()
  })
}
