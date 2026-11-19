import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter, SiteHeader } from '@/components/landing/site-chrome'
import { ScannerView } from '@/components/scanner/scanner-view'
import { AppConfig } from '@/config'
import '@/components/scanner/scanner.css'

export const metadata: Metadata = {
  title: `Scanner · ${AppConfig.appName}`,
  description: 'Transfers through Cash Bridge: Cashbridge Router orders and transfers verified on mainnet, each step linked to a public explorer.',
  alternates: { canonical: '/scanner' }
}

export default function ScannerPage() {
  return (
    <div className="landing">
      <SiteHeader />
      <main className="scanner">
        <p className="landing-kicker">Scanner</p>
        <h1>Transfers through Cash Bridge</h1>
        <p className="landing-sub">
          Cashbridge Router orders as they happen, and the transfers verified on mainnet. Every step links to a public explorer, so you can check it
          on the chain itself.
        </p>
        <ScannerView />
        <p className="scanner-note">
          Manual transfers are signed in your own wallets and carry no Cash Bridge marker on chain, so they are not listed here unless they were
          verified by hand. Your own transfers stay in History in the <Link href="/bridge">app</Link>, in this browser. See{' '}
          <Link href="/docs/guides/track-a-transfer">Track a transfer</Link> for every status.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
