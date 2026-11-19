import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { BlazeBanner } from '@/components/blaze-banner'
import { ChainCarousel } from '@/components/landing/chain-carousel'
import { FlowDiagram } from '@/components/landing/flow-diagram'
import { LandingVideo } from '@/components/landing/landing-video'
import { SiteFooter, SiteHeader } from '@/components/landing/site-chrome'
import { ScanList } from '@/components/scanner/scan-list'
import { AppConfig } from '@/config'
import { FEATURED_TOKENS } from '@/lib/cauldron-tokens'
import { RUNS } from '@/lib/mainnet-runs'
import { rowFromRun } from '@/lib/scanner'
import '@/components/landing/landing.css'

export const metadata: Metadata = {
  alternates: {
    canonical: AppConfig.baseUrl
  }
}

// The second cross-chain route, for manual transfers both ways. Set to false to take it off the page.
const NEAR_INTENTS = true

const INTEGRATIONS: { name: string; role: string; logo?: string; href: string; show?: boolean }[] = [
  {
    name: 'THORChain',
    role: 'Cross-chain swaps into native BCH and back.',
    logo: '/providers/thorchain.svg',
    href: 'https://thorchain.org'
  },
  {
    name: 'NEAR Intents',
    role: 'Second route; the form takes the better quote.',
    logo: '/providers/near.svg',
    href: 'https://near-intents.org',
    show: NEAR_INTENTS
  },
  {
    name: 'Cauldron',
    role: 'Bitcoin Cash AMM. Trades built in your browser.',
    logo: '/providers/cauldron.png',
    href: 'https://cauldron.quest'
  },
  {
    name: 'WizardConnect',
    role: 'Selene and other BCH wallets via QR or link.',
    href: 'https://docs.riftenlabs.com/wizardconnect/dapp'
  },
  {
    name: 'WalletConnect',
    role: 'Paytaca, Cashonize, and any WC wallet as source.',
    logo: '/wallets/walletconnect.svg',
    href: 'https://walletconnect.network'
  },
  {
    name: 'Fulcrum',
    role: 'Every BCH step broadcast and followed on chain.',
    href: 'https://github.com/cculianu/Fulcrum'
  },
  { name: 'Rostrum', role: 'Live Cauldron pool feed for quotes.', href: 'https://gitlab.com/bitcoinunlimited/rostrum' },
  { name: 'BCMR', role: 'Token names and icons from CashToken metadata.', href: 'https://cashtokens.org/docs/bcmr/chip' }
]

const WALLETS: [string, string?][] = [
  ['Selene'],
  ['Paytaca'],
  ['Cashonize'],
  ['MetaMask', '/wallets/metamask.svg'],
  ['Rabby', '/wallets/rabby.svg'],
  ['Phantom', '/wallets/phantom.svg'],
  ['Trust Wallet', '/wallets/trustwallet.svg'],
  ['OKX', '/wallets/okx.svg'],
  ['Keplr', '/wallets/keplr.svg'],
  ['Vultisig', '/wallets/vultisig.svg'],
  ['Ledger', '/wallets/ledger.svg'],
  ['Trezor', '/wallets/trezor.svg']
]

const Logo = ({ src, size, alt = '' }: { src: string; size: number; alt?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt={alt} width={size} height={size} loading="lazy" />
)

export default function Page() {
  const latest = RUNS.map(rowFromRun).reverse().slice(0, 3)
  return (
    <div className="landing">
      <div className="landing-banner">
        <BlazeBanner />
      </div>

      <SiteHeader />

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>
              Bridge anything to <em>Bitcoin Cash</em>.
            </h1>
            <p className="landing-lead">
              Send BTC, ETH, USDC, SOL and more. Receive BCH, PUSD or any CashToken with Cauldron liquidity — and go back the same way.
            </p>
            <div className="landing-actions">
              <Link href="/bridge" className="landing-button">
                Launch app <ArrowRight size={18} aria-hidden />
              </Link>
              <a href="#how" className="landing-button landing-button-ghost">
                See how it works
              </a>
            </div>
            <ul className="landing-facts">
              <li>No sign-up</li>
              <li>No Cash Bridge fee</li>
              <li>Open source</li>
            </ul>
          </div>
          <LandingVideo
            className="landing-hero-video landing-video-crop"
            src="/landing/cashbridge-promo.mp4"
            poster="/landing/cashbridge-promo.webp"
            label="Cash Bridge in use: 100 USDC on Base becomes PUSD on Bitcoin Cash with the Cashbridge Router. Demo amounts."
            eager
          />
        </section>

        <section className="landing-chains" aria-labelledby="chains-title">
          <h2 id="chains-title" className="landing-kicker">
            Send from
          </h2>
          <ChainCarousel />
          <p className="landing-chains-to">
            <ArrowRight size={18} aria-hidden /> Receive on <Logo src="/networks/bch.svg" size={22} alt="" /> Bitcoin Cash
          </p>
        </section>

        <section id="how" className="landing-section" aria-labelledby="how-title">
          <p className="landing-kicker">How it works</p>
          <h2 id="how-title">Two hops to any CashToken.</h2>
          <FlowDiagram nearIntents={NEAR_INTENTS} />
        </section>

        <section id="tokens" className="landing-section landing-tokens" aria-labelledby="tokens-title">
          <div>
            <p className="landing-kicker">Tokens</p>
            <h2 id="tokens-title">Every CashToken with a Cauldron market.</h2>
            <p className="landing-sub">PUSD, MUSD, and any token with live liquidity. Sell any of them back for BTC, ETH, USDC and more.</p>
          </div>
          <ul className="landing-token-grid">
            {FEATURED_TOKENS.map(token => (
              <li key={token.category}>
                <span className="landing-token-icon" data-initial={token.ticker.slice(0, 1)}>
                  {token.icon && <Logo src={token.icon} size={40} />}
                </span>
                <strong>{token.ticker}</strong>
                <span>{token.name}</span>
              </li>
            ))}
            <li className="landing-token-any">
              <span className="landing-token-icon" data-initial="#" />
              <strong>Any token</strong>
              <span>
                by category id, e.g. <code>{FEATURED_TOKENS[0].category.slice(0, 8)}…</code>
              </span>
            </li>
          </ul>
        </section>

        <section id="router" className="landing-section landing-split" aria-labelledby="router-title">
          <LandingVideo
            className="landing-video-crop landing-video-crop-router"
            src="/landing/cashbridge-router.mp4"
            poster="/landing/cashbridge-router.webp"
            label="Turning on the Cashbridge Router in the bridge form. Demo."
          />
          <div>
            <p className="landing-kicker">Cashbridge Router</p>
            <h2 id="router-title">One signature. Then close the tab.</h2>
            <ul className="landing-checks">
              <li>Sign once. The Router buys your token on Cauldron and pays your BCH address.</li>
              <li>Your minimum is fixed when the order is created.</li>
              <li>If the minimum cannot be met in time, the BCH returns to your fallback address.</li>
            </ul>
            <p className="landing-note">
              On a contract order, the covenant can only pay you or refund you. Legacy Router orders differ — see{' '}
              <Link href="/docs/security">Security and custody</Link>. Manual mode stays one click away.{' '}
              <Link href="/docs/guides/cashbridge-router">How the Router works</Link>
            </p>
          </div>
        </section>

        <section id="integrations" className="landing-section" aria-labelledby="integrations-title">
          <p className="landing-kicker">Integrations</p>
          <h2 id="integrations-title">Open Bitcoin Cash and cross-chain rails.</h2>
          <ul className="landing-integrations">
            {INTEGRATIONS.filter(item => item.show !== false).map(item => (
              <li key={item.name}>
                <a href={item.href} target="_blank" rel="noopener noreferrer">
                  <span className="landing-integration-logo" data-initial={item.name.slice(0, 1)}>
                    {item.logo && <Logo src={item.logo} size={36} />}
                  </span>
                  <strong>
                    {item.name} <ArrowUpRight size={14} aria-hidden />
                  </strong>
                  <span>{item.role}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="landing-wallets">
            <p>Wallets</p>
            <ul>
              {WALLETS.map(([name, icon]) => (
                <li key={name}>
                  <span className="landing-wallet-icon" data-initial={name.slice(0, 1)}>
                    {icon && <Logo src={icon} size={20} />}
                  </span>
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="scanner" className="landing-section" aria-labelledby="scanner-title">
          <div className="landing-section-head">
            <div>
              <p className="landing-kicker">Scanner</p>
              <h2 id="scanner-title">Every transfer, on the record.</h2>
            </div>
            <Link href="/scanner" className="landing-button landing-button-ghost">
              Open scanner <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
          <div className="landing-scan">
            <ScanList rows={latest} compact />
          </div>
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <h2 id="final-title">Bring your assets to Bitcoin Cash.</h2>
          <div className="landing-actions">
            <Link href="/bridge" className="landing-button">
              Launch app <ArrowRight size={18} aria-hidden />
            </Link>
            <Link href="/docs" className="landing-button landing-button-ghost">
              Read the docs
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
