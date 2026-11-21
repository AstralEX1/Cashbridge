import type { ReactNode } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  Globe,
  Hourglass,
  Lock,
  MonitorSmartphone,
  PenLine,
  ScanSearch,
  Server,
  Undo2,
  User,
  Wallet,
  Zap
} from 'lucide-react'
import { LOGO } from '@/components/docs/route-scenes'

// Still figures for How it works, in HTML so they reflow on a phone: who does what, the two modes, the three bridges,
// where the time goes, what happens when something fails, and where status comes from.

const Logos = ({ srcs, size = 26 }: { srcs: string[]; size?: number }) => (
  <span className="hw-logos">
    {srcs.map(src => (
      <img key={src} src={src} alt="" width={size} height={size} />
    ))}
  </span>
)

function Chip({ logos, icon, title, sub, tone }: { logos?: string[]; icon?: ReactNode; title: string; sub: string; tone?: 'lock' | 'you' }) {
  return (
    <div className="hw-chip" data-tone={tone}>
      {logos ? <Logos srcs={logos} /> : <span className="hw-icon">{icon}</span>}
      <span className="hw-chip-text">
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
    </div>
  )
}

const BRIDGES = [LOGO.thorchain, LOGO.near, LOGO.shapeshift]

// Three layers: your wallets sign, open networks move the money, Cash Bridge builds, checks, reads and settles.
export function LayerMap() {
  return (
    <figure className="hw">
      <div className="hw-layers">
        <section className="hw-layer" aria-label="You">
          <p className="hw-layer-name">
            <User size={14} aria-hidden /> You
          </p>
          <div className="hw-row">
            <Chip logos={['/wallets/metamask.svg', '/wallets/phantom.svg']} title="Your wallet" sub="signs the deposit, once" tone="you" />
            <Chip logos={['/wallets/paytaca.png', '/wallets/selene.png']} title="Your BCH wallet" sub="receives the token" tone="you" />
          </div>
        </section>
        <p className="hw-link">
          <ArrowDown size={15} aria-hidden /> your signature
        </p>
        <section className="hw-layer" data-layer="chain" aria-label="Open networks">
          <p className="hw-layer-name">
            <Globe size={14} aria-hidden /> Open networks
          </p>
          <ol className="hw-path">
            <li>
              <Chip logos={BRIDGES} title="A bridge" sub="pays native BCH" />
            </li>
            <li>
              <Chip icon={<Lock size={20} strokeWidth={2.2} />} title="Order contract" sub="pays you, or pays you back" tone="lock" />
            </li>
            <li>
              <Chip logos={[LOGO.cauldron]} title="Cauldron" sub="BCH to the token" />
            </li>
            <li>
              <Chip logos={[LOGO.pusd]} title="Your token" sub="at your address" tone="you" />
            </li>
          </ol>
        </section>
        <p className="hw-link">
          <ArrowUp size={15} aria-hidden /> reads every step <span aria-hidden>·</span> <ArrowDown size={15} aria-hidden /> settles inside the contract&apos;s rules
        </p>
        <section className="hw-layer" data-layer="us" aria-label="Cash Bridge">
          <p className="hw-layer-name">
            <img src="/icon.svg" alt="" width={14} height={14} /> Cash Bridge
          </p>
          <div className="hw-row">
            <Chip icon={<MonitorSmartphone size={20} />} title="This page" sub="quotes, builds and checks every step" />
            <Chip icon={<Server size={20} />} title="Cashbridge Router" sub="finishes if you close the tab" />
            <Chip icon={<Activity size={20} />} title="Chain readers" sub="EVM nodes, Fulcrum" />
          </div>
        </section>
      </div>
      <figcaption>
        With the Cashbridge Router. Cash Bridge never sees a private key and never holds the bridge leg: your wallet signs, and the keys of the page and the Router can
        only move a contract&apos;s coins to you. In Manual mode your BCH wallet signs the Cauldron trade itself and there is no contract.
      </figcaption>
    </figure>
  )
}

type ModeRow = [icon: ReactNode, label: string, value: ReactNode]

const pens = (n: number) => (
  <span className="hw-pens" aria-label={`${n} signature${n > 1 ? 's' : ''}`}>
    {Array.from({ length: n }, (_, i) => (
      <PenLine key={i} size={16} aria-hidden />
    ))}
  </span>
)

const MODES: { name: string; tag: string; rows: ModeRow[]; router?: boolean }[] = [
  {
    name: 'Manual',
    tag: 'default',
    rows: [
      [pens(2), 'Signatures', 'the deposit, then the trade (one for plain BCH)'],
      [<Wallet key="w" size={18} />, 'BCH waits in', 'your wallet'],
      [<Wallet key="b" size={18} />, 'BCH wallet', 'connected, to sign the trade'],
      [<Hourglass key="h" size={18} />, 'Tab closed', 'the bridge finishes; the trade waits for you']
    ]
  },
  {
    name: 'Cashbridge Router',
    tag: 'one switch above the form',
    router: true,
    rows: [
      [pens(1), 'Signatures', 'the deposit (plus an approval for some ERC-20s on THORChain)'],
      [<Lock key="l" size={18} />, 'BCH waits in', 'a contract made for your order'],
      [<Wallet key="b" size={18} />, 'BCH wallet', 'optional going in: paste an address'],
      [<Check key="c" size={18} />, 'Tab closed', 'the Router finishes the order']
    ]
  }
]

export function ModeCompare() {
  return (
    <figure className="hw">
      <div className="hw-modes">
        {MODES.map(mode => (
          <section key={mode.name} className="hw-mode" data-router={mode.router}>
            <header>
              <strong>{mode.name}</strong>
              <span>{mode.tag}</span>
            </header>
            <dl>
              {mode.rows.map(([icon, label, value]) => (
                <div key={label}>
                  <dt>
                    <span className="hw-mode-icon">{icon}</span>
                    {label}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <figcaption>
        Either way the bridge, the contract and the trade are separate on-chain steps, not one atomic swap. In Manual mode Confirm labels them{' '}
        <strong>1/2 Bridge</strong> and <strong>2/2 Swap</strong>, and the trade is quoted again on the BCH that actually arrived. The choice of mode is remembered.
      </figcaption>
    </figure>
  )
}

const BRIDGE_CARDS: { name: string; logo: string; href: string; rows: [string, string][] }[] = [
  {
    name: 'THORChain',
    logo: LOGO.thorchain,
    href: 'https://thorchain.org',
    rows: [
      ['You send', 'to a vault, with a memo naming the BCH address'],
      ['Paid by', 'its liquidity pools'],
      ['If it fails', 'refund to the sender'],
      ['Router', 'both ways']
    ]
  },
  {
    name: 'NEAR Intents',
    logo: LOGO.near,
    href: 'https://docs.near-intents.org',
    rows: [
      ['You send', 'a plain transfer to a one-use address'],
      ['Paid by', 'market makers, through 1Click'],
      ['If it fails', 'refund to your wallet'],
      ['Router', 'both ways']
    ]
  },
  {
    name: 'ShapeShift',
    logo: LOGO.shapeshift,
    href: 'https://shapeshift.com',
    rows: [
      ['You send', 'a plain transfer to a one-use address'],
      ['Paid by', 'NEAR Intents underneath, checked at 1Click first'],
      ['If it fails', 'refund to your wallet, later than NEAR'],
      ['Router', 'both ways; an exact-amount sale going out']
    ]
  }
]

export function BridgeCards() {
  return (
    <div className="hw-bridges">
      {BRIDGE_CARDS.map(bridge => (
        <section key={bridge.name} className="hw-bridge">
          <a href={bridge.href} target="_blank" rel="noopener noreferrer" className="hw-bridge-name hw-plain">
            <img src={bridge.logo} alt="" width={30} height={30} />
            {bridge.name}
          </a>
          <dl>
            {bridge.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

const LEGS: { icon: ReactNode; label: string; time: string; grow: number; tone?: 'bridge' | 'done' }[] = [
  { icon: <Zap size={16} />, label: 'Quotes', time: 'seconds', grow: 1 },
  { icon: <PenLine size={16} />, label: 'You sign', time: 'your pace', grow: 1 },
  { icon: <Globe size={16} />, label: 'The bridge', time: 'minutes, most of the wait', grow: 4, tone: 'bridge' },
  { icon: <img src={LOGO.cauldron} alt="" width={16} height={16} />, label: 'Cauldron', time: 'seconds', grow: 1 },
  { icon: <Check size={16} />, label: 'Done', time: 'in the mempool', grow: 1, tone: 'done' }
]

export function TimeStrip() {
  return (
    <figure className="hw">
      <ol className="hw-time">
        {LEGS.map(leg => (
          <li key={leg.label} style={{ flexGrow: leg.grow }} data-tone={leg.tone}>
            <span className="hw-time-bar" />
            <span className="hw-time-label">
              {leg.icon} {leg.label}
            </span>
            <span className="hw-time-when">
              <Clock size={12} aria-hidden /> {leg.time}
            </span>
          </li>
        ))}
      </ol>
      <figcaption>
        Confirm shows an estimate for each step; a first transfer commonly takes a few minutes, nearly all of it on the bridge. A transfer counts as done once its
        payout is in the network: nothing waits for confirmations, and the token is bought as soon as the bridge&apos;s BCH reaches the mempool.
      </figcaption>
    </figure>
  )
}

const CASES: [ReactNode, string, ReactNode][] = [
  [
    <Undo2 key="p" size={18} />,
    'No trade pays your minimum',
    <>
      Router: the BCH goes back to your fallback address. Manual: you don&apos;t sign, and the BCH stays in your wallet.
    </>
  ],
  [<Globe key="b" size={18} />, 'The bridge cannot fill', <>The bridge refunds the source asset: THORChain to the sender, NEAR Intents and ShapeShift to your wallet.</>],
  [<MonitorSmartphone key="t" size={18} />, 'You close the tab', <>Router: it finishes the order. Manual: the bridge still pays; the trade waits for you.</>],
  [
    <Server key="r" size={18} />,
    'The Router is down',
    <>
      Once the refund time passes (set about three hours after the order), anyone can send the coins back to you with the contract&apos;s <code>expire</code>; your
      page does it for a sale it started.
    </>
  ]
]

export function WhenItFails() {
  return (
    <ul className="hw-cases">
      {CASES.map(([icon, when, then]) => (
        <li key={when}>
          <span className="hw-case-icon">{icon}</span>
          <strong>{when}</strong>
          <ArrowRight size={16} className="hw-case-arrow" aria-hidden />
          <span>{then}</span>
        </li>
      ))}
    </ul>
  )
}

export function StatusMap() {
  return (
    <figure className="hw">
      <div className="hw-status">
        <ul aria-label="Sources">
          <li>
            <img src={LOGO.base} alt="" width={22} height={22} /> EVM nodes
          </li>
          <li>
            <img src="/integrations/fulcrum.svg" alt="" width={22} height={22} /> Fulcrum servers (BCH)
          </li>
          <li data-fallback>
            <Logos srcs={[LOGO.thorchain, LOGO.near]} size={20} /> Bridge status, for gaps like refunds
          </li>
        </ul>
        <ArrowRight size={20} className="hw-status-arrow" aria-hidden />
        <ul aria-label="Where you see it">
          <li>
            <MonitorSmartphone size={20} aria-hidden /> Your transfer screen
          </li>
          <li>
            <ScanSearch size={20} aria-hidden /> The scanner, from any device
          </li>
        </ul>
      </div>
      <figcaption>
        Each step is read from the chain it happens on. Bridge status pages only fill gaps, so a slow one never holds a verified step back.
      </figcaption>
    </figure>
  )
}

const BLOCKS: [name: string, logo: string, href: string, line: string][] = [
  ['WalletConnect', '/wallets/walletconnect.svg', 'https://walletconnect.network', 'Your EVM, Solana and other wallets'],
  ['WizardConnect', '/integrations/wizardconnect.png', 'https://docs.riftenlabs.com/wizardconnect/dapp', 'Your Bitcoin Cash wallet'],
  ['THORChain', LOGO.thorchain, 'https://thorchain.org', 'Native swaps through liquidity pools'],
  ['NEAR Intents', LOGO.near, 'https://docs.near-intents.org', 'Market makers through 1Click'],
  ['ShapeShift', LOGO.shapeshift, 'https://shapeshift.com', 'Public swap API, NEAR Intents underneath'],
  ['Cauldron', LOGO.cauldron, 'https://cauldron.quest', 'On-chain market for BCH and CashTokens, live pools'],
  ['Fulcrum', '/integrations/fulcrum.svg', 'https://github.com/cculianu/Fulcrum', 'Reads and broadcasts on Bitcoin Cash'],
  ['CashScript', '/networks/bch.svg', 'https://cashscript.org', 'The language of the order contracts']
]

export function BuiltOn() {
  return (
    <ul className="hw-blocks">
      {BLOCKS.map(([name, logo, href, line]) => (
        <li key={name}>
          <a href={href} target="_blank" rel="noopener noreferrer" className="hw-plain">
            <img src={logo} alt="" width={28} height={28} />
            <strong>{name}</strong>
            <span>{line}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
