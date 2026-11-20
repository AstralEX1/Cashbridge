'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type SignClient from '@walletconnect/sign-client'
import type { SessionTypes } from '@walletconnect/types'
import { AppConfig, BridgeConfig } from '@/config'
import { type BchBinding, isValidBinding } from '@/lib/bch'
import type { BchSigner } from '@/lib/bch-signing'
import {
  cashonizeWalletConnectUrl,
  firstP2pkhAddress,
  PAYTACA_EXTENSION_ID,
  paytacaExtensionUrl,
  proveWalletConnectKey,
  sessionAddress,
  WC_BCH_CHAIN,
  WC_BCH_EVENTS,
  WC_BCH_METHODS,
  walletConnectSigner,
  ZAPIT_EXTENSION_ID,
  zapitExtensionUrl
} from '@/lib/bch-walletconnect'

// BCH wallets over WalletConnect v2 (Paytaca, Cashonize, Zapit). The SignClient keeps its own
// session store; this app keeps a marker with the session topic and the binding proven for it, so a
// visitor without a WalletConnect session never opens a relay socket, and a returning one is
// connected again on load without a new signature (as WizardConnect's session resumes).

export const WALLETCONNECT_SESSION_KEY = 'tc-bch-walletconnect'

// 'verifying': the session is approved and the wallet is asked to sign the key-proof message.
export type WalletConnectState = 'idle' | 'connecting' | 'verifying' | 'connected'

// How the wallet is reached: a QR/link, a named browser wallet opened with the pairing URI, or a
// browser extension whose WalletConnect page pairs the URI (and is opened again for each request).
export type WalletConnectVia = 'walletconnect' | 'paytaca-extension' | 'cashonize' | 'zapit-extension'

interface SavedSession {
  topic: string
  binding: BchBinding
  via?: WalletConnectVia
}

const PAYTACA_WINDOW = 'paytaca-extension'
const ZAPIT_WINDOW = 'zapit-extension'
const CASHONIZE_WINDOW = 'cashonize-wallet'

const detectExtensionIcon = (src: string) =>
  new Promise<boolean>(resolve => {
    const probe = new Image()
    probe.onload = () => resolve(true)
    probe.onerror = () => resolve(false)
    probe.src = src
  })

// The extension's icons are web-accessible, so one loads only where it is installed (Chromium).
export const detectPaytacaExtension = () => detectExtensionIcon(`chrome-extension://${PAYTACA_EXTENSION_ID}/icons/icon-16x16.png`)

// Icon paths vary by Zapit build; any hit means the extension is installed.
export const detectZapitExtension = async () => {
  for (const path of [
    `chrome-extension://${ZAPIT_EXTENSION_ID}/icons/icon-128.png`,
    `chrome-extension://${ZAPIT_EXTENSION_ID}/icons/Icon-128.png`,
    `chrome-extension://${ZAPIT_EXTENSION_ID}/icon-128.png`
  ]) {
    if (await detectExtensionIcon(path)) return true
  }
  return false
}

const openWindow = (url: string, name: string) => {
  try {
    return !!window.open(url, name, 'popup,width=420,height=720')
  } catch {
    return false
  }
}

// Opens (or reuses) a small window on the extension's WalletConnect page. A popup blocker can refuse
// it outside a click; the dialog then offers a button that opens it.
export const openPaytacaExtension = (uri?: string) => openWindow(paytacaExtensionUrl(uri), PAYTACA_WINDOW)

export const openZapitExtension = (uri?: string) => openWindow(zapitExtensionUrl(uri), ZAPIT_WINDOW)

// Cashonize is a web wallet: open its WalletConnect route with the pairing URI (wc2-bch-bcr).
export const openCashonizeWallet = (uri?: string) => openWindow(cashonizeWalletConnectUrl(uri), CASHONIZE_WINDOW)

// Opens the WalletConnect surface for the chosen via (extension or Cashonize tab).
export const openWalletConnectVia = (via: WalletConnectVia, uri?: string) => {
  if (via === 'paytaca-extension') return openPaytacaExtension(uri)
  if (via === 'zapit-extension') return openZapitExtension(uri)
  if (via === 'cashonize') return openCashonizeWallet(uri)
  return false
}

export const walletConnectViaNeedsWindow = (via: WalletConnectVia) => via !== 'walletconnect'

const readMarker = (): SavedSession | undefined => {
  try {
    const saved = JSON.parse(localStorage.getItem(WALLETCONNECT_SESSION_KEY) ?? 'null') as SavedSession | null
    return saved && typeof saved.topic === 'string' && isValidBinding(saved.binding) && saved.binding.pubkey !== '' ? saved : undefined
  } catch {
    return undefined
  }
}

const writeMarker = (saved?: SavedSession) => {
  try {
    if (saved) localStorage.setItem(WALLETCONNECT_SESSION_KEY, JSON.stringify(saved))
    else localStorage.removeItem(WALLETCONNECT_SESSION_KEY)
  } catch {
    // Storage blocked: the session then lasts for this page only.
  }
}

export const hasWalletConnectSession = () => !!readMarker()

const SESSION_EXTEND_BELOW_MS = 3.5 * 24 * 60 * 60 * 1000

const USER_DISCONNECTED = { code: 6000, message: 'User disconnected' }

export const walletConnectEnabled = () => !!BridgeConfig.walletConnectProjectId

export function useBchWalletConnect() {
  const client = useRef<Promise<SignClient> | null>(null)
  const [session, setSession] = useState<SessionTypes.Struct | null>(null)
  const [binding, setBinding] = useState<BchBinding>()
  const [state, setState] = useState<WalletConnectState>('idle')
  const [uri, setUri] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [via, setVia] = useState<WalletConnectVia>('walletconnect')
  // Bumped by every connect or disconnect: a pairing or proof that finishes after it is stale.
  const attempt = useRef(0)
  // An approved session still waiting for its key proof, so closing the dialog can end it too.
  const pending = useRef<string | undefined>(undefined)
  const viaRef = useRef<WalletConnectVia>('walletconnect')
  const chooseVia = useCallback((next: WalletConnectVia) => {
    viaRef.current = next
    setVia(next)
  }, [])

  const reset = useCallback(() => {
    attempt.current++
    writeMarker(undefined)
    setSession(null)
    setBinding(undefined)
    setUri(undefined)
    setState('idle')
  }, [])

  const getClient = useCallback(() => {
    if (!client.current) {
      client.current = import('@walletconnect/sign-client').then(async ({ SignClient: Client }) => {
        const origin = window.location.origin
        const instance = await Client.init({
          projectId: BridgeConfig.walletConnectProjectId,
          metadata: { name: AppConfig.appName, description: AppConfig.description ?? AppConfig.appName, url: origin, icons: [`${origin}/icon.svg`] }
        })
        return instance
      })
      client.current.catch(() => {
        client.current = null
      })
    }
    return client.current
  }, [])

  // Proves the key behind the session's address and binds it. A wallet that declines leaves no
  // half-connected session behind.
  const bind = useCallback(
    async (instance: SignClient, live: SessionTypes.Struct, address: string, run: number) => {
      setState('verifying')
      pending.current = live.topic
      try {
        const proven = await proveWalletConnectKey(instance, live.topic, address, AppConfig.appName)
        if (run !== attempt.current) return
        writeMarker({ topic: live.topic, binding: proven, via: viaRef.current })
        setBinding(proven)
        setSession(live)
        setState('connected')
        setError(null)
      } catch (e) {
        if (run !== attempt.current) return
        reset()
        setError(e instanceof Error ? e.message : 'The wallet did not confirm its address')
        void instance.disconnect({ topic: live.topic, reason: USER_DISCONNECTED }).catch(() => {})
      }
    },
    [reset]
  )

  // Session events from the wallet: it ended the session, or switched to another address (which
  // needs its own proof, since the binding is per key).
  useEffect(() => {
    if (!session) return
    let instance: SignClient | undefined
    const onEnded = ({ topic }: { topic: string }) => {
      if (topic === session.topic) reset()
    }
    const onEvent = ({ topic, params }: { topic: string; params: { event: { name: string; data: unknown } } }) => {
      if (topic !== session.topic || params.event.name !== 'addressesChanged' || !instance) return
      const address = firstP2pkhAddress(params.event.data)
      if (address && address !== binding?.cashAddress) void bind(instance, session, address, ++attempt.current)
    }
    void getClient().then(c => {
      instance = c
      c.on('session_delete', onEnded)
      c.on('session_expire', onEnded)
      c.on('session_event', onEvent)
    })
    return () => {
      instance?.off('session_delete', onEnded)
      instance?.off('session_expire', onEnded)
      instance?.off('session_event', onEvent)
    }
  }, [session, binding?.cashAddress, bind, getClient, reset])

  // A remembered session is restored from the client's own store; one the wallet ended while the
  // page was closed is dropped.
  useEffect(() => {
    const saved = readMarker()
    if (!saved || !walletConnectEnabled()) return
    const run = ++attempt.current
    chooseVia(saved.via ?? 'walletconnect')
    setBinding(saved.binding)
    setState('connected')
    getClient()
      .then(instance => {
        if (run !== attempt.current) return
        const live = instance.session.getAll().find(s => s.topic === saved.topic && s.expiry * 1000 > Date.now())
        const address = live && sessionAddress(live.namespaces.bch?.accounts)
        if (!live || !address) return reset()
        if (address !== saved.binding.cashAddress) return void bind(instance, live, address, run)
        setSession(live)
        // WalletConnect sessions end after 7 days. Like a returning visit to any dApp, a visit past
        // the halfway mark slides it another 7 days, so a regular user never has to pair again.
        if (live.expiry * 1000 - Date.now() < SESSION_EXTEND_BELOW_MS) {
          void instance
            .extend({ topic: live.topic })
            .then(({ acknowledged }) => acknowledged())
            .catch(() => {})
        }
      })
      .catch(() => {
        // The client could not start (a stale chunk after a deploy, no network): the session itself
        // is fine, so the marker stays and the next load restores it instead of asking to pair again.
        if (run !== attempt.current) return
        setBinding(undefined)
        setState('idle')
      })
  }, [bind, getClient, reset, chooseVia])

  const connect = useCallback(async (how: WalletConnectVia = 'walletconnect') => {
    const run = ++attempt.current
    chooseVia(how)
    setError(null)
    setState('connecting')
    try {
      const instance = await getClient()
      const { uri: pairing, approval } = await instance.connect({
        optionalNamespaces: { bch: { chains: [WC_BCH_CHAIN], methods: [...WC_BCH_METHODS], events: [...WC_BCH_EVENTS] } }
      })
      if (run !== attempt.current) return
      setUri(pairing)
      if (pairing && walletConnectViaNeedsWindow(how)) openWalletConnectVia(how, pairing)
      const live = await approval()
      if (run !== attempt.current) {
        void instance.disconnect({ topic: live.topic, reason: USER_DISCONNECTED }).catch(() => {})
        return
      }
      setUri(undefined)
      const address = sessionAddress(live.namespaces.bch?.accounts)
      if (!address) {
        void instance.disconnect({ topic: live.topic, reason: USER_DISCONNECTED }).catch(() => {})
        throw new Error('The wallet shared no Bitcoin Cash mainnet address')
      }
      // The methods are only optional in the proposal, so a wallet may approve without signing; every transfer needs it.
      if (!live.namespaces.bch?.methods?.includes('bch_signTransaction')) {
        void instance.disconnect({ topic: live.topic, reason: USER_DISCONNECTED }).catch(() => {})
        throw new Error('The wallet did not allow transaction signing for this site')
      }
      await bind(instance, live, address, run)
    } catch (e) {
      if (run !== attempt.current) return
      reset()
      const message = e instanceof Error ? e.message : (e as { message?: string } | null)?.message
      // A pairing link is valid for five minutes; WalletConnect's own wording is just "Proposal expired".
      setError(message && /expired/i.test(message) ? 'The WalletConnect link expired. Connect again for a new QR code.' : message || 'Could not connect the wallet')
    }
  }, [bind, getClient, reset, chooseVia])

  // Also closes a pairing in progress (the QR dialog's close button).
  const disconnect = useCallback(async () => {
    const topic = session?.topic ?? pending.current ?? readMarker()?.topic
    pending.current = undefined
    reset()
    setError(null)
    if (!topic || !client.current) return
    const instance = await client.current.catch(() => undefined)
    await instance?.disconnect({ topic, reason: USER_DISCONNECTED }).catch(() => {})
  }, [session, reset])

  const [signer, setSigner] = useState<BchSigner | null>(null)
  useEffect(() => {
    if (!session || state !== 'connected') return setSigner(null)
    let current = true
    const topic = session.topic
    void getClient().then(instance => {
      if (!current) return
      // The pre-sign check: the wallet may have ended or let the session expire while no event
      // reached this page (it was asleep, the relay was down). Then the connection is dropped, so the
      // badge offers a new one, instead of sending a request nobody receives.
      const isLive = () => {
        const alive = instance.session.getAll().some(s => s.topic === topic && s.expiry * 1000 > Date.now())
        if (!alive) reset()
        return alive
      }
      const beforeRequest = walletConnectViaNeedsWindow(via) ? () => void openWalletConnectVia(via) : undefined
      setSigner(walletConnectSigner(instance, topic, { isLive, beforeRequest }))
    })
    return () => {
      current = false
    }
  }, [session, state, via, getClient, reset])

  const clearError = useCallback(() => setError(null), [])

  return {
    state,
    uri,
    error,
    clearError,
    binding: state === 'connected' ? binding : undefined,
    signer,
    walletName: session?.peer.metadata.name ?? null,
    via,
    // Starts the client ahead of a pairing, so the pairing link (and the extension window, which a
    // browser opens only shortly after a click) follows the click quickly.
    prepare: getClient,
    connect,
    disconnect
  }
}
