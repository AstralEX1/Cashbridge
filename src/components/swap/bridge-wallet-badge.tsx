'use client'

import { useEffect, useState } from 'react'
import { Chain, getExplorerAddressUrl } from '@tcswap/core'
import { Check, Copy, ExternalLink, LoaderCircle, Wallet, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/lib/toast'
import { useBchWallet } from '@/components/bch-wallet'
import { ConnectWallet } from '@/components/connect-wallet/connect-wallet'
import { useDialog } from '@/components/global-dialog'
import { Tooltip } from '@/components/tooltip'
import { useAssetFrom } from '@/hooks/use-swap'
import { useConnectedAccount, useDisconnect, useHasHydrated, useSetExternalWalletMode } from '@/hooks/use-wallets'
import { useSwapStore } from '@/store/swap-store'

export const shortBridgeAddress = (address: string) => {
  const display = address.startsWith('bitcoincash:') ? address.slice('bitcoincash:'.length) : address
  return display.length > 14 ? `${display.slice(0, 6)}…${display.slice(-4)}` : display
}

// The wallet of one side of the form: the other chain's wallet ('other') or the BCH wallet ('bch').
export const BridgeWalletBadge = ({ kind }: { kind: 'other' | 'bch' }) => {
  const side = kind === 'other' ? 'from' : 'to'
  const reverse = useSwapStore(state => state.reverse)
  const t = useTranslations('bridge.wallet')
  const assetFrom = useAssetFrom()
  const account = useConnectedAccount(assetFrom?.chain)
  const disconnectSource = useDisconnect()
  const hasHydrated = useHasHydrated()
  const setExternalWalletMode = useSetExternalWalletMode()
  const { openDialog } = useDialog()
  const bch = useBchWallet()
  const address = side === 'from' ? (assetFrom ? account?.address : undefined) : bch.binding?.cashAddress
  const chain = side === 'from' ? assetFrom?.chain : Chain.BitcoinCash

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

  return (
    <WalletAddressBadge
      address={address}
      chain={chain}
      label={t(side === 'from' ? (reverse ? 'payout' : 'source') : 'destination')}
      onDisconnect={() => {
        if (side === 'from' && account) disconnectSource(account.provider)
        else if (side === 'to') void bch.disconnect()
      }}
    />
  )
}

// A wallet address as a pill: the green dot and short address, with Copy, View in explorer and,
// when `onDisconnect` is given, Disconnect sliding out on hover or focus (always shown on touch).
// The progress screen passes no `onDisconnect`: a running operation's wallets stay as recorded.
export const WalletAddressBadge = ({
  address,
  chain,
  label,
  showChainIcon = false,
  onDisconnect
}: {
  address: string
  chain: Chain
  label: string
  showChainIcon?: boolean
  onDisconnect?: () => void
}) => {
  const t = useTranslations('bridge.wallet')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  return (
    <div className="bridge-wallet-badge" role="group" tabIndex={0} aria-label={`${label}: ${address}`}>
      {showChainIcon ? (
        <img className="bridge-wallet-chain" src={`/networks/${chain.toLowerCase()}.svg`} width={18} height={18} alt="" />
      ) : (
        <span className="bridge-wallet-dot" aria-hidden="true" />
      )}
      <span title={address}>{shortBridgeAddress(address)}</span>
      <div className="bridge-wallet-actions">
        <div className="bridge-wallet-actions-inner">
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
          {onDisconnect && (
            <Tooltip content={t('disconnect')}>
              <button type="button" aria-label={t('disconnect')} onClick={onDisconnect}>
                <X size={17} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
