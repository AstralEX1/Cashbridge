'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { create } from 'zustand'
import { Check, ChevronDown, ClipboardPaste, LoaderCircle, LogOut, Wallet, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/tooltip'
import { useBchWallet } from '@/components/bch-wallet'
import { shortBridgeAddress } from '@/components/swap/bridge-wallet-badge'
import { useAutomaticBridge, useAutomaticHydrated } from '@/hooks/use-automatic-bridge'
import { automaticPreference } from '@/store/auto-bridge-store'
import { useSwapStore } from '@/store/swap-store'
import { bchAddressProblem } from '@/lib/bch'

// Cashbridge Router selector: Router, the service executes the BCH-to-token step (and plain BCH runs as
// before); Manual, every step is signed in the user's own wallets. The choice keeps its position on plain BCH.
export const RouterSelector = () => {
  const t = useTranslations('automatic')
  const { routerAvailable, routerOn } = useAutomaticBridge()
  const setMode = automaticPreference(state => state.setMode)
  // The saved mode is only known after hydration: until then the selector is hidden, so a page load never shows Manual flip to Router.
  const hydrated = useAutomaticHydrated()
  const selector = (
    <div
      className="bridge-router"
      role="group"
      aria-label={t('router')}
      data-disabled={!routerAvailable || undefined}
      data-hydrated={hydrated || undefined}
    >
      <button type="button" aria-pressed={!routerOn} onClick={() => setMode('manual')}>
        {t('manual')}
      </button>
      <button type="button" aria-pressed={routerOn} disabled={!routerAvailable} onClick={() => setMode('automatic')}>
        {t('router')}
      </button>
    </div>
  )
  return <Tooltip content={t(routerAvailable ? 'routerHint' : 'routerUnavailable')}>{selector}</Tooltip>
}

// Free pairs between two THORChain-listed assets, quoted on every route and signed in the source wallet.
export const OpenNetworksToggle = () => {
  const t = useTranslations('automatic')
  const openNetworks = useSwapStore(state => state.openNetworks)
  const setOpenNetworks = useSwapStore(state => state.setOpenNetworks)
  const hydrated = useAutomaticHydrated()
  return (
    <Tooltip content={t('openNetworksHint')}>
      <button
        type="button"
        className="bridge-open-networks"
        aria-pressed={openNetworks}
        data-hydrated={hydrated || undefined}
        onClick={() => setOpenNetworks(!openNetworks)}
      >
        {t('openNetworks')}
      </button>
    </Tooltip>
  )
}

// Any-network reminder under the tools row (the Router explanation lives on the selector tooltip).
export const RouterHint = () => {
  const t = useTranslations('automatic')
  const openNetworks = useSwapStore(state => state.openNetworks)
  if (!openNetworks) return null
  return <p className="bridge-router-hint">{t('openNetworksHint')}</p>
}

// Whether the paste field under the BCH badge is open. An invalid typed address keeps it open.
const usePasteField = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({ open: false, setOpen: open => set({ open }) }))

// The BCH side's wallet pill on the routes that can pay a pasted address (the router, plain BCH):
// a menu with the connected wallet, connecting another one, and pasting an address instead.
export const BchDestinationMenu = () => {
  const t = useTranslations('bridge.wallet')
  const wallet = useBchWallet()
  const { automatic, pasted, pastedProblem } = useAutomaticBridge()
  const setRecipient = automaticPreference(state => state.setRecipient)
  const setOpen = usePasteField(state => state.setOpen)
  const pastedValid = !!pasted && !pastedProblem
  const walletAddress = wallet.binding?.cashAddress
  const connecting = (wallet.state === 'connecting' || wallet.state === 'reconnecting') && !wallet.reconnectStalled

  const selectWallet = () => {
    setRecipient('')
    setOpen(false)
  }
  const connectNew = () => {
    setRecipient('')
    setOpen(false)
    if (walletAddress || wallet.reconnectStalled || wallet.mismatch || wallet.state === 'connected') wallet.pairAgain()
    else wallet.connect()
  }
  // Takes an address straight from the clipboard when it holds one word; a wrong one stays in the field,
  // marked, so the user sees what was refused. Anything else (a copied sentence) just opens the field.
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (/^\S{1,100}$/.test(text)) {
        setRecipient(text)
        setOpen(!!bchAddressProblem(text, automatic))
        return
      }
    } catch {
      // No clipboard access: the user pastes into the field.
    }
    setOpen(true)
  }

  const shown = pasted || walletAddress
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`bridge-wallet-badge bridge-wallet-menu${shown ? '' : ' bridge-wallet-connect'}`} aria-label={t('destinationMenu')}>
          {connecting && !shown ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          ) : shown ? (
            <span className={`bridge-wallet-dot${pasted && !pastedValid ? ' is-invalid' : ''}`} aria-hidden="true" />
          ) : (
            <Wallet size={14} aria-hidden="true" />
          )}
          <span title={shown || undefined}>{shown ? shortBridgeAddress(shown) : t(connecting ? 'connecting' : 'connectDestination')}</span>
          <ChevronDown size={16} className="bridge-wallet-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="bridge-wallet-dropdown">
        {walletAddress && (
          <DropdownMenuItem className="bridge-wallet-option" data-active={!pasted || undefined} onSelect={selectWallet}>
            <span className="bridge-wallet-dot" aria-hidden="true" />
            <span className="bridge-wallet-option-text">
              <strong>{shortBridgeAddress(walletAddress)}</strong>
              <small>{wallet.walletName ?? t('title')}</small>
            </span>
            {!pasted && <Check size={16} className="bridge-wallet-check" aria-hidden="true" />}
          </DropdownMenuItem>
        )}
        {pastedValid && (
          <DropdownMenuItem className="bridge-wallet-option" data-active onSelect={() => setOpen(true)}>
            <ClipboardPaste size={16} aria-hidden="true" />
            <span className="bridge-wallet-option-text">
              <strong>{shortBridgeAddress(pasted)}</strong>
              <small>{t('pastedAddress')}</small>
            </span>
            <Check size={16} className="bridge-wallet-check" aria-hidden="true" />
          </DropdownMenuItem>
        )}
        {(walletAddress || pastedValid) && <DropdownMenuSeparator className="bridge-wallet-separator" />}
        <DropdownMenuItem className="bridge-wallet-option" onSelect={connectNew}>
          <Wallet size={16} aria-hidden="true" />
          {t(walletAddress ? 'connectNew' : 'connectDestination')}
        </DropdownMenuItem>
        <DropdownMenuItem className="bridge-wallet-option" onSelect={paste}>
          <ClipboardPaste size={16} aria-hidden="true" />
          {t('pasteAddress')}
        </DropdownMenuItem>
        {walletAddress && (
          <DropdownMenuItem className="bridge-wallet-option is-muted" onSelect={() => void wallet.disconnect()}>
            <LogOut size={16} aria-hidden="true" />
            {t('disconnect')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Opened from the menu when the clipboard has no BCH address (or to edit the pasted one).
export const DestinationAddressInput = () => {
  const t = useTranslations('automatic')
  const id = useId()
  const { pasteAllowed, automatic, pastedProblem, token } = useAutomaticBridge()
  const ticker = { ticker: token?.ticker ?? 'BCH' }
  const value = automaticPreference(state => state.recipient)
  const setRecipient = automaticPreference(state => state.setRecipient)
  const open = usePasteField(state => state.open)
  const setOpen = usePasteField(state => state.setOpen)
  const wallet = useBchWallet()
  if (!pasteAllowed || (!open && !pastedProblem)) return null
  const close = () => {
    setRecipient('')
    setOpen(false)
  }
  return (
    <div className="bridge-auto-recipient">
      <label htmlFor={id}>{t(automatic ? 'recipient' : 'recipientBch', ticker)}</label>
      <div className="bridge-paste-field">
        <Input
          id={id}
          value={value}
          onChange={event => setRecipient(event.target.value)}
          placeholder="bitcoincash:…"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!value}
          aria-invalid={!!pastedProblem}
          aria-describedby={pastedProblem ? `${id}-error` : undefined}
        />
        <button type="button" className="bridge-paste-clear" aria-label={t(wallet.binding ? 'useWallet' : 'clearAddress')} title={t(wallet.binding ? 'useWallet' : 'clearAddress')} onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {pastedProblem ? (
        <p id={`${id}-error`} className="bridge-paste-error" role="alert">
          {t(pastedProblem === 'notTokenAware' ? 'addressNotTokenAware' : automatic ? 'addressInvalidToken' : 'addressInvalid', ticker)}
        </p>
      ) : (
        <p className="bridge-input-meta">{t(automatic ? 'pasteRecipient' : 'pasteRecipientBch', ticker)}</p>
      )}
    </div>
  )
}
