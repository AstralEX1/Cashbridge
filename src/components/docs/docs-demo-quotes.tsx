'use client'

import { useId, useState } from 'react'
import { NearMark, ShapeShiftMark, ThorchainMark } from '@/components/swap/bridge-marks'

type RouteKey = 'thorchain' | 'near' | 'shapeshift'

// Sample numbers only, laid out like the live form's route list.
const ROUTES: { key: RouteKey; name: string; Mark: typeof NearMark; out: string; minutes: string; deposit: string; hint: string }[] = [
  {
    key: 'near',
    name: 'NEAR Intents',
    Mark: NearMark,
    out: '24.74 PUSD',
    minutes: '~3 min',
    deposit: 'Plain transfer to a one-use address, no memo',
    hint: 'With the Cashbridge Router, its BCH goes to the order contract. There is no Cash Bridge contract on the source chain.'
  },
  {
    key: 'shapeshift',
    name: 'ShapeShift',
    Mark: ShapeShiftMark,
    out: '24.70 PUSD',
    minutes: '~3 min',
    deposit: 'Plain transfer to a one-use address, no memo',
    hint: 'Its BCH quotes are NEAR Intents swaps. Before one is used, Cash Bridge reads it at 1Click and requires it to pay your recipient and refund your wallet.'
  },
  {
    key: 'thorchain',
    name: 'THORChain',
    Mark: ThorchainMark,
    out: '24.61 PUSD',
    minutes: '~4 min',
    deposit: 'Vault deposit with a memo',
    hint: 'The memo names the BCH destination: your wallet in Manual, or the order contract with the Cashbridge Router.'
  }
]

export function DocsDemoQuotes() {
  const labelId = useId()
  const [choice, setChoice] = useState<RouteKey>('near')
  const selected = ROUTES.find(route => route.key === choice)!

  return (
    <section className="docs-demo docs-demo-quotes" aria-labelledby={labelId}>
      <header className="docs-demo-head">
        <div>
          <p className="docs-demo-kicker">Sample quotes</p>
          <h3 id={labelId}>Three bridges, one form</h3>
          <p>When more than one bridge quotes, the form lists what each would deliver and takes the best. Pick another to see how its deposit works.</p>
        </div>
      </header>

      <div className="docs-demo-quote-shell">
        <div className="docs-demo-quote-pair" aria-hidden="true">
          <div>
            <span className="docs-demo-quote-label">You send</span>
            <strong>
              25 USDC <span>on Base</span>
            </strong>
          </div>
          <span className="docs-demo-quote-arrow" aria-hidden="true">
            →
          </span>
          <div>
            <span className="docs-demo-quote-label">You receive</span>
            <strong>
              PUSD <span>on Bitcoin Cash</span>
            </strong>
          </div>
        </div>

        <div className="docs-demo-routes" role="radiogroup" aria-label="Sample route comparison">
          {ROUTES.map((route, i) => (
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
                {i === 0 && <span className="docs-demo-route-best">Best</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="docs-demo-quote-foot">
          <p>
            <strong>{selected.name}</strong> · {selected.deposit}
          </p>
          <p className="docs-demo-hint">{selected.hint}</p>
        </div>
      </div>
    </section>
  )
}
