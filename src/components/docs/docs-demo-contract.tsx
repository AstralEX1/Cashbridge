'use client'

import { useEffect, useId, useState } from 'react'

type Kind = 'purchase' | 'sale'

type Step = {
  id: string
  title: string
  detail: string
  onChain: string
  offChain: string
}

const PURCHASE: Step[] = [
  {
    id: 'deposit',
    title: 'Source deposit',
    detail:
      'You sign once in the source wallet. THORChain (vault + memo) or NEAR Intents (plain one-use address) carries value toward Bitcoin Cash. There is no Cashbridge covenant on the NEAR source leg.',
    onChain: 'Source-chain transfer to bridge vault / deposit address',
    offChain: 'Router tracks status; it never holds your source keys'
  },
  {
    id: 'utxo',
    title: 'Purchase contract UTXO',
    detail:
      'Native BCH lands at a P2SH20 address rebuilt from your order terms (apiVersion=2 purchase covenant). The browser refuses any other deposit address.',
    onChain: 'Contract locks BCH to convert · giveBack · expire',
    offChain: 'Router may act only until refundAfter (three hours from creation)'
  },
  {
    id: 'convert',
    title: 'Convert (Cauldron payout)',
    detail:
      'Router-signed convert spends the covenant into a Cauldron trade that pays your recipient at least the quoted minimum of the CashToken.',
    onChain: 'convert path enforces min token + recipient',
    offChain: 'Router builds and signs the trade; it cannot send BCH elsewhere'
  },
  {
    id: 'refund',
    title: 'Refund / expire',
    detail:
      'If the minimum cannot be met, giveBack returns BCH to your fallback (≤ 2,000 sats miner fee). After refundAfter, anyone may expire on the same terms. Legacy P2PKH rows are temporary service custody — not this covenant.',
    onChain: 'giveBack (Router) or expire (anyone after refundAfter)',
    offChain: 'Legacy P2PKH proof ≠ contract settlement'
  }
]

const SALE: Step[] = [
  {
    id: 'send',
    title: 'Token into sale',
    detail:
      'Your BCH wallet sends the CashToken into a per-order sale covenant. Sales stay on THORChain — NEAR is not used for Router reverse.',
    onChain: 'Token UTXO locked to sell · return · expire',
    offChain: 'You sign once; Router never holds your BCH wallet keys'
  },
  {
    id: 'sale-utxo',
    title: 'Sale contract UTXO',
    detail:
      'apiVersion=2 sale terms fix the minimum BCH, THORChain memo destination, and refundAfter. The page rebuilds the script and checks the deposit address.',
    onChain: 'P2SH sale covenant holds the token',
    offChain: 'Router verifies the deposit before acting'
  },
  {
    id: 'sell',
    title: 'Sell + THOR deposit',
    detail:
      'The Router may sell for at least the quoted minimum BCH and deposit that BCH to THORChain with the fixed memo, so the destination asset pays out on the other chain.',
    onChain: 'sell path enforces min BCH + fixed memo',
    offChain: 'Router builds Cauldron sale + THOR deposit under those rules'
  },
  {
    id: 'return',
    title: 'Return / expire',
    detail:
      'If the minimum cannot be met, the covenant returns the tokens. After refundAfter (three hours from creation), anyone may return them on the same terms.',
    onChain: 'return (Router) or expire (anyone after refundAfter)',
    offChain: 'No alternate destinations outside the sale script'
  }
]

const LABELS: Record<Kind, string> = {
  purchase: 'Purchase (forward)',
  sale: 'Sale (reverse · THOR)'
}

export function DocsDemoContract() {
  const labelId = useId()
  const [kind, setKind] = useState<Kind>('purchase')
  const [step, setStep] = useState(0)
  const [reduced, setReduced] = useState(false)
  const steps = kind === 'purchase' ? PURCHASE : SALE
  const current = steps[step]

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const selectKind = (next: Kind) => {
    setKind(next)
    setStep(0)
  }

  const progress = ((step + 1) / steps.length) * 100

  return (
    <section className="docs-demo" aria-labelledby={labelId}>
      <header className="docs-demo-head">
        <div>
          <p className="docs-demo-kicker">Interactive demo</p>
          <h3 id={labelId}>Contract order schematic</h3>
          <p>
            Step through an <code>apiVersion=2</code> covenant. On-chain paths are fixed; the Router service only chooses when to act.
          </p>
        </div>
        <div className="docs-demo-controls" role="group" aria-label="Contract demo controls">
          <button type="button" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} aria-label="Previous stage">
            ←
          </button>
          <span>
            {step + 1} / {steps.length}
          </span>
          <button type="button" onClick={() => setStep(s => Math.min(steps.length - 1, s + 1))} disabled={step === steps.length - 1} aria-label="Next stage">
            →
          </button>
        </div>
      </header>

      <div className="docs-demo-filters">
        <div className="docs-demo-filter" role="group" aria-label="Covenant kind">
          <span>Covenant</span>
          {(['purchase', 'sale'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              className={kind === option ? 'is-active' : undefined}
              onClick={() => selectKind(option)}
            >
              {LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="docs-demo-schematic" data-reduced={reduced ? 'true' : undefined} data-kind={kind}>
        <div className="docs-demo-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <svg viewBox="0 0 640 188" role="img" aria-label={`${LABELS[kind]} stages`}>
          <defs>
            <linearGradient id="docs-contract-rail" x1="0" x2="1">
              <stop offset="0%" stopColor="#0ac18e" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#0ac18e" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <path d="M48 72 H390" stroke="url(#docs-contract-rail)" strokeWidth="3" fill="none" />
          <path
            d="M390 72 C430 72 450 48 500 48 H590"
            stroke={step >= 2 ? '#0ac18e' : '#ffffff22'}
            strokeWidth="2"
            fill="none"
            strokeDasharray={step === 2 ? undefined : '4 6'}
          />
          <path
            d="M390 72 C430 72 450 104 500 104 H590"
            stroke={step >= 3 ? '#f0b44c' : '#ffffff22'}
            strokeWidth="2"
            fill="none"
            strokeDasharray={step === 3 ? undefined : '4 6'}
          />
          <text x="598" y="52" fill="#3fe0b4" fontSize="11" textAnchor="end">
            {kind === 'purchase' ? 'convert' : 'sell'}
          </text>
          <text x="598" y="108" fill="#f0b44c" fontSize="11" textAnchor="end">
            {kind === 'purchase' ? 'giveBack / expire' : 'return / expire'}
          </text>
          {steps.slice(0, 2).map((item, i) => {
            const x = 70 + i * 160
            const active = i === step
            const done = i < step
            return (
              <g key={item.id} className="docs-demo-schematic-node">
                <circle
                  cx={x}
                  cy={72}
                  r={active ? 20 : 15}
                  fill={active ? '#0ac18e' : done ? '#0ac18e66' : '#0ac18e28'}
                  stroke="#3fe0b4"
                  strokeWidth="2"
                  tabIndex={0}
                  role="button"
                  aria-label={item.title}
                  aria-current={active ? 'step' : undefined}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setStep(i)}
                  onClick={() => setStep(i)}
                  onFocus={() => setStep(i)}
                  style={{ cursor: 'pointer' }}
                />
                <text x={x} y={76} textAnchor="middle" fill={active ? '#04110c' : '#eaf3f5'} fontSize="12" fontWeight="700" style={{ pointerEvents: 'none' }}>
                  {i + 1}
                </text>
                <text x={x} y={118} textAnchor="middle" fill="#a6b9c0" fontSize="11">
                  {item.title}
                </text>
              </g>
            )
          })}
          <circle cx={390} cy={72} r={step < 2 ? 10 : 12} fill={step >= 2 ? '#0ac18e88' : '#ffffff18'} stroke="#3fe0b4" strokeWidth="2" />
          {steps.slice(2).map((item, i) => {
            const index = i + 2
            const x = 520
            const y = i === 0 ? 48 : 104
            const active = index === step
            const color = i === 0 ? '#0ac18e' : '#f0b44c'
            const stroke = i === 0 ? '#3fe0b4' : '#f0b44c'
            return (
              <g key={item.id} className="docs-demo-schematic-node">
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 18 : 13}
                  fill={active ? color : `${color}33`}
                  stroke={stroke}
                  strokeWidth="2"
                  tabIndex={0}
                  role="button"
                  aria-label={item.title}
                  aria-current={active ? 'step' : undefined}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setStep(index)}
                  onClick={() => setStep(index)}
                  onFocus={() => setStep(index)}
                  style={{ cursor: 'pointer' }}
                />
                <text x={x} y={y + 4} textAnchor="middle" fill={active ? '#04110c' : '#eaf3f5'} fontSize="11" fontWeight="700" style={{ pointerEvents: 'none' }}>
                  {index + 1}
                </text>
              </g>
            )
          })}
        </svg>

        <ol className="docs-demo-rail" aria-label="Contract stages">
          {steps.map((item, i) => (
            <li key={item.id}>
              <button type="button" className={i === step ? 'is-active' : undefined} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
                <span className="docs-demo-rail-index">{i + 1}</span>
                <span className="docs-demo-rail-label">{item.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="docs-demo-schematic-panel" key={`${kind}-${step}`}>
          <strong>{current.title}</strong>
          <p>{current.detail}</p>
          <dl className="docs-demo-split">
            <div>
              <dt>On-chain contract</dt>
              <dd>{current.onChain}</dd>
            </div>
            <div>
              <dt>Off-chain Router service</dt>
              <dd>{current.offChain}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
