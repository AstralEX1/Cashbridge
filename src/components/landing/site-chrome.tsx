import Image from 'next/image'
import Link from 'next/link'
import { AppConfig } from '@/config'
import './landing.css'

// Header and footer shared by the landing page and the scanner.
export function SiteHeader() {
  return (
    <header className="landing-nav">
      <Link href="/" className="landing-brand">
        <Image src={AppConfig.logo} alt="" width={30} height={30} priority sizes="30px" />
        {AppConfig.appName}
      </Link>
      <nav aria-label="Main">
        <Link href="/#how">How it works</Link>
        <Link href="/#tokens">Tokens</Link>
        <Link href="/#integrations">Integrations</Link>
        <Link href="/scanner">Scanner</Link>
        <Link href="/docs">Docs</Link>
      </nav>
      <Link href="/bridge" className="landing-button landing-button-small">
        Launch app
      </Link>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="landing-footer">
      <Link href="/" className="landing-brand">
        <Image src={AppConfig.logo} alt="" width={26} height={26} sizes="26px" />
        {AppConfig.appName}
      </Link>
      <nav aria-label="Footer">
        <div>
          <p>Product</p>
          <Link href="/bridge">Bridge</Link>
          <Link href="/scanner">Scanner</Link>
          <Link href="/docs">Docs</Link>
        </div>
        <div>
          <p>Learn</p>
          <Link href="/docs/how-it-works">How it works</Link>
          <Link href="/docs/agents">AI agents</Link>
          <Link href="/docs/security">Security and custody</Link>
          <Link href="/docs/fees">Fees</Link>
          <Link href="/docs/mainnet">Proof on mainnet</Link>
        </div>
        <div>
          <p>Code</p>
          <a href={AppConfig.repoUrl} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </nav>
    </footer>
  )
}
