'use client'

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react'
import type { DappConnectionManager } from '@wizardconnect/dapp'
import { AppConfig } from '@/config'
import { type BchBinding, BINDING_PATHS, type BindingPath, bindingFromPubkey, isValidBinding } from '@/lib/bch'
import { useActiveBridge } from '@/store/transaction-store'

// The user's own BCH wallet, connected over WizardConnect. It receives the first leg's BCH and
// signs the second leg. The public binding (key, path, index, addresses) is remembered in
// localStorage. The relay session stays remembered until the user or the wallet disconnects.
// A restored connection is still checked to be the same key.

const RECEIVE_INDEX = 0
const STORAGE_KEY = 'tc-bch-binding'
// WizardConnect's default: useWizardConnect saves the relay session here in localStorage and
// resumes it on page load (loadSession + existingCredentials), as its docs describe.
export const SESSION_KEY = 'wizardconnect-session'
// Where this app kept the session before it used the library default. The "-reconnect" copy only
// outlived a session the wallet had ended, so it is dropped rather than restored.
const LEGACY_SESSION_KEY = 'tc-bch-wizardconnect'
const LEGACY_BACKUP_KEY = `${LEGACY_SESSION_KEY}-reconnect`
// A restored session waits for the wallet app to come back online; after this the user is offered
// a fresh QR pairing instead of an endless spinner.
const RECONNECT_PATIENCE_MS = 15_000

// Moves a session saved under the old keys to the library's key, then drops the old copies so one
// key is the only source of truth. Runs before the hook reads the session on mount.
export const migrateLegacyBchSession = () => {
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[area]
      const saved = storage.getItem(LEGACY_SESSION_KEY)
      if (saved && !window.localStorage.getItem(SESSION_KEY)) window.localStorage.setItem(SESSION_KEY, saved)
      storage.removeItem(LEGACY_SESSION_KEY)
      storage.removeItem(LEGACY_BACKUP_KEY)
    } catch {
      // Storage unavailable: there is nothing to restore.
    }
  }
}

export const clearBchSession = () => {
  try {
    window.localStorage.removeItem(SESSION_KEY)
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
  // Lazy state runs during this render, before the hook's mount effect reads the stored session.
  useState(migrateLegacyBchSession)
  const wc = useWizardConnect({ dappName: AppConfig.appName, persistSession: true, sessionKey: SESSION_KEY })
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

  // The hook leaves 'reconnecting' only on a new wallet_ready, and the manager stops pinging when it
  // enters it. Any relay socket drop (sleep, Wi-Fi, an idle relay) therefore stays 'reconnecting'
  // while the wallet answers fine. So pings restart on each 'reconnecting', and any message from the
  // wallet after it (a pong, a signature) counts as the wallet being reachable again.
  const [liveness, setLiveness] = useState({ seq: 0, lost: 0, heard: 0 })
  useEffect(() => {
    const manager = wc.manager
    if (!manager) return
    const onLost = () => setLiveness(prev => ({ ...prev, seq: prev.seq + 1, lost: prev.seq + 1 }))
    const onHeard = () => setLiveness(prev => ({ ...prev, seq: prev.seq + 1, heard: prev.seq + 1 }))
    manager.on('reconnecting', onLost)
    manager.on('messagereceived', onHeard)
    return () => {
      manager.off('reconnecting', onLost)
      manager.off('messagereceived', onHeard)
    }
  }, [wc.manager])
  useEffect(() => {
    if (wc.state !== 'reconnecting' || !wc.manager) return
    // Private in the typings: the manager's own keepalive, which pings only a discovered wallet and
    // emits 'reconnecting' again after 75 s of silence.
    ;(wc.manager as unknown as { startPingInterval?: () => void }).startPingInterval?.()
  }, [wc.state, wc.manager, liveness.lost])
  const state = wc.state === 'reconnecting' && liveness.heard > liveness.lost ? 'connected' : wc.state

  // WizardConnect closes the relay whenever the tab is hidden, which is exactly when the user turns to
  // the wallet to approve: a sign request still in flight fails with "relay connection closed by us"
  // although the wallet may already have it. While a session is open, the hidden transition is kept
  // from reaching document listeners (window capture runs first), so the relay stays up. A socket the
  // browser itself kills still goes through the library's reconnect loop. visibilityState is untouched.
  useEffect(() => {
    if (!wc.manager) return
    const keepRelay = (event: Event) => {
      if (document.visibilityState === 'hidden') event.stopImmediatePropagation()
    }
    window.addEventListener('visibilitychange', keepRelay, true)
    return () => window.removeEventListener('visibilitychange', keepRelay, true)
  }, [wc.manager])

  // 'reconnecting' keeps the binding: the manager still holds the wallet's xpubs, and a phone wallet
  // drops to it whenever its app is backgrounded (no pong for 75 s). Only signing needs it live.
  useEffect(() => {
    if ((wc.state !== 'connected' && wc.state !== 'reconnecting') || !wc.manager) {
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
  // While a stored session resumes after a reload (no QR, waiting for the wallet app to answer), the
  // address last derived from this wallet stands in, so a closed wallet app does not read as
  // disconnected. The live derivation replaces it, and the mismatch check still applies, once it answers.
  const resuming = wc.state === 'connecting' && !wc.uri
  const resumed = resuming && !derived && saved && (!expected || saved.binding.pubkey === expected.pubkey) ? saved.binding : undefined
  const live = (wc.state === 'connected' || wc.state === 'reconnecting') && derived && !mismatch ? derived : undefined
  const binding = live ?? resumed

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
    if (wc.state === 'disconnected') clearBchSession()
    wc.connect()
  }, [wc])

  // Documented order: clear the stored session, then the hook sends the wallet a disconnect and
  // tears down the relay.
  const disconnect = useCallback(async () => {
    clearBchSession()
    await wc.disconnect()
  }, [wc.disconnect])

  // The wallet ended the session: the hook already clears it; clearing here too keeps a
  // wallet-ended session from resuming on reload whatever the library version does.
  useEffect(() => {
    if (wc.state === 'disconnected') clearBchSession()
  }, [wc.state])

  // Resuming a stored session shows no QR (the hook only exposes one for a new pairing) and stays
  // 'connecting' until the wallet answers, which it does only while its app is open.
  const reconnecting = (wc.state === 'connecting' && !wc.uri) || state === 'reconnecting'
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
      state,
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
      state,
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
