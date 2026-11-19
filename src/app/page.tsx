import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { BlazeBanner } from '@/components/blaze-banner'
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

// Source chains, as the docs list them (THORChain decides what is open at a given moment).
const CHAINS: [string, string][] = [
  ['btc', 'Bitcoin'],
  ['eth', 'Ethereum'],
  ['base', 'Base'],
  ['sol', 'Solana'],
  ['bsc', 'BNB Chain'],
  ['avax', 'Avalanche'],
  ['xrp', 'XRP Ledger'],
  ['tron', 'TRON'],
  ['ltc', 'Litecoin'],
  ['doge', 'Dogecoin'],
  ['zec', 'Zcash'],
  ['gaia', 'Cosmos'],
  ['thor', 'THORChain']
]

const INTEGRATIONS: { name: string; role: string; logo?: string; href: string; show?: boolean }[] = [
  {
    name: 'THORChain',
    role: 'Swaps assets from other chains into native BCH and back, through its official API.',
    logo: '/providers/thorchain.svg',
    href: 'https://thorchain.org'
  },
  {
    name: 'NEAR Intents',
    role: 'A second route into BCH and out of it. Market makers fill the swap, and the form takes the better of the two quotes.',
    logo: '/providers/near.svg',
    href: 'https://near-intents.org',
    show: NEAR_INTENTS
  },
  {
    name: 'Cauldron',
    role: 'The Bitcoin Cash AMM. Trades are built in your browser from its live pools.',
    logo: '/providers/cauldron.png',
    href: 'https://cauldron.quest'
  },
  {
    name: 'WizardConnect',
    role: 'Pairs Selene and other Bitcoin Cash wallets with a QR code or a link.',
    href: 'https://docs.riftenlabs.com/wizardconnect/dapp'
  },
  {
    name: 'WalletConnect',
    role: 'Paytaca and Cashonize on the BCH side, and any WalletConnect wallet as the source.',
    logo: '/wallets/walletconnect.svg',
    href: 'https://walletconnect.network'
  },
  {
    name: 'Fulcrum',
    role: 'Electrum servers: every BCH step is broadcast and followed on the chain itself.',
    href: 'https://github.com/cculianu/Fulcrum'
  },
  { name: 'Rostrum', role: 'A live feed of Cauldron pools, so quotes follow every trade.', href: 'https://gitlab.com/bitcoinunlimited/rostrum' },
  { name: 'BCMR', role: 'Token names, tickers and icons from each CashToken’s own metadata registry.', href: 'https://cashtokens.org/docs/bcmr/chip' }
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
            <p className="landing-eyebrow">
              <span className="landing-dot" aria-hidden /> Live on Bitcoin Cash mainnet
            </p>
            <h1>
              Bridge anything to <em>Bitcoin Cash</em>.
            </h1>
            <p className="landing-lead">
              Send BTC, ETH, USDC, SOL and more from the chain they live on. Receive BCH, PUSD or any CashToken traded on Cauldron in your own wallet.
              And go back the same way.
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
            className="landing-hero-video"
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
          <ul className="landing-chain-list">
            {CHAINS.map(([icon, name]) => (
              <li key={icon} title={name}>
                <Logo src={`/networks/${icon}.svg`} size={32} />
                <span>{name}</span>
              </li>
            ))}
          </ul>
          <p className="landing-chains-to">
            <ArrowRight size={18} aria-hidden /> Receive on <Logo src="/networks/bch.svg" size={22} /> Bitcoin Cash
          </p>
        </section>

        <section id="how" className="landing-section" aria-labelledby="how-title">
          <p className="landing-kicker">How it works</p>
          <h2 id="how-title">Two hops from any chain to any CashToken.</h2>
          <p className="landing-sub">
            Cash Bridge plans the route and builds each transaction. Open protocols move the value: THORChain{NEAR_INTENTS ? ' or NEAR Intents' : ''}{' '}
            for the cross-chain swap, Cauldron for the token.
          </p>
          <FlowDiagram nearIntents={NEAR_INTENTS} />

          <div className="landing-cards">
            <article>
              <h3>Your funds stay yours</h3>
              <p>
                In Manual mode every transaction is signed in your own wallet. THORChain or NEAR Intents pays the BCH straight to your address, and
                Cash Bridge never holds funds or sees a private key.
              </p>
            </article>
            <article>
              <h3>Permissionless rails</h3>
              <p>
                THORChain and Cauldron are open protocols anyone can use. No account and no allow-list. The Cauldron trade is built in your browser
                from live pools, and every output is checked before you sign.
              </p>
            </article>
            <article>
              <h3>One signature, if you want it</h3>
              <p>
                Turn on the Cashbridge Router and sign once. It holds the BCH for the minutes it takes to buy your token, then pays you, or refunds
                the BCH. <Link href="/docs/security">Custody details</Link>
              </p>
            </article>
          </div>
        </section>

        <section id="tokens" className="landing-section landing-tokens" aria-labelledby="tokens-title">
          <div>
            <p className="landing-kicker">Tokens</p>
            <h2 id="tokens-title">Every CashToken with a Cauldron market.</h2>
            <p className="landing-sub">
              Dollars like PUSD and MUSD, and every other token with live liquidity on Cauldron. Pick one from the list, or search all of Cauldron by
              ticker, name or category id. Sell any of them back for BTC, ETH, USDC and more.
            </p>
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
            src="/landing/cashbridge-router.mp4"
            poster="/landing/cashbridge-router.webp"
            label="Turning on the Cashbridge Router in the bridge form. Demo."
          />
          <div>
            <p className="landing-kicker">Cashbridge Router</p>
            <h2 id="router-title">One signature. Then close the tab.</h2>
            <ul className="landing-checks">
              <li>Sign once on the source chain. The Router buys your token on Cauldron and pays it to your BCH address.</li>
              <li>The minimum you receive is fixed when the order is created.</li>
              <li>It acts only after it sees the BCH arrive on the Bitcoin Cash chain.</li>
              <li>If the minimum cannot be met in time, the BCH goes back to your fallback address.</li>
            </ul>
            <p className="landing-note">
              While it works, the Router holds the BCH for a short time. Manual mode stays one click away.{' '}
              <Link href="/docs/guides/cashbridge-router">How the Router works</Link>
            </p>
          </div>
        </section>

        <section id="integrations" className="landing-section" aria-labelledby="integrations-title">
          <p className="landing-kicker">Integrations</p>
          <h2 id="integrations-title">Built on open Bitcoin Cash and cross-chain infrastructure.</h2>
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
              <p className="landing-sub">
                Cashbridge Router orders as they happen and the transfers verified on mainnet, each step linked to a public explorer.
              </p>
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
