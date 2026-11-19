import { Pause, Play } from 'lucide-react'

// Infinite chain strip (Relay/Allbridge style). Duplicated track for a seamless loop;
// a checkbox pause control works without JS (touch/keyboard); reduced motion is a static wrap.
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

function Track() {
  return (
    <ul className="landing-carousel-track" aria-hidden>
      {CHAINS.map(([icon, name]) => (
        <li key={icon}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/networks/${icon}.svg`} alt="" width={28} height={28} loading="lazy" />
          <span>{name}</span>
        </li>
      ))}
    </ul>
  )
}

export function ChainCarousel() {
  return (
    <div className="landing-carousel" aria-label="Supported source chains">
      <div className="landing-carousel-mask">
        <div className="landing-carousel-motion">
          <Track />
          <Track />
        </div>
      </div>
      <label className="landing-carousel-toggle">
        <input type="checkbox" className="landing-carousel-pause" />
        <Pause className="landing-carousel-icon-pause" size={14} aria-hidden />
        <Play className="landing-carousel-icon-play" size={14} aria-hidden />
        <span className="landing-carousel-toggle-label landing-carousel-label-pause">Pause chain carousel</span>
        <span className="landing-carousel-toggle-label landing-carousel-label-play">Play chain carousel</span>
      </label>
      <ul className="sr-only">
        {CHAINS.map(([icon, name]) => (
          <li key={icon}>{name}</li>
        ))}
      </ul>
    </div>
  )
}
