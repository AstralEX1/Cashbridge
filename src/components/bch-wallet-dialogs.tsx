'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import qrcode from 'qrcode-generator'
import { Credenza, CredenzaContent, CredenzaDescription, CredenzaHeader, CredenzaTitle } from '@/components/ui/credenza'
import { detectPaytacaExtension, openPaytacaExtension, type WalletConnectState } from '@/components/bch-walletconnect'

export type BchConnection = 'wizardconnect' | 'walletconnect'
// What the chooser offers: the two connections, plus the Paytaca extension, which is WalletConnect
// opened in the extension directly.
export type BchChoice = BchConnection | 'paytaca-extension'

// The two ways a BCH wallet connects. Cashonize speaks both; it is listed under WalletConnect,
// where its own docs point dapps.
const CHOICES: { kind: BchChoice; wallets: string; protocol: string }[] = [
  { kind: 'wizardconnect', wallets: 'Selene', protocol: 'WizardConnect' },
  { kind: 'walletconnect', wallets: 'Paytaca · Cashonize', protocol: 'WalletConnect' }
]

export const BchWalletChooser = ({
  open,
  onOpenChange,
  onChoose
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (kind: BchChoice) => void
}) => {
  const t = useTranslations('bridge.wallet')
  // Offered only where the extension is installed: one click instead of copying a pairing link.
  const [extension, setExtension] = useState(false)
  useEffect(() => {
    if (!open) return
    let current = true
    void detectPaytacaExtension().then(found => current && setExtension(found))
    return () => {
      current = false
    }
  }, [open])
  const choices = extension ? [{ kind: 'paytaca-extension' as const, wallets: 'Paytaca', protocol: t('browserExtension') }, ...CHOICES] : CHOICES
  return (
    <Credenza open={open} onOpenChange={onOpenChange}>
      <CredenzaContent className="connect-wallet flex h-auto max-h-5/6 flex-col md:max-w-[460px]">
        <CredenzaHeader>
          <CredenzaTitle className="connect-wallet-title">
            {t('connectDestination')}
            <img src="/networks/bch.svg" width={22} height={22} alt="" />
          </CredenzaTitle>
          <CredenzaDescription className="sr-only">{t('chooseConnection')}</CredenzaDescription>
        </CredenzaHeader>
        <ul className="connect-wallet-list">
          {choices.map(choice => (
            <li key={choice.kind}>
              <button type="button" className="connect-wallet-row" onClick={() => onChoose(choice.kind)}>
                <img src="/networks/bch.svg" width={32} height={32} alt="" className="connect-wallet-icon" />
                <span className="connect-wallet-name">{choice.wallets}</span>
                <span className="connect-wallet-status connect-wallet-install">{choice.protocol}</span>
              </button>
            </li>
          ))}
        </ul>
      </CredenzaContent>
    </Credenza>
  )
}

// A WalletConnect URI is mixed case with punctuation, so it is encoded in byte mode (WizardConnect's
// dialog only does alphanumeric). Drawn as one SVG path so it stays sharp at any size.
const qrPath = (value: string) => {
  const qr = qrcode(0, 'M')
  qr.addData(value, 'Byte')
  qr.make()
  const count = qr.getModuleCount()
  let d = ''
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
  return { d, count }
}

export const WalletConnectDialog = ({
  state,
  uri,
  extension,
  onClose
}: {
  state: WalletConnectState
  uri?: string
  // Paired through the Paytaca extension: the window it opens may have been blocked, so it can be opened from here.
  extension?: boolean
  onClose: () => void
}) => {
  const t = useTranslations('bridge.wallet')
  const qr = useMemo(() => (uri ? qrPath(uri) : undefined), [uri])
  const [copied, setCopied] = useState(false)
  useEffect(() => setCopied(false), [uri])
  const open = (state === 'connecting' && !!uri) || state === 'verifying'

  return (
    <Credenza open={open} onOpenChange={next => !next && onClose()}>
      <CredenzaContent className="connect-wallet flex h-auto max-h-5/6 flex-col md:max-w-[420px]">
        <CredenzaHeader>
          <CredenzaTitle className="connect-wallet-title">{t('walletConnectTitle')}</CredenzaTitle>
          <CredenzaDescription>{state === 'verifying' ? t('walletConnectVerify') : t('walletConnectScan')}</CredenzaDescription>
        </CredenzaHeader>
        <div className="flex flex-col items-center gap-4 px-4 pb-6 md:px-6">
          {state === 'verifying' ? (
            <LoaderCircle size={36} className="animate-spin" aria-label={t('connecting')} />
          ) : (
            qr &&
            uri && (
              <>
                <svg
                  viewBox={`-4 -4 ${qr.count + 8} ${qr.count + 8}`}
                  width={264}
                  height={264}
                  role="img"
                  aria-label={t('walletConnectQr')}
                  className="rounded-2xl bg-white"
                  shapeRendering="crispEdges"
                >
                  <path d={qr.d} fill="#111" />
                </svg>
                <div className="flex w-full gap-2">
                  <button
                    type="button"
                    className="connect-wallet-row justify-center"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(uri)
                        .then(() => setCopied(true))
                        .catch(() => {})
                    }
                  >
                    <Copy size={18} />
                    {copied ? t('walletConnectCopied') : t('walletConnectCopy')}
                  </button>
                  <a className="connect-wallet-row justify-center" href={uri}>
                    {t('walletConnectOpen')}
                  </a>
                </div>
              </>
            )
          )}
          {extension && (
            <button
              type="button"
              className="connect-wallet-row justify-center"
              onClick={() => openPaytacaExtension(state === 'verifying' ? undefined : uri)}
            >
              {t('openPaytacaExtension')}
            </button>
          )}
        </div>
      </CredenzaContent>
    </Credenza>
  )
}
