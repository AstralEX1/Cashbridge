import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { GenericButton } from '@/components/generic-button'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { resumeNetworkSwap } from '@/lib/network-swap'
import { readableError } from '@/lib/errors'
import { type SwapTransaction, transactionStore } from '@/store/transaction-store'

export const NetworkSwapRecovery = ({ tx }: { tx: SwapTransaction }) => {
  const t = useTranslations('tx')
  const [hash, setHash] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resume = async () => {
    setBusy(true)
    setError('')
    try { await resumeNetworkSwap(tx, hash) }
    catch (failure) { setError(readableError(failure, t('networkRecovery.failed'))) }
    finally { setBusy(false) }
  }
  return <div className="mt-3 space-y-3 border-t pt-3 text-xs">
    <p>{t('networkRecovery.intro')}</p>
    <Input aria-label={t('networkRecovery.hash')} placeholder={t('networkRecovery.hash')} value={hash} onChange={event => setHash(event.target.value)} />
    <GenericButton size="small" disabled={!hash.trim() || busy} onClick={resume}>{t('networkRecovery.track')}</GenericButton>
    {error && <p role="alert">{error}</p>}
    <SwapAddressWarning checked={checked} onCheckedChange={setChecked} text={t('networkRecovery.acknowledgement')} />
    <GenericButton size="small" disabled={!checked || busy} onClick={() => {
      const current = transactionStore.getState().transactions.find(item => item.uid === tx.uid)
      if (checked && current?.kind !== 'send' && current?.networkSwap && current.status === 'unknown' && !current.hash) {
        transactionStore.getState().removeTransaction(tx.uid)
      }
    }}>{t('networkRecovery.clear')}</GenericButton>
  </div>
}
