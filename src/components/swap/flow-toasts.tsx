'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Chain, getExplorerTxUrl } from '@tcswap/core'
import { shortBridgeAddress } from '@/components/swap/bridge-wallet-badge'
import { TxToastCard } from '@/components/tx-toast'

// How long a dismissed toast plays its exit before it leaves the list.
const LEAVE_MS = 220

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

// The transactions of the running operation as toasts in the corner of the progress screen.
export const FlowToasts = ({ toasts, onDismiss }: { toasts: FlowToast[]; onDismiss: (id: string) => void }) => {
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
