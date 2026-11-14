'use client'

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react'
import type { DappConnectionManager } from '@wizardconnect/dapp'
import { AppConfig } from '@/config'
import { type BchBinding, BINDING_PATHS, type BindingPath, bindingFromPubkey, isValidBinding } from '@/lib/bch'
import { useActiveBridge } from '@/store/transaction-store'

// The user's own BCH wallet, connected over WizardConnect. It receives the first leg's BCH and
// signs the second leg. The public binding (key, path, index, addresses) is remembered in
// localStorage. The relay session stays remembered until the user disconnects or pairs again.
// A restored connection is still checked to be the same key.

const RECEIVE_INDEX = 0
const STORAGE_KEY = 'tc-bch-binding'
const SESSION_KEY = 'tc-bch-wizardconnect'
const SESSION_BACKUP_KEY = `${SESSION_KEY}-reconnect`
// A restored session waits for the wallet app to come back online; after this the user is offered
// a fresh QR pairing instead of an endless spinner.
const RECONNECT_PATIENCE_MS = 15_000

// The SDK's opaque relay session stays in the browser, never in our backend. Remembering it
// permits reconnection; signing still requires approval in the wallet.
export const browserSessionStorage = {
  getItem: (key: string) => {
    try {
      const saved = window.localStorage.getItem(key)
      if (saved) return saved
    } catch {
      // Fall back to the current tab.
    }
    try {
      const saved = window.sessionStorage.getItem(key)
      // Carry an existing tab-only connection over to the persistent browser session.
      if (saved) {
        try {
          window.localStorage.setItem(key, saved)
        } catch {
          // The tab's copy can still resume on reload.
        }
      }
      return saved
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string) => {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // Storage unavailable (private mode, quota): the session is simply not restored.
    }
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The tab's copy can still resume on reload.
    }
  },
  removeItem: (key: string) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Storage unavailable.
    }
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      // Nothing was stored.
    }
  }
}

// WizardConnect clears its stored credentials after a remote disconnect. Preserve one copy so a
// network handoff can resume the same pairing; explicit disconnect and re-pair remove both copies.
const wizardConnectStorage = {
  getItem: (key: string) => {
    const saved = browserSessionStorage.getItem(key)
    if (saved || key !== SESSION_KEY) return saved
    try {
      const backup = window.localStorage.getItem(SESSION_BACKUP_KEY)
      if (backup) {
        browserSessionStorage.setItem(key, backup)
        window.localStorage.removeItem(SESSION_BACKUP_KEY)
      }
      return backup
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string) => {
    browserSessionStorage.setItem(key, value)
    if (key === SESSION_KEY) {
      try {
        window.localStorage.removeItem(SESSION_BACKUP_KEY)
      } catch {
        // The active session is already saved.
      }
    }
  },
  removeItem: (key: string) => {
    if (key === SESSION_KEY) {
      try {
        const saved = browserSessionStorage.getItem(key)
        if (saved) window.localStorage.setItem(SESSION_BACKUP_KEY, saved)
      } catch {
        // The session can still be restored from the primary storage if available.
      }
    }
    browserSessionStorage.removeItem(key)
  }
}

const clearWizardConnectSession = () => {
  browserSessionStorage.removeItem(SESSION_KEY)
  try {
    window.localStorage.removeItem(SESSION_BACKUP_KEY)
  } catch {
    // Storage unavailable.
  }
}

interface SavedBinding {
  binding: BchBinding
  walletName?: string
}

const readSaved = (): SavedBinding | undefined => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedBinding | null
    return saved && isValidBinding(saved.binding) ? saved : undefined
  } catch {
    return undefined
  }
}

const writeSaved = (saved?: SavedBinding) => {
  try {
    if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the binding then lasts for this page only.
  }
}

interface BchWalletContextValue {
  state: ReturnType<typeof useWizardConnect>['state']
  walletName: string | null
  manager: DappConnectionManager | null
  // The connected wallet's binding, set only while connected and matching what is required.
  binding?: BchBinding
  // What an active operation is bound to: only that wallet may connect while it runs.
  expected?: BchBinding
  // The last wallet connected, shown while disconnected. Any wallet may replace it when no
  // operation is active.
  remembered?: BchBinding
  // Connected, but the wallet derives a different key than the one required.
  mismatch: boolean
  error: string | null
  // A stored session is being resumed (no QR), and whether that has taken too long.
  reconnecting: boolean
  reconnectStalled: boolean
  connect: () => void
  // Drops the stored session and starts a new QR pairing.
  pairAgain: () => void
  disconnect: () => Promise<void>
  forget: () => void
}

const BchWalletContext = createContext<BchWalletContextValue | undefined>(undefined)

export function BchWalletProvider({ children }: { children: ReactNode }) {
  const [sessionGeneration, setSessionGeneration] = useState(0)
  const restoreAttempted = useRef(false)
  const onConnected = useCallback(() => {
    restoreAttempted.current = false
  }, [])
  const onRemoteDisconnect = useCallback(() => {
    // shortcut: retry once per successful session; persistent failures need a fresh QR pairing.
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    setSessionGeneration(generation => generation + 1)
  }, [])

  return (
    <BchWalletSession
      key={sessionGeneration}
      onConnected={onConnected}
      onRemoteDisconnect={onRemoteDisconnect}
    >
      {children}
    </BchWalletSession>
  )
}

function BchWalletSession({
  children,
  onConnected,
  onRemoteDisconnect
}: {
  children: ReactNode
  onConnected: () => void
  onRemoteDisconnect: () => void
}) {
  const wc = useWizardConnect({ dappName: AppConfig.appName, persistSession: true, sessionKey: SESSION_KEY, storage: wizardConnectStorage })
  const activeBridge = useActiveBridge()
  const [saved, setSaved] = useState<SavedBinding | undefined>()
  const [derived, setDerived] = useState<BchBinding | undefined>()
  const [deriveError, setDeriveError] = useState<string | null>(null)

  useEffect(() => setSaved(readSaved()), [])

  // An active operation is bound to the address its BCH was sent to; nothing else may sign for it.
  const expected = activeBridge?.bridge.binding

  // Every wallet_ready (also after a wallet reconnects) can bring new paths, so derivation reruns on
  // each. What the wallet announced is kept for the error message: names only, never the secret.
  const [walletReady, setWalletReady] = useState<{ count: number; summary: string }>({ count: 0, summary: '' })
  useEffect(() => {
    const manager = wc.manager
    if (!manager) return
    const onReady = (msg: { wallet_name?: string; supported_protocols?: string[]; session?: Record<string, unknown> }) => {
      const sessions = Object.entries(msg.session ?? {}).map(([protocol, data]) => {
        const paths = (data as { paths?: { name?: unknown }[] } | null)?.paths
        return `${protocol}: ${Array.isArray(paths) ? paths.map(p => String(p?.name)).join(', ') || 'no paths' : 'no path list'}`
      })
      const summary = `wallet ${msg.wallet_name ?? '?'}, protocols ${(msg.supported_protocols ?? []).join(', ') || 'none'}, session ${sessions.join('; ') || 'empty'}`
      setWalletReady(prev => ({ count: prev.count + 1, summary }))
    }
    manager.on('walletready', onReady)
    return () => {
      manager.off('walletready', onReady)
    }
  }, [wc.manager])

  useEffect(() => {
    if (wc.state !== 'connected' || !wc.manager) {
      setDerived(undefined)
      setDeriveError(null)
      return
    }
    try {
      const index = expected?.addressIndex ?? RECEIVE_INDEX
      // A bound operation keeps its path; otherwise prefer the receive path, then the DeFi path.
      const candidates: BindingPath[] = expected ? [expected.path] : ['receive', 'defi']
      const path = candidates.find(p => wc.manager!.hasPath(BINDING_PATHS[p]))
      const pubkey = path && wc.manager.getPubkey(BINDING_PATHS[path], BigInt(index))
      if (!path || !pubkey) {
        const shared = wc.manager.getSessionPaths().map(p => p.name)
        throw new Error(
          `The wallet did not share a ${candidates.join(' or ')} path (shared: ${shared.join(', ') || 'none'}; ${walletReady.summary || 'no wallet_ready seen'})`
        )
      }
      setDerived(bindingFromPubkey(pubkey, index, path))
      setDeriveError(null)
    } catch (error) {
      setDerived(undefined)
      setDeriveError(error instanceof Error ? error.message : 'Could not derive the BCH address')
    }
  }, [wc.state, wc.manager, wc.walletName, walletReady, expected?.addressIndex, expected?.path])

  const mismatch = !!derived && !!expected && derived.pubkey !== expected.pubkey
  const binding = wc.state === 'connected' && derived && !mismatch ? derived : undefined

  // Remember the last wallet connected (public data only). While an operation runs only its own
  // wallet derives a matching binding, so the remembered one cannot drift from it.
  useEffect(() => {
    if (!derived || (expected && derived.pubkey !== expected.pubkey)) return
    if (saved?.binding.pubkey === derived.pubkey && saved.walletName === (wc.walletName ?? undefined)) return
    const next = { binding: derived, walletName: wc.walletName ?? undefined }
    writeSaved(next)
    setSaved(next)
  }, [derived, expected, saved, wc.walletName])

  const forget = useCallback(() => {
    if (activeBridge) return
    writeSaved(undefined)
    setSaved(undefined)
  }, [activeBridge])

  const connect = useCallback(() => {
    if (wc.state === 'disconnected') clearWizardConnectSession()
    wc.connect()
  }, [wc])

  const disconnect = useCallback(async () => {
    try {
      await wc.disconnect()
    } finally {
      clearWizardConnectSession()
    }
  }, [wc.disconnect])

  useEffect(() => {
    if (wc.state === 'connected') onConnected()
    if (wc.state === 'disconnected' && wizardConnectStorage.getItem(SESSION_KEY)) onRemoteDisconnect()
  }, [wc.state, onConnected, onRemoteDisconnect])

  // Resuming a stored session shows no QR (the hook only exposes one for a new pairing) and stays
  // 'connecting' until the wallet answers, which it does only while its app is open.
  const reconnecting = (wc.state === 'connecting' && !wc.uri) || wc.state === 'reconnecting'
  const [reconnectStalled, setReconnectStalled] = useState(false)
  useEffect(() => {
    setReconnectStalled(false)
    if (!reconnecting) return
    const timer = setTimeout(() => setReconnectStalled(true), RECONNECT_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [reconnecting])

  // The hook ignores connect() while a relay is open, so pairing again waits for the disconnect
  // to land ('idle') before starting the new one.
  const [pairPending, setPairPending] = useState(false)
  const pairAgain = useCallback(() => {
    setPairPending(true)
    void disconnect()
  }, [disconnect])
  useEffect(() => {
    if (!pairPending || wc.state !== 'idle') return
    setPairPending(false)
    wc.connect()
  }, [pairPending, wc])

  const value = useMemo<BchWalletContextValue>(
    () => ({
      state: wc.state,
      walletName: wc.walletName ?? saved?.walletName ?? null,
      manager: wc.manager,
      binding,
      expected,
      remembered: saved?.binding,
      mismatch,
      error: wc.error ?? deriveError,
      reconnecting,
      reconnectStalled,
      connect,
      pairAgain,
      disconnect,
      forget
    }),
    [
      wc.state,
      wc.walletName,
      wc.manager,
      wc.error,
      disconnect,
      saved,
      binding,
      expected,
      mismatch,
      deriveError,
      reconnecting,
      reconnectStalled,
      connect,
      pairAgain,
      forget
    ]
  )

  return (
    <BchWalletContext.Provider value={value}>
      {children}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog
          show={wc.state === 'connecting'}
          onClose={() => disconnect()}
          uri={wc.uri}
          qrUri={wc.qrUri}
          title="Connect your BCH wallet"
          subtitle="Scan with a WizardConnect wallet. It receives the BCH and signs the PUSD swap."
        />
      )}
    </BchWalletContext.Provider>
  )
}

const noopSubscribe = () => () => {}

// The provider resumes a stored session and reads saved bindings in effects, which can run before
// a component inside a Suspense boundary hydrates. Until that component has hydrated it sees what
// the server rendered (no wallet), so the first client render matches the HTML.
const useHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )

export const useBchWallet = (): BchWalletContextValue => {
  const context = useContext(BchWalletContext)
  const hydrated = useHydrated()
  if (!context) throw new Error('useBchWallet must be used inside BchWalletProvider')
  if (hydrated) return context
  return {
    ...context,
    state: 'idle',
    walletName: null,
    manager: null,
    binding: undefined,
    expected: undefined,
    remembered: undefined,
    mismatch: false,
    error: null,
    reconnecting: false,
    reconnectStalled: false
  }
}
