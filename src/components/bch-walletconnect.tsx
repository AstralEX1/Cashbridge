'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type SignClient from '@walletconnect/sign-client'
import type { SessionTypes } from '@walletconnect/types'
import { AppConfig, BridgeConfig } from '@/config'
import { type BchBinding, isValidBinding } from '@/lib/bch'
import type { BchSigner } from '@/lib/bch-signing'
import { firstP2pkhAddress, proveWalletConnectKey, sessionAddress, WC_BCH_CHAIN, WC_BCH_EVENTS, WC_BCH_METHODS, walletConnectSigner } from '@/lib/bch-walletconnect'

// BCH wallets over WalletConnect v2 (Paytaca, Cashonize, Zapit). The SignClient keeps its own
// session store; this app keeps a marker with the session topic and the binding proven for it, so a
// visitor without a WalletConnect session never opens a relay socket, and a returning one is
// connected again on load without a new signature (as WizardConnect's session resumes).

export const WALLETCONNECT_SESSION_KEY = 'tc-bch-walletconnect'

// 'verifying': the session is approved and the wallet is asked to sign the key-proof message.
export type WalletConnectState = 'idle' | 'connecting' | 'verifying' | 'connected'

interface SavedSession {
  topic: string
  binding: BchBinding
}

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

const USER_DISCONNECTED = { code: 6000, message: 'User disconnected' }

export const walletConnectEnabled = () => !!BridgeConfig.walletConnectProjectId

export function useBchWalletConnect() {
  const client = useRef<Promise<SignClient> | null>(null)
  const [session, setSession] = useState<SessionTypes.Struct | null>(null)
  const [binding, setBinding] = useState<BchBinding>()
  const [state, setState] = useState<WalletConnectState>('idle')
  const [uri, setUri] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  // Bumped by every connect or disconnect: a pairing or proof that finishes after it is stale.
  const attempt = useRef(0)
  // An approved session still waiting for its key proof, so closing the dialog can end it too.
  const pending = useRef<string | undefined>(undefined)

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
        writeMarker({ topic: live.topic, binding: proven })
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
      })
      .catch(() => {
        if (run === attempt.current) reset()
      })
  }, [bind, getClient, reset])

  const connect = useCallback(async () => {
    const run = ++attempt.current
    setError(null)
    setState('connecting')
    try {
      const instance = await getClient()
      const { uri: pairing, approval } = await instance.connect({
        optionalNamespaces: { bch: { chains: [WC_BCH_CHAIN], methods: [...WC_BCH_METHODS], events: [...WC_BCH_EVENTS] } }
      })
      if (run !== attempt.current) return
      setUri(pairing)
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
      await bind(instance, live, address, run)
    } catch (e) {
      if (run !== attempt.current) return
      reset()
      const message = e instanceof Error ? e.message : (e as { message?: string } | null)?.message
      // A pairing link is valid for five minutes; WalletConnect's own wording is just "Proposal expired".
      setError(message && /expired/i.test(message) ? 'The WalletConnect link expired. Connect again for a new QR code.' : message || 'Could not connect the wallet')
    }
  }, [bind, getClient, reset])

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
    void getClient().then(instance => {
      if (current) setSigner(walletConnectSigner(instance, session.topic))
    })
    return () => {
      current = false
    }
  }, [session, state, getClient])

  const clearError = useCallback(() => setError(null), [])

  return {
    state,
    uri,
    error,
    clearError,
    binding: state === 'connected' ? binding : undefined,
    signer,
    walletName: session?.peer.metadata.name ?? null,
    connect,
    disconnect
  }
}
