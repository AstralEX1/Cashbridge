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
        <h1>Transfers</h1>
        <p className="landing-sub">Router orders as they happen, plus transfers verified on mainnet. Every step links to a public explorer.</p>
        <ScannerView />
        <p className="scanner-note">
          Manual transfers stay in History in the <Link href="/bridge">app</Link> on this browser — they carry no on-chain Cash Bridge marker unless
          verified by hand. <Link href="/docs/guides/track-a-transfer">Track a transfer</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
