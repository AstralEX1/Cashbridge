'use client'

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/tooltip'
import { useBchWallet } from '@/components/bch-wallet'
import { useAutomaticBridge } from '@/hooks/use-automatic-bridge'
import { automaticPreference } from '@/store/auto-bridge-store'
import { addressToLockingBytecode } from '@/lib/bch'

// Cashbridge Router: on, the service executes the BCH-to-PUSD step (and plain BCH runs as before);
// off, every step is signed in the user's own wallets. The switch keeps its position on plain BCH.
export const RouterToggle = () => {
  const t = useTranslations('automatic')
  const id = useId()
  const { routerAvailable, routerOn } = useAutomaticBridge()
  const setMode = automaticPreference(state => state.setMode)
  return (
    <Tooltip content={t(routerAvailable ? 'routerTip' : 'routerUnavailable')}>
      <div className="bridge-router" data-disabled={!routerAvailable || undefined}>
        <label htmlFor={id}>{t('router')}</label>
        <button
          id={id}
          type="button"
          role="switch"
          className="bridge-switch"
          aria-checked={routerOn}
          aria-describedby={`${id}-tip`}
          disabled={!routerAvailable}
          onClick={() => setMode(routerOn ? 'manual' : 'automatic')}
        >
          <span aria-hidden="true" />
        </button>
        <span id={`${id}-tip`} className="sr-only">
          {t(routerAvailable ? 'routerTip' : 'routerUnavailable')}
        </span>
      </div>
    </Tooltip>
  )
}

// Under the BCH wallet badge: the router routes can pay a pasted address instead of the wallet.
export const DestinationAddressInput = () => {
  const t = useTranslations('automatic')
  const id = useId()
  const { pasteAllowed, automatic } = useAutomaticBridge()
  const value = automaticPreference(state => state.recipient)
  const setRecipient = automaticPreference(state => state.setRecipient)
  const wallet = useBchWallet()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (value.trim()) setOpen(true)
  }, [value])
  if (!pasteAllowed) return null
  if (!open)
    return (
      <div className="bridge-paste-row">
        <button type="button" className="bridge-paste-link" onClick={() => setOpen(true)}>
          {t(wallet.binding ? 'otherAddress' : 'pasteInstead')}
        </button>
      </div>
    )
  const close = () => {
    setRecipient('')
    setOpen(false)
  }
  return (
    <div className="bridge-auto-recipient">
      <label htmlFor={id}>{t(automatic ? 'recipient' : 'recipientBch')}</label>
      <div className="bridge-paste-field">
        <Input
          id={id}
          value={value}
          onChange={event => setRecipient(event.target.value)}
          placeholder={wallet.binding?.cashAddress || 'bitcoincash:…'}
          autoComplete="off"
          spellCheck={false}
          autoFocus={!value}
          aria-invalid={!!value.trim() && !addressToLockingBytecode(value.trim())}
        />
        <button type="button" className="bridge-paste-clear" aria-label={t(wallet.binding ? 'useWallet' : 'clearAddress')} title={t(wallet.binding ? 'useWallet' : 'clearAddress')} onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="bridge-input-meta">{t(automatic ? (wallet.binding ? 'connectedRecipient' : 'pasteRecipient') : 'pasteRecipientBch')}</p>
    </div>
  )
}
