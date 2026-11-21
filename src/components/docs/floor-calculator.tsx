'use client'

import { useId, useState } from 'react'
import { coinFloor, MIN_ORDER_COIN_SATS } from '@/lib/router-contract'

// Drag the BCH that reached an order contract and see what the contract demands for it, with the same rules the page
// and the Router use (coinFloor, settlingCoin). Example terms: 0.025 BCH quoted for at least 4.90 PUSD.
const QUOTED_SATS = 2_500_000n
const MIN_CENTS = 490n
const TERMS = { version: 2 as const, minPusd: MIN_CENTS.toString(), quotedSats: QUOTED_SATS.toString() }

const bch = (sats: bigint) => (Number(sats) / 1e8).toFixed(4)
const pusd = (cents: bigint) => (Number(cents) / 100).toFixed(2)

export function FloorCalculator() {
  const id = useId()
  const [sats, setSats] = useState(2_400_000)
  const value = BigInt(sats)
  const floor = coinFloor(TERMS, value)
  const dust = value < MIN_ORDER_COIN_SATS
  const small = !dust && 2n * value < QUOTED_SATS
  const share = Number((floor * 100n) / MIN_CENTS)

  return (
    <figure className="fc">
      <div className="fc-head">
        <label htmlFor={id}>BCH that reached the contract</label>
        <output htmlFor={id} className="fc-value">
          {bch(value)} BCH
        </output>
      </div>
      <input id={id} type="range" min={0} max={3_000_000} step={50_000} value={sats} onChange={event => setSats(Number(event.target.value))} />
      <div className="fc-scale" aria-hidden>
        <span>0</span>
        <span>half the quote · 0.0125</span>
        <span>quoted · 0.025</span>
      </div>
      {dust || small ? (
        <p className="fc-verdict" data-tone="back">
          {dust
            ? 'Dust under 1,000 sats: the contract ignores it.'
            : 'Under half the quote, so not this order’s coin: it cannot settle the order, and goes back to you as BCH once the order is done.'}
        </p>
      ) : (
        <div className="fc-verdict" data-tone="pay">
          <div className="fc-bar" aria-hidden>
            <span style={{ width: `${share}%` }} />
          </div>
          <p>
            The trade must pay you at least <strong>{pusd(floor)} PUSD</strong>
            {floor < MIN_CENTS ? `, this coin’s share of the 4.90 minimum` : ', the full minimum, however much more BCH came'}. If no pool pays that, the BCH goes back to you.
          </p>
        </div>
      )}
      <figcaption>
        <code>floor = min(coin × minTokens ÷ quotedSats, minTokens)</code>. Example terms: 0.025 BCH quoted for at least 4.90 PUSD. A bridge that pays a little less
        than quoted still gets its token, at a proportionally lower floor.
      </figcaption>
    </figure>
  )
}
