'use client'

import type { ReactNode } from 'react'

export type TxToastStatus = 'loading' | 'success' | 'error' | 'warning' | 'info'

export interface TxToastCardProps {
  status: TxToastStatus
  title: ReactNode
  description?: ReactNode
  // The token's artwork: the pending ring turns around it, and a check badge lands on it when done.
  icon?: ReactNode
  actionLabel?: string
  actionHref?: string
  dismissLabel?: string
  onDismiss?: () => void
  // Plays the exit animation; the owner unmounts the card afterwards.
  leaving?: boolean
}

const Check = () => (
  <svg viewBox="0 0 12 12" fill="none" strokeWidth="2" aria-hidden="true">
    <path className="tx-toast-check" d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const Glyph = ({ status }: { status: TxToastStatus }) => (
  <span aria-hidden="true" className={`tx-toast-icon is-${status}`}>
    {status === 'loading' && (
      <svg viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="rgba(132,224,247,0.25)" strokeWidth="2" />
        <path d="M17 10a7 7 0 0 0-7-7" stroke="#84E0F7" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )}
    {status === 'success' && (
      <>
        <Check />
        <span className="tx-toast-burst" />
      </>
    )}
    {status === 'error' && (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 3 1.5 21h21L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 10v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="18" r="1" fill="currentColor" />
      </svg>
    )}
    {status === 'warning' && <b>!</b>}
    {status === 'info' && <b>i</b>}
  </span>
)

const TokenRing = ({ done, children }: { done: boolean; children: ReactNode }) => (
  <span aria-hidden="true" className="tx-toast-ring">
    <svg className={done ? undefined : 'tx-toast-spinner'} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="18" stroke={done ? 'rgba(60,200,140,0.35)' : 'rgba(132,224,247,0.18)'} strokeWidth="2" />
      {!done && <path d="M38 20a18 18 0 0 0-18-18" stroke="#84E0F7" strokeWidth="2" strokeLinecap="round" />}
    </svg>
    <span className="tx-toast-token">{children}</span>
    {done && (
      <>
        <span className="tx-toast-badge">
          <Check />
        </span>
        <span className="tx-toast-burst" />
      </>
    )}
  </span>
)

export const TxToastCard = ({ status, title, description, icon, actionLabel, actionHref, dismissLabel, onDismiss, leaving }: TxToastCardProps) => (
  <div
    role={status === 'error' ? 'alert' : 'status'}
    className={`tx-toast${status === 'error' ? ' is-error' : ''}${leaving ? ' is-leaving' : ''}`}
  >
    {icon && (status === 'loading' || status === 'success') ? (
      <TokenRing done={status === 'success'}>{icon}</TokenRing>
    ) : (
      <Glyph status={status} />
    )}
    <div className="tx-toast-body">
      <p className="tx-toast-title">{title}</p>
      {description && <p className="tx-toast-description">{description}</p>}
      {actionLabel && actionHref && (
        <a className="tx-toast-action" href={actionHref} target="_blank" rel="noopener noreferrer">
          {actionLabel}
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </div>
    {onDismiss && (
      <button type="button" className="tx-toast-dismiss" aria-label={dismissLabel} onClick={onDismiss}>
        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    )}
  </div>
)
