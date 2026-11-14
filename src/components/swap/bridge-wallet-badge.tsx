'use client'

import { useEffect, useState } from 'react'
import { Chain, getExplorerAddressUrl } from '@tcswap/core'
import { Check, Copy, ExternalLink, LoaderCircle, Wallet, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useBchWallet } from '@/components/bch-wallet'
import { ConnectWallet } from '@/components/connect-wallet/connect-wallet'
import { useDialog } from '@/components/global-dialog'
import { Tooltip } from '@/components/tooltip'
import { useAssetFrom } from '@/hooks/use-swap'
import { useConnectedAccount, useDisconnect, useHasHydrated, useSetExternalWalletMode } from '@/hooks/use-wallets'

export const shortBridgeAddress = (address: string) => {
  const display = address.startsWith('bitcoincash:') ? address.slice('bitcoincash:'.length) : address
  return display.length > 14 ? `${display.slice(0, 6)}…${display.slice(-4)}` : display
}

export const BridgeWalletBadge = ({ side }: { side: 'from' | 'to' }) => {
  const t = useTranslations('bridge.wallet')
  const assetFrom = useAssetFrom()
  const account = useConnectedAccount(assetFrom?.chain)
  const disconnectSource = useDisconnect()
  const hasHydrated = useHasHydrated()
  const setExternalWalletMode = useSetExternalWalletMode()
  const { openDialog } = useDialog()
  const bch = useBchWallet()
  const [copied, setCopied] = useState(false)
  const address = side === 'from' ? (assetFrom ? account?.address : undefined) : bch.binding?.cashAddress
  const chain = side === 'from' ? assetFrom?.chain : Chain.BitcoinCash

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  if (!chain) return null

  if (!address) {
    const connecting = side === 'from' ? !hasHydrated : bch.state === 'connecting' || bch.state === 'reconnecting'
    const retryBch = bch.reconnectStalled || bch.mismatch || bch.state === 'connected'
    return (
      <button
        type="button"
        className="bridge-wallet-badge bridge-wallet-connect"
        disabled={side === 'to' && connecting && !bch.reconnectStalled}
        onClick={() => {
          if (side === 'to') {
            if (retryBch) bch.pairAgain()
            else bch.connect()
          } else {
            setExternalWalletMode(false)
            openDialog(ConnectWallet, { chain })
          }
        }}
      >
        {connecting && !bch.reconnectStalled ? <LoaderCircle size={14} className="animate-spin" /> : <Wallet size={14} />}
        {t(connecting && !bch.reconnectStalled ? 'connecting' : side === 'from' ? 'connectSource' : 'connectDestination')}
      </button>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  return (
    <div className="bridge-wallet-badge" role="group" tabIndex={0} aria-label={`${t(side === 'from' ? 'source' : 'destination')}: ${address}`}>
      <span className="bridge-wallet-dot" aria-hidden="true" />
      <span title={address}>{shortBridgeAddress(address)}</span>
      <div className="bridge-wallet-actions">
        <Tooltip content={t('copy')}>
          <button type="button" aria-label={t('copy')} onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </Tooltip>
        <Tooltip content={t('explorer')}>
          <a aria-label={t('explorer')} href={getExplorerAddressUrl({ chain, address })} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} />
          </a>
        </Tooltip>
        <Tooltip content={t('disconnect')}>
          <button
            type="button"
            aria-label={t('disconnect')}
            onClick={() => {
              if (side === 'from' && account) disconnectSource(account.provider)
              else if (side === 'to') void bch.disconnect()
            }}
          >
            <X size={17} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
