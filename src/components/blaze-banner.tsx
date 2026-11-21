'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AppConfig, BlazeConfig } from '@/config'
import './blaze-banner.css'

const { deckUrl, emberAddress } = BlazeConfig

const shortAddress = (address: string) => {
  const body = address.slice(address.indexOf(':') + 1)
  return `${body.slice(0, 8)}…${body.slice(-6)}`
}

export function BlazeBanner() {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

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
        <Link href="/docs/bounty">Bounty checklist</Link>
        {emberAddress && (
          <span className="blaze-ember">
            Donations &amp; EMBER2026:{' '}
            {copy === 'failed' ? (
              <span className="blaze-address">{emberAddress}</span>
            ) : (
              <button type="button" onClick={copyAddress} title={emberAddress} aria-label={`Copy donation and EMBER2026 address ${emberAddress}`}>
                {copy === 'copied' ? 'Copied' : shortAddress(emberAddress)}
              </button>
            )}
          </span>
        )}
      </div>
      <p className="blaze-note">
        Pre-existing project: before BLAZE opened on 14 November 2026, we had connected the THORChain API, run the first swaps by hand from a local build and bought the domain.{' '}
        <Link href="/docs/demo">Pre-BLAZE demo</Link>
      </p>
    </aside>
  )
}
