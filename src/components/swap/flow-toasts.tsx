'use client'

import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { toast as sonner } from 'sonner'
import { Chain, getExplorerTxUrl } from '@tcswap/core'
import { shortBridgeAddress } from '@/components/swap/bridge-wallet-badge'
import { TxToastCard } from '@/components/tx-toast'
import { toast } from '@/lib/toast'

// How long a dismissed toast plays its exit before it leaves the list.
const LEAVE_MS = 220
// Phone width: the toasts sit in the page under the actions (see `.bridge-flow-toasts`) instead of over them.
const COMPACT = '(max-width: 520px)'

export interface FlowToast {
  id: string
  title: string
  hash: string
  chain: Chain
  time?: string
  // The token the ring turns around.
  icon?: ReactNode
  // Still waiting for the chain: the ring turns until the transaction is through.
  pending?: boolean
}

const useCompact = () =>
  useSyncExternalStore(
    notify => {
      const query = window.matchMedia(COMPACT)
      query.addEventListener('change', notify)
      return () => query.removeEventListener('change', notify)
    },
    () => window.matchMedia(COMPACT).matches,
    () => false
  )

// The transactions of the running operation as toasts in the corner of the progress screen. Wide screens put them in the site's
// toast stack, so they pile up with every other toast, open upwards on hover and close with the same button; a phone lists them.
export const FlowToasts = ({ toasts, onDismiss }: { toasts: FlowToast[]; onDismiss: (id: string) => void }) =>
  useCompact() ? <FlowToastList toasts={toasts} onDismiss={onDismiss} /> : <FlowToastStack toasts={toasts} onDismiss={onDismiss} />

const FlowToastStack = ({ toasts, onDismiss }: { toasts: FlowToast[]; onDismiss: (id: string) => void }) => {
  const t = useTranslations('bridge.progress')
  const shown = useRef(new Set<string>())
  const latest = useRef({ toasts, onDismiss, t })
  latest.current = { toasts, onDismiss, t }
  // The cards only change with these fields, and the owner builds a new array on every render.
  const signature = toasts.map(item => [item.id, item.pending ? 'pending' : 'done', item.title, item.hash].join('|')).join('\n')

  useEffect(() => {
    const { toasts: items, t: translate } = latest.current
    const next = new Set(items.map(item => item.id))
    const gone = [...shown.current].filter(id => !next.has(id))
    shown.current = next
    gone.forEach(id => sonner.dismiss(id))
    for (const item of items) {
      const options = {
        id: item.id,
        icon: item.icon,
        description: (
          <>
            {translate(item.pending ? 'toastPending' : 'toastDone')} · <span title={item.hash}>{shortBridgeAddress(item.hash)}</span>
          </>
        ),
        actionLabel: translate('viewExplorer'),
        actionHref: getExplorerTxUrl({ chain: item.chain, txHash: item.hash }),
        dismissLabel: translate('dismiss'),
        duration: Infinity,
        // Only a person's close reaches the owner; the dismissals above came from the owner already.
        onDismiss: () => {
          if (shown.current.delete(item.id)) latest.current.onDismiss(item.id)
        }
      }
      if (item.pending) toast.loading(item.title, options)
      else toast.success(item.title, options)
    }
  }, [signature])

  // Leaving the screen takes its toasts along. The check runs a tick later so a remount in between (strict mode) keeps them.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.setTimeout(() => {
        if (mounted.current) return
        const owned = [...shown.current]
        shown.current.clear()
        owned.forEach(id => sonner.dismiss(id))
      })
    }
  }, [])

  return null
}

const FlowToastList = ({ toasts, onDismiss }: { toasts: FlowToast[]; onDismiss: (id: string) => void }) => {
  const t = useTranslations('bridge.progress')
  const [leaving, setLeaving] = useState<string[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), [])

  if (toasts.length === 0) return null
  return (
    <ol className="bridge-flow-toasts" aria-label={t('transactions')}>
      {toasts.map(item => (
        <li key={item.id}>
          <TxToastCard
            status={item.pending ? 'loading' : 'success'}
            title={item.title}
            description={
              <>
                {t(item.pending ? 'toastPending' : 'toastDone')} · <span title={item.hash}>{shortBridgeAddress(item.hash)}</span>
              </>
            }
            icon={item.icon}
            actionLabel={t('viewExplorer')}
            actionHref={getExplorerTxUrl({ chain: item.chain, txHash: item.hash })}
            dismissLabel={t('dismiss')}
            leaving={leaving.includes(item.id)}
            onDismiss={() => {
              setLeaving(list => [...list, item.id])
              timers.current.push(window.setTimeout(() => onDismiss(item.id), LEAVE_MS))
            }}
          />
        </li>
      ))}
    </ol>
  )
}
