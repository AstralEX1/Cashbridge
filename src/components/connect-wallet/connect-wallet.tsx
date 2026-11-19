import { useEffect, useMemo, useState } from 'react'
import { Chain, WalletOption } from '@tcswap/core'
import { Check, ChevronLeft, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Credenza, CredenzaContent, CredenzaHeader, CredenzaTitle } from '@/components/ui/credenza'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BrowserWallet } from '@/components/connect-wallet/browser-wallet'
import {
  ALL_CHAINS,
  chainLabel,
  COMING_SOON_CHAINS,
  describeWalletconnectError,
  isWalletAvailable,
  WalletParams,
  WALLETS,
  WalletType
} from '@/components/connect-wallet/config'
import { Ledger } from '@/components/connect-wallet/ledger'
import { Trezor } from '@/components/connect-wallet/trezor'
import { WalletIcon } from '@/components/wallet-icon'
import { useWallets } from '@/hooks/use-wallets'
import { isMobileBrowser, metaMaskAppLink } from '@/lib/metamask-link'
import { preloadWalletConnect } from '@/lib/wallets'
import { cn } from '@/lib/utils'

const WALLETS_WITH_LOGO_BOUNCE = new Set(['metamask', 'trustwallet', 'rabby', 'okx'])

interface ConnectWalletProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  chain?: Chain
}

// One list, as in Allbridge: wallets that can sign on the requested chain, installed ones first
// with a "Detected" mark, then WalletConnect for any wallet app. With a chain given, a browser wallet
// or WalletConnect connects on click; hardware wallets and the chain-less entry (wallet sidebar) open
// a second step for the derivation path or chains.
export const ConnectWallet = ({ isOpen, onOpenChange, chain }: ConnectWalletProps) => {
  const t = useTranslations('wallet')
  const [selectedWallet, setSelectedWallet] = useState<WalletParams>()
  const [connecting, setConnecting] = useState<string>()
  const { accounts, select, connect } = useWallets()

  const hasWalletConnect = WALLETS.some(w => w.type === WalletType.mobile)
  useEffect(() => {
    if (isOpen && hasWalletConnect) preloadWalletConnect()
  }, [isOpen, hasWalletConnect])

  const chains = useMemo(() => [...ALL_CHAINS, ...COMING_SOON_CHAINS].sort((a, b) => chainLabel(a)?.localeCompare(chainLabel(b))), [])

  const wallets = useMemo(() => {
    const usable = WALLETS.filter(wallet => !chain || wallet.supportedChains.includes(chain))
    const rank = (wallet: WalletParams) =>
      wallet.type === WalletType.hardware ? 3 : wallet.type === WalletType.mobile ? 1 : isWalletAvailable(wallet.option) ? 0 : 2
    return usable.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
  }, [chain])

  const close = () => onOpenChange(false)

  const chooseWallet = (wallet: WalletParams) => {
    if (connecting) return
    const connected = accounts.find(account => account.provider === wallet.option && (!chain || account.network === chain))
    const connectsOnClick = wallet.type === WalletType.browser || wallet.type === WalletType.mobile
    if (connected && connectsOnClick) {
      select(connected)
      close()
      return
    }
    if (wallet.type === WalletType.mobile && chain) {
      // WalletConnect opens its own QR window, which this dialog would sit over and block clicks on.
      close()
      connect(wallet.option, [chain], undefined, { describeError: error => describeWalletconnectError(t, error) }).catch(() => {})
      return
    }
    if (wallet.type === WalletType.browser && chain) {
      setConnecting(wallet.key)
      connect(wallet.option, [chain])
        .then(close)
        .catch(() => {}) // The store reports the error; keep the list open for a retry.
        .finally(() => setConnecting(undefined))
      return
    }
    setSelectedWallet(wallet)
  }

  const renderSelectedWallet = (wallet: WalletParams) => {
    if (wallet.type !== WalletType.hardware) return <BrowserWallet key={wallet.key} wallet={wallet} chains={chains} chain={chain} onConnect={close} />
    if (wallet.key === 'ledger') return <Ledger key={wallet.key} wallet={wallet} onConnect={close} />
    if (wallet.key === 'trezor') return <Trezor key={wallet.key} wallet={wallet} onConnect={close} />
    return null
  }

  const renderRow = (wallet: WalletParams) => {
    const isBrowser = wallet.type === WalletType.browser
    const isInstalled = !isBrowser || !!isWalletAvailable(wallet.option)
    const isWalletConnect = wallet.type === WalletType.mobile
    const connected = accounts.some(account => account.provider === wallet.option && (!chain || account.network === chain))
    const isConnecting = connecting === wallet.key
    const bounce = WALLETS_WITH_LOGO_BOUNCE.has(wallet.key) ? '' : undefined
    // On a phone MetaMask is an app, not an extension: the row opens this page inside it.
    const appLink = !isInstalled && wallet.option === WalletOption.METAMASK && isMobileBrowser() ? metaMaskAppLink(window.location) : undefined
    const content = (
      <>
        <WalletIcon walletKey={wallet.key} width={32} height={32} alt="" className="connect-wallet-icon wallet-choice-icon" />
        <span className="connect-wallet-name">{wallet.label}</span>
        {isConnecting ? (
          <LoaderCircle size={20} className="connect-wallet-status animate-spin" aria-label={t('connecting')} />
        ) : connected ? (
          <span className="connect-wallet-status connect-wallet-connected">{t('connected')}</span>
        ) : isBrowser && isInstalled ? (
          <span className="connect-wallet-status">
            <span className="connect-wallet-check" aria-hidden="true">
              <Check size={14} strokeWidth={3} />
            </span>
            {t('detected')}
          </span>
        ) : !isInstalled ? (
          <span className="connect-wallet-status connect-wallet-install">{t(appLink ? 'openApp' : 'install')}</span>
        ) : isWalletConnect ? (
          <span className="connect-wallet-status">{t(isMobileBrowser() ? 'walletconnectApps' : 'walletconnectQr')}</span>
        ) : null}
      </>
    )

    if (appLink) {
      return (
        <li key={wallet.key}>
          <a className="connect-wallet-row" data-wallet-logo-bounce={bounce} href={appLink}>
            {content}
          </a>
        </li>
      )
    }

    if (!isInstalled) {
      return (
        <li key={wallet.key}>
          <a className="connect-wallet-row" data-wallet-logo-bounce={bounce} href={wallet.link} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        </li>
      )
    }

    return (
      <li key={wallet.key}>
        <button
          type="button"
          className={cn('connect-wallet-row', { 'is-busy': !!connecting && !isConnecting })}
          data-wallet-logo-bounce={bounce}
          aria-busy={isConnecting}
          disabled={!!connecting}
          onClick={() => chooseWallet(wallet)}
        >
          {content}
        </button>
      </li>
    )
  }

  return (
    <Credenza
      open={isOpen}
      onOpenChange={open => {
        if (!open) setSelectedWallet(undefined)
        onOpenChange(open)
      }}
    >
      <CredenzaContent className="connect-wallet flex h-auto max-h-5/6 flex-col md:max-w-[460px]" aria-describedby={undefined}>
        <CredenzaHeader>
          <CredenzaTitle className="connect-wallet-title">
            {selectedWallet && (
              <button type="button" className="connect-wallet-back" aria-label={t('back')} onClick={() => setSelectedWallet(undefined)}>
                <ChevronLeft size={22} />
              </button>
            )}
            {selectedWallet ? selectedWallet.label : t('connectWallet')}
            {chain && !selectedWallet && <img src={`/networks/${chain.toLowerCase()}.svg`} width={22} height={22} alt={chainLabel(chain)} title={chainLabel(chain)} />}
          </CredenzaTitle>
        </CredenzaHeader>

        {selectedWallet ? (
          <div key={selectedWallet.key} className="connect-wallet-step flex min-h-0 min-w-0 flex-1 flex-col">
            {renderSelectedWallet(selectedWallet)}
          </div>
        ) : (
          <ScrollArea className="connect-wallet-step flex min-h-0 flex-1" classNameViewport="flex-1 h-auto">
            <ul className="connect-wallet-list">{wallets.map(renderRow)}</ul>
          </ScrollArea>
        )}
      </CredenzaContent>
    </Credenza>
  )
}
