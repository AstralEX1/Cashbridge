'use client'

import { useId, useState } from 'react'
import { AppConfig, BlazeConfig } from '@/config'

const { deckUrl, emberAddress, preBlazeCodeUrl, preBlazeDemoUrl } = BlazeConfig

const shortAddress = (address: string) => {
  const body = address.slice(address.indexOf(':') + 1)
  return `${body.slice(0, 8)}…${body.slice(-6)}`
}

export function BlazeBanner() {
  const [open, setOpen] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const panelId = useId()

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(emberAddress)
      setCopy('copied')
      setTimeout(() => setCopy('idle'), 1500)
    } catch {
      // No clipboard access: show the whole address so it can be selected by hand.
      setCopy('failed')
    }
  }

  return (
    <aside className="blaze-banner" aria-label="BCH BLAZE 2026 entry">
      <div className="blaze-links">
        <span className="blaze-tag">BCH BLAZE 2026</span>
        {deckUrl && (
          <a href={deckUrl} target="_blank" rel="noreferrer">
            Presentation
          </a>
        )}
        <a href={AppConfig.repoUrl} target="_blank" rel="noreferrer">
          Source code
        </a>
        {emberAddress && (
          <span className="blaze-ember">
            EMBER2026 votes:{' '}
            {copy === 'failed' ? (
              <span className="blaze-address">{emberAddress}</span>
            ) : (
              <button type="button" onClick={copyAddress} title={emberAddress} aria-label={`Copy EMBER2026 address ${emberAddress}`}>
                {copy === 'copied' ? 'Copied' : shortAddress(emberAddress)}
              </button>
            )}
          </span>
        )}
      </div>
      <p className="blaze-note">
        Pre-existing project: our partnership and integration with THORChain began before the BLAZE build period opened on 14 November 2026.{' '}
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(o => !o)}>
          What was built when
        </button>
      </p>
      <div id={panelId} className="blaze-panel" hidden={!open}>
        <p>
          <strong>Before 14 November:</strong> the bridge in both directions (live since 28 October), the Cashbridge Router, and Paytaca and
          Cashonize over WalletConnect.
          {preBlazeCodeUrl && (
            <>
              {' '}
              <a href={preBlazeCodeUrl} target="_blank" rel="noreferrer">
                Code before BLAZE
              </a>{' '}
              (published to the public repository 14–16 November)
            </>
          )}
          {preBlazeDemoUrl && (
            <>
              {' · '}
              <a href={preBlazeDemoUrl} target="_blank" rel="noreferrer">
                Demo before BLAZE
              </a>
            </>
          )}
        </p>
        <p>
          <strong>Built during BLAZE:</strong> in-app docs, the Manual | Cashbridge Router selector, a notice with Try again when the Cashbridge
          Router is unavailable, reasons for networks THORChain has paused, checks on pasted addresses, History that shows the BCH you kept, Bridge
          another, the gas line on the receipt, keyless explorers for UTXO chains, RPC failover and Telegram alerts for the Cashbridge Router, a
          12-hour health check, USD prices from THORNode, and a mainnet test of seven routes on 17 November.
        </p>
      </div>
    </aside>
  )
}
