'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { useBchWallet } from '@/components/bch-wallet'
import { useAutomaticBridge } from '@/hooks/use-automatic-bridge'
import { automaticPreference } from '@/store/auto-bridge-store'
import { addressToLockingBytecode } from '@/lib/bch'

export const AutomaticModeSelector = () => {
  const t = useTranslations('automatic')
  const { eligible, automatic } = useAutomaticBridge()
  const setMode = automaticPreference(state => state.setMode)
  return <div className="bridge-auto-mode">
    <div role="group" aria-label={t('execution')} className="bridge-auto-options">
      <button type="button" aria-pressed={!automatic} onClick={() => setMode('manual')}>{t('manual')}</button>
      <button type="button" aria-pressed={automatic} disabled={!eligible} onClick={() => setMode('automatic')}>{t('automatic')}</button>
    </div>
    <p className="bridge-input-meta">{t(eligible ? automatic ? 'automaticHint' : 'manualHint' : 'unsupported')}</p>
  </div>
}

export const AutomaticRecipientInput = () => {
  const t = useTranslations('automatic')
  const id = useId()
  const { automatic } = useAutomaticBridge()
  const value = automaticPreference(state => state.recipient)
  const setRecipient = automaticPreference(state => state.setRecipient)
  const wallet = useBchWallet()
  if (!automatic) return null
  return <div className="bridge-auto-recipient">
    <label htmlFor={id}>{t('recipient')}</label>
    <Input id={id} value={value} onChange={event => setRecipient(event.target.value)}
      placeholder={wallet.binding?.tokenAddress || 'bitcoincash:…'} autoComplete="off" spellCheck={false}
      aria-invalid={!!value.trim() && !addressToLockingBytecode(value.trim())} />
    <p className="bridge-input-meta">{t(wallet.binding ? 'connectedRecipient' : 'pasteRecipient')}</p>
  </div>
}
