'use client'

import { useId, useState } from 'react'
import { NearMark, ThorchainMark } from '@/components/swap/bridge-marks'

const SAMPLE = {
  sell: '25 USDC',
  sellChain: 'Base',
  receive: 'PUSD',
  receiveChain: 'Bitcoin Cash',
  thorchain: {
    out: '24.61 PUSD',
    minutes: '~4 min',
    deposit: 'Vault + memo → order or wallet',
    best: false
  },
  near: {
    out: '24.74 PUSD',
    minutes: '~3 min',
    deposit: 'Plain one-use address · no memo',
    best: true
  }
} as const

export function DocsDemoQuotes() {
  const labelId = useId()
  const [choice, setChoice] = useState<'thorchain' | 'near'>('near')
  const selected = SAMPLE[choice]

  return (
    <section className="docs-demo docs-demo-quotes" aria-labelledby={labelId}>
      <header className="docs-demo-head">
        <div>
          <p className="docs-demo-kicker">Interactive demo</p>
          <h3 id={labelId}>Quote compare</h3>
          <p>
            Sample numbers only — same chrome as the live form: when both bridges quote, Cash Bridge shows them side by side and defaults to the better output. You can pick the other.
          </p>
        </div>
      </header>

      <div className="docs-demo-quote-shell">
        <div className="docs-demo-quote-pair" aria-hidden="true">
          <div>
            <span className="docs-demo-quote-label">You send</span>
            <strong>
              {SAMPLE.sell} <span>on {SAMPLE.sellChain}</span>
            </strong>
          </div>
          <span className="docs-demo-quote-arrow" aria-hidden="true">
            →
          </span>
          <div>
            <span className="docs-demo-quote-label">You receive</span>
            <strong>
              {SAMPLE.receive} <span>on {SAMPLE.receiveChain}</span>
            </strong>
          </div>
        </div>

        <p className="docs-demo-quote-meta">
          Routes compared · defaulting to <strong>Best</strong> output
        </p>

        <div className="docs-demo-routes" role="radiogroup" aria-label="Sample route comparison">
          {(
            [
              { key: 'thorchain' as const, name: 'THORChain', Mark: ThorchainMark, ...SAMPLE.thorchain },
              { key: 'near' as const, name: 'NEAR Intents', Mark: NearMark, ...SAMPLE.near }
            ] as const
          ).map(route => (
            <button
              key={route.key}
              type="button"
              role="radio"
              aria-checked={choice === route.key}
              className={`docs-demo-route${choice === route.key ? ' is-active' : ''}`}
              onClick={() => setChoice(route.key)}
            >
              <route.Mark size={22} />
              <span className="docs-demo-route-name">
                <strong>{route.name}</strong>
                <span>{route.minutes}</span>
              </span>
              <span className="docs-demo-route-amount">
                {route.out}
                {route.best && <span className="docs-demo-route-best">Best</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="docs-demo-quote-foot">
          <p>
            <strong>{choice === 'near' ? 'NEAR Intents' : 'THORChain'}</strong> · {selected.deposit}
          </p>
          <p className="docs-demo-hint">
            {choice === 'near'
              ? 'No Cashbridge contract on the NEAR source leg. For Router forwards, 1Click’s BCH payout targets the order address; the covenant begins only once BCH sits there.'
              : 'Memo names the BCH destination — your wallet in Manual, or the purchase-covenant address for apiVersion=2 Router orders.'}
          </p>
        </div>
      </div>
    </section>
  )
}
