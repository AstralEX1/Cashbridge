import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { DocsNav } from '@/components/docs/docs-nav'
import { AppConfig } from '@/config'
import '@/components/docs/docs.css'

export const metadata: Metadata = {
  title: { template: `%s · ${AppConfig.appName} Docs`, default: `${AppConfig.appName} Docs` },
  description: 'Cash Bridge protocol docs: Manual vs Cashbridge Router, THORChain and NEAR Intents, contract orders, MCP agents, wallets, fees and mainnet proof.'
}

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="docs-page">
      <header className="docs-top">
        <Link href="/docs" className="docs-brand">
          <Image src={AppConfig.logo} alt="" width={32} height={32} priority sizes="32px" />
          {AppConfig.appName} <span>Docs</span>
        </Link>
        <a href={AppConfig.repoUrl} className="docs-repo" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <Link href="/bridge" className="docs-launch">
          Launch app
        </Link>
      </header>
      <div className="docs-body">
        <DocsNav />
        <main>{children}</main>
      </div>
    </div>
  )
}
