import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, Check, Clock, KeyRound, Lock, Users } from 'lucide-react'

// Still figures for the smart-contract docs, in HTML so they reflow on a phone: the ways a coin can leave a contract,
// how an order's terms become its address, who may act when, and which outputs a transaction's checks cover.

type Who = 'keys' | 'router' | 'anyone'
export type Exit = { fn: string; who: Who; when: string; logo?: string; result: string; detail: string; tone: 'pay' | 'back' | 'loop' | 'bridge' }

const WHO: Record<Who, [typeof KeyRound, string]> = {
  keys: [KeyRound, 'your page or the Router'],
  router: [KeyRound, 'the Cashbridge Router'],
  anyone: [Users, 'anyone']
}

export function ExitMap({ input, title, sub, exits, caption }: { input: { logo: string; label: string; sub: string }; title: string; sub: string; exits: Exit[]; caption: ReactNode }) {
  return (
    <figure className="xm">
      <div className="xm-grid">
        <div className="xm-in">
          <img src={input.logo} alt="" width={30} height={30} />
          <strong>{input.label}</strong>
          <span>{input.sub}</span>
        </div>
        <div className="xm-lock">
          <span className="xm-lock-icon">
            <Lock size={26} strokeWidth={2.2} aria-hidden />
          </span>
          <strong>{title}</strong>
          <span>{sub}</span>
        </div>
        <ul className="xm-out" aria-label={`Every way out of the ${title.toLowerCase()}`}>
          {exits.map(exit => {
            const [Icon, who] = WHO[exit.who]
            return (
              <li key={exit.fn} data-tone={exit.tone}>
                <code>{exit.fn}</code>
                <div className="xm-result">
                  {exit.logo && <img src={exit.logo} alt="" width={22} height={22} />}
                  <div>
                    <strong>{exit.result}</strong>
                    <span>{exit.detail}</span>
                  </div>
                </div>
                <div className="xm-meta">
                  <span>
                    <Icon size={14} aria-hidden /> {who}
                  </span>
                  <span>
                    <Clock size={14} aria-hidden /> {exit.when}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

const TERMS: [string, [string, string][]][] = [
  [
    'Who may sign',
    [
      ['router', "the Router's key for this order"],
      ['page', "your page's one-use key"]
    ]
  ],
  [
    'Where it may pay',
    [
      ['payoutLock', 'your token address'],
      ['fallbackLock', 'your BCH fallback']
    ]
  ],
  [
    'What it must pay',
    [
      ['token', 'the token category'],
      ['minTokens', 'the quoted minimum'],
      ['quotedSats', 'the BCH it was quoted for']
    ]
  ],
  ['When anyone may refund', [['refundTime', 'about 3 h after the order']]]
]

export function TermsMap() {
  return (
    <figure className="tm">
      <div className="tm-flow">
        <div className="tm-terms">
          {TERMS.map(([title, terms]) => (
            <div key={title} className="tm-group">
              <p>{title}</p>
              {terms.map(([name, meaning]) => (
                <span key={name} className="tm-chip">
                  <code>{name}</code>
                  {meaning}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="tm-hash" aria-hidden>
          <ArrowRight size={18} className="tm-wide" />
          <ArrowDown size={18} className="tm-tall" />
          <code>hash160</code>
        </div>
        <div className="tm-addr">
          <span className="xm-lock-icon">
            <Lock size={22} strokeWidth={2.2} aria-hidden />
          </span>
          <code>bitcoincash:p…</code>
          <span>the order&apos;s deposit address</span>
          <p className="tm-check">
            <Check size={16} aria-hidden /> Your page rebuilds it from the order&apos;s terms and refuses any other address.
          </p>
        </div>
      </div>
      <figcaption>
        The terms are written into the contract&apos;s script, and the address is the hash of that script. Change one term (a payout address, the minimum, a
        key) and the address changes, so a deposit address that matches is proof of the terms.
      </figcaption>
    </figure>
  )
}

type Lane = { who: string; icon: typeof KeyRound; bars: { from: number; to: number; when: string; label: string; tone: 'first' | 'main' | 'anyone' }[] }

const LANES: Lane[] = [
  {
    who: 'Your page',
    icon: KeyRound,
    bars: [
      { from: 1, to: 2, when: 'first 12 s', label: 'trades first', tone: 'first' },
      { from: 2, to: 3, when: 'until the refund time', label: 'convert or giveBack', tone: 'main' }
    ]
  },
  { who: 'Cashbridge Router', icon: KeyRound, bars: [{ from: 2, to: 3, when: 'after 12 s', label: 'finishes what the page did not', tone: 'main' }] },
  { who: 'Anyone', icon: Users, bars: [{ from: 3, to: 4, when: 'after the refund time', label: 'expire: BCH back to you', tone: 'anyone' }] }
]

export function KeyTimeline() {
  return (
    <figure className="kt">
      <div className="kt-grid" role="table" aria-label="Who may spend an order contract's BCH, and when">
        <div role="row" className="kt-head">
          <span role="columnheader" />
          <span role="columnheader">BCH lands</span>
          <span role="columnheader">after 12 s</span>
          <span role="columnheader">after the refund time (≈3 h)</span>
        </div>
        {LANES.map(lane => (
          <div role="row" key={lane.who} className="kt-row">
            <span role="rowheader" className="kt-who">
              <lane.icon size={15} aria-hidden /> {lane.who}
            </span>
            {lane.bars.map(bar => (
              <span role="cell" key={bar.label} className="kt-bar" data-tone={bar.tone} style={{ gridColumn: `${bar.from + 1} / ${bar.to + 1}` }}>
                <small className="kt-when">{bar.when}: </small>
                {bar.label}
              </span>
            ))}
          </div>
        ))}
      </div>
      <figcaption>
        The page settles the moment the BCH lands; the Router waits 12 seconds for it, then settles whatever is left, tab open or not. Neither{' '}
        <code>convert</code> nor <code>giveBack</code> has a clock in the contract: the Router stops trying to buy at the order&apos;s deadline and sends the BCH back.
        Once the chain&apos;s median time passes the refund time, <code>expire</code> lets anyone do the same.
      </figcaption>
    </figure>
  )
}

export type TxSlot = { label: string; sub?: string; tone: 'contract' | 'pool' | 'you' | 'free' | 'memo' | 'bridge'; logo?: string }

export function TxAnatomy({ title, rows, caption }: { title: string; rows: { in?: TxSlot; out?: TxSlot; checked?: boolean }[]; caption: ReactNode }) {
  const slot = (side: 'in' | 'out', item?: TxSlot) =>
    item ? (
      <div className="tx-slot" data-tone={item.tone}>
        {item.logo && <img src={item.logo} alt="" width={20} height={20} />}
        <div>
          <strong>{item.label}</strong>
          {item.sub && <span>{item.sub}</span>}
        </div>
      </div>
    ) : (
      <div className="tx-slot tx-empty" aria-label={`no ${side === 'in' ? 'input' : 'output'}`} />
    )
  return (
    <figure className="tx">
      <p className="tx-title">{title}</p>
      <div className="tx-grid">
        <div className="tx-head" aria-hidden>
          <span>Inputs</span>
          <span>Outputs</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="tx-row" data-checked={!!row.checked}>
            <span className="tx-i">{i}</span>
            {slot('in', row.in)}
            <span className="tx-link" aria-hidden>
              {row.checked ? <Check size={15} /> : <ArrowRight size={15} />}
            </span>
            <span className="tx-i">{i}</span>
            {slot('out', row.out)}
          </div>
        ))}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

export type SpecFn = { name: string; checks: string[]; pays: string; tone: 'pay' | 'back' | 'loop' | 'bridge' }

// A contract for developers: its constructor and, per function, the checks the script makes and where the coin goes.
export function ContractSpec({ name, params, fns, caption }: { name: string; params: string[]; fns: SpecFn[]; caption: ReactNode }) {
  return (
    <figure className="cs">
      <div className="cs-card">
        <p className="cs-sig">
          <code>
            contract <b>{name}</b>(
          </code>
          {params.map(param => (
            <code key={param} className="cs-param">
              {param}
            </code>
          ))}
          <code>)</code>
        </p>
        <div className="cs-fns" data-count={fns.length}>
          {fns.map(fn => (
            <section key={fn.name} className="cs-fn" data-tone={fn.tone}>
              <code className="cs-name">{fn.name}</code>
              <ul>
                {fn.checks.map(check => (
                  <li key={check}>
                    <code>{check}</code>
                  </li>
                ))}
              </ul>
              <p className="cs-pays">
                <ArrowRight size={14} aria-hidden /> {fn.pays}
              </p>
            </section>
          ))}
        </div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}
