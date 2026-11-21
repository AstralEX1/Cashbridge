import type { Metadata } from 'next'
import { SiteFooter, SiteHeader } from '@/components/landing/site-chrome'
import { ScannerView } from '@/components/scanner/scanner-view'
import { AppConfig } from '@/config'
import '@/components/scanner/scanner.css'

export const metadata: Metadata = {
  title: `Scanner · ${AppConfig.appName}`,
  description: 'Transfers through Cash Bridge, searchable by wallet address: Cashbridge Router orders, THORChain swaps and transfers verified on mainnet, each step linked to a public explorer.',
  alternates: { canonical: '/scanner' }
}

export default function ScannerPage() {
  return (
    <div className="landing" lang="en" dir="ltr">
      <SiteHeader />
      <main className="scanner">
        <ScannerView />
      </main>
      <SiteFooter />
    </div>
  )
}
