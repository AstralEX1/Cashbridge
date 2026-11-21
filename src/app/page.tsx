import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, FileLock2, Globe, KeyRound, PenLine, Undo2 } from 'lucide-react'
import { BlazeBanner } from '@/components/blaze-banner'
import { AgentChat } from '@/components/landing/agent-chat'
import { AgentKit, type AgentKitItem } from '@/components/landing/agent-kit'
import { BeamDiagram } from '@/components/landing/beam-diagram'
import { InView } from '@/components/landing/in-view'
import { LandingVideo } from '@/components/landing/landing-video'
import { LiveTransfers } from '@/components/landing/live-transfers'
import { Marquee } from '@/components/landing/marquee'
import { CHAINS, INTEGRATIONS, ROUTES } from '@/components/landing/network'
import { SiteFooter, SiteHeader } from '@/components/landing/site-chrome'
import { AppConfig } from '@/config'
import { FEATURED_TOKENS } from '@/lib/cauldron-tokens'
import { AGENT_PROMPT, CLAUDE_CODE_COMMAND, MCP_CONFIG, SKILL_INSTALL_COMMAND, SKILL_MD, SKILL_PATH } from '@/server/agent/kit'
import '@/components/docs/docs.css'
import '@/components/landing/landing.css'

export const metadata: Metadata = {
  alternates: {
    canonical: AppConfig.baseUrl
  }
}

const WALLETS: [string, string?][] = [
  ['Selene', '/wallets/selene.png'],
  ['Paytaca', '/wallets/paytaca.png'],
  ['Cashonize', '/wallets/cashonize.png'],
  ['Zapit', '/wallets/zapit.png'],
  ['MetaMask', '/wallets/metamask.svg'],
  ['Rabby', '/wallets/rabby.svg'],
  ['Phantom', '/wallets/phantom.svg'],
  ['Trust Wallet', '/wallets/trustwallet.svg'],
  ['OKX', '/wallets/okx.svg'],
  ['Keplr', '/wallets/keplr.svg'],
  ['Vultisig', '/wallets/vultisig.svg'],
  ['Slush', '/wallets/slush.png'],
  ['TON Connect', '/wallets/tonconnect.svg'],
  ['Lace', '/wallets/lace.png'],
  ['Eternl', '/wallets/eternl.png'],
  ['Yoroi', '/wallets/yoroi.png'],
  ['Ledger', '/wallets/ledger.svg'],
  ['Trezor', '/wallets/trezor.svg']
]

const AGENT_KIT: AgentKitItem[] = [
  { id: 'prompt', label: 'Prompt', file: 'prompt.md', text: AGENT_PROMPT },
  { id: 'skill', label: 'Skill', file: 'SKILL.md', command: SKILL_INSTALL_COMMAND, text: SKILL_MD, download: SKILL_PATH },
  { id: 'mcp', label: 'MCP', file: 'mcp.json', command: CLAUDE_CODE_COMMAND, text: MCP_CONFIG }
]

// Coins around BCH: dollars on the inner ring, the other pinned tokens and "any" on the outer one.
const [INNER, OUTER] = [FEATURED_TOKENS.slice(0, 2), FEATURED_TOKENS.slice(2)]

const Logo = ({ src, size, alt = '' }: { src: string; size: number; alt?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt={alt} width={size} height={size} loading="lazy" />
)

const Coin = ({ icon, ticker, angle }: { icon?: string; ticker: string; angle: number }) => (
  <span className="orbit-item" style={{ '--a': `${angle}deg` } as React.CSSProperties}>
    <span className="orbit-coin" data-initial={icon ? undefined : ticker} title={ticker}>
      {icon && <Logo src={icon} size={48} />}
    </span>
  </span>
)

export default function Page() {
  return (
    <div className="landing">
      <BlazeBanner />

      <SiteHeader />

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>
              Bridge anything to <em>Bitcoin Cash</em>.
            </h1>
            <p className="landing-lead">From any chain to any CashToken. And back.</p>
            <div className="landing-actions">
              <Link href="/bridge" className="landing-button">
                Launch app <ArrowRight size={18} aria-hidden />
              </Link>
              <a href="#how" className="landing-button landing-button-ghost">
                How it works
              </a>
            </div>
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
          <Marquee label="Source chains">
            {CHAINS.map(([icon, name]) => (
              <li key={icon} className="landing-chain" title={name}>
                <Logo src={`/networks/${icon}.svg`} size={44} alt={name} />
              </li>
            ))}
          </Marquee>
        </section>

        <section id="how" className="landing-section" aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <BeamDiagram
            chains={CHAINS.slice(0, 5).map(([icon, name]) => ({ name, icon: `/networks/${icon}.svg` }))}
            more={CHAINS.length - 5}
            routes={ROUTES}
            tokens={[
              { name: 'BCH', icon: '/networks/bch.svg' },
              ...FEATURED_TOKENS.slice(0, 3).map(token => ({ name: token.ticker, icon: token.icon })),
              { name: 'Any CashToken' }
            ]}
          />
          <ul className="landing-points">
            <li>
              <KeyRound size={18} aria-hidden /> Your keys never leave your wallet
            </li>
            <li>
              <Globe size={18} aria-hidden /> THORChain, NEAR Intents and ShapeShift
            </li>
            <li>
              <FileLock2 size={18} aria-hidden /> Router orders settle in a CashScript covenant
            </li>
          </ul>
        </section>

        <section id="router" className="landing-section" aria-labelledby="router-title">
          <div className="landing-split">
            <LandingVideo
              className="landing-router-video"
              src="/landing/cashbridge-router.mp4"
              poster="/landing/cashbridge-router.webp"
              label="Turning on the Cashbridge Router in the bridge form. Demo."
            />
            <div>
              <p className="landing-kicker">Cashbridge Router</p>
              <h2 id="router-title">One signature. Settled by contract.</h2>
              <ul className="landing-points landing-points-stacked">
                <li>
                  <PenLine size={18} aria-hidden /> Sign once on the source chain
                </li>
                <li>
                  <Undo2 size={18} aria-hidden /> A fixed minimum, or the BCH comes back to you
                </li>
                <li>
                  <FileLock2 size={18} aria-hidden /> Per-order P2SH covenant — pay you or refund you
                </li>
              </ul>
              <div className="landing-links">
                <Link href="/docs/guides/cashbridge-router" className="landing-more">
                  How the Router works <ArrowRight size={16} aria-hidden />
                </Link>
                <Link href="/docs/security" className="landing-more">
                  Security and custody <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="tokens" className="landing-section landing-split landing-tokens" aria-labelledby="tokens-title">
          <div>
            <p className="landing-kicker">Tokens</p>
            <h2 id="tokens-title">Any CashToken on Cauldron.</h2>
          </div>
          <InView className="orbit" role="img" aria-label={`BCH, ${FEATURED_TOKENS.map(token => token.ticker).join(', ')} and every other token on Cauldron`}>
            <span className="orbit-core">
              <Logo src="/networks/bch.svg" size={72} />
            </span>
            <div className="orbit-ring" style={{ '--r': '25cqw' } as React.CSSProperties}>
              {INNER.map((token, i) => (
                <Coin key={token.category} icon={token.icon} ticker={token.ticker} angle={(360 / INNER.length) * i} />
              ))}
            </div>
            <div className="orbit-ring orbit-ring-outer" style={{ '--r': '42cqw' } as React.CSSProperties}>
              {OUTER.map((token, i) => (
                <Coin key={token.category} icon={token.icon} ticker={token.ticker} angle={45 + (360 / (OUTER.length + 1)) * i} />
              ))}
              <Coin ticker="+" angle={45 + (360 / (OUTER.length + 1)) * OUTER.length} />
            </div>
          </InView>
        </section>

        <section id="agents" className="landing-section landing-split landing-agents" aria-labelledby="agents-title">
          <div className="landing-agents-copy">
            <p className="landing-kicker">For agents</p>
            <h2 id="agents-title">Bridge from your AI agent.</h2>
            <AgentChat />
            <Link href="/docs/agents" className="landing-more">
              Agent docs <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
          <AgentKit items={AGENT_KIT} />
        </section>

        <section id="integrations" className="landing-section" aria-labelledby="integrations-title">
          <h2 id="integrations-title" className="landing-kicker">
            Built on
          </h2>
          <ul className="landing-integrations">
            {INTEGRATIONS.filter(item => item.show !== false).map(item => (
              <li key={item.name}>
                <a href={item.href} target="_blank" rel="noopener noreferrer">
                  <span className="landing-mark" data-initial={item.logo ? undefined : item.name.slice(0, 1)}>
                    {item.logo && <Logo src={item.logo} size={32} alt="" />}
                  </span>
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
          <Marquee label="Wallets" reverse>
            {WALLETS.map(([name, icon]) => (
              <li key={name} className="landing-wallet">
                <span className="landing-mark" data-initial={icon ? undefined : name.slice(0, 1)}>
                  {icon && <Logo src={icon} size={22} alt="" />}
                </span>
                {name}
              </li>
            ))}
          </Marquee>
        </section>

        <section id="scanner" className="landing-section" aria-labelledby="scanner-title">
          <LiveTransfers />
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <h2 id="final-title">Bring your assets to Bitcoin Cash.</h2>
          <div className="landing-actions">
            <Link href="/bridge" className="landing-button">
              Launch app <ArrowRight size={18} aria-hidden />
            </Link>
            <Link href="/docs" className="landing-button landing-button-ghost">
              Docs
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
