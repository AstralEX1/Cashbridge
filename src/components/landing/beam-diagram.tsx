'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useInView } from './in-view'

export type BeamItem = { icon?: string; name: string }
type Beam = { d: string; stage: number; key: string }
type Direction = 'in' | 'out'

// Seconds between one stage of the route and the next; the loop itself is timed in landing.css.
const STAGE = 0.55
const LAST_STAGE = 3

const Logo = ({ src, size }: { src: string; size: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt="" width={size} height={size} loading="lazy" />
)

// A curve between two node centres, leaving and entering along the diagram's main axis.
const curve = (a: DOMRect, b: DOMRect, box: DOMRect, across: boolean) => {
  const [sx, sy] = [a.left + a.width / 2 - box.left, a.top + a.height / 2 - box.top]
  const [ex, ey] = [b.left + b.width / 2 - box.left, b.top + b.height / 2 - box.top]
  return across
    ? `M ${sx} ${sy} C ${(sx + ex) / 2} ${sy}, ${(sx + ex) / 2} ${ey}, ${ex} ${ey}`
    : `M ${sx} ${sy} C ${sx} ${(sy + ey) / 2}, ${ex} ${(sy + ey) / 2}, ${ex} ${ey}`
}

// How a transfer moves, after Magic UI's Animated Beam (magicui.design/docs/components/animated-beam) and the
// route diagram on hashi.cash: source chains, the cross-chain swap, Bitcoin Cash, Cauldron, then the token.
// Light runs along each link in turn; the arrows switch it to the way back. It loops only while on screen and
// never under reduced motion. Left to right on wide screens, top to bottom on narrow ones.
export function BeamDiagram({ chains, more, routes, tokens }: { chains: BeamItem[]; more: number; routes: BeamItem[]; tokens: BeamItem[] }) {
  const [root, play] = useInView<HTMLDivElement>(0.25)
  const grid = useRef<HTMLDivElement>(null)
  const [beams, setBeams] = useState<Beam[]>([])
  const [direction, setDirection] = useState<Direction>('in')
  const sources = chains.length + (more > 0 ? 1 : 0)

  useEffect(() => {
    const box = grid.current
    if (!box) return
    const edges: [string, string, number][] = [
      ...Array.from({ length: sources }, (_, s) => routes.map((_, r): [string, string, number] => [`src-${s}`, `route-${r}`, 0])).flat(),
      ...routes.map((_, r): [string, string, number] => [`route-${r}`, 'bch', 1]),
      ['bch', 'cauldron', 2],
      ...tokens.map((_, t): [string, string, number] => ['cauldron', `tok-${t}`, 3])
    ]
    const measure = () => {
      const rect = (id: string) => box.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect()
      const frame = box.getBoundingClientRect()
      const [bch, cauldron] = [rect('bch'), rect('cauldron')]
      if (!bch || !cauldron) return
      const across = cauldron.left - bch.left > cauldron.top - bch.top
      setBeams(
        edges.flatMap(([from, to, stage]) => {
          const [a, b] = [rect(from), rect(to)]
          return a && b ? [{ d: curve(a, b, frame, across), stage, key: `${from}>${to}` }] : []
        })
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [sources, routes, tokens])

  return (
    <div className="beam" ref={root} data-play={play} data-direction={direction}>
      <div className="beam-switch" role="group" aria-label="Direction">
        {(
          [
            ['in', 'Into Bitcoin Cash', ArrowRight],
            ['out', 'Back out of Bitcoin Cash', ArrowLeft]
          ] as const
        ).map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={direction === value} aria-label={label} title={label} onClick={() => setDirection(value)}>
            <Icon size={16} aria-hidden />
          </button>
        ))}
      </div>

      <div className="beam-grid" ref={grid}>
        <svg className="beam-svg" aria-hidden>
          {beams.map((beam, i) => (
            <g key={beam.key}>
              <path d={beam.d} className="beam-base" />
              <path
                d={beam.d}
                pathLength={1}
                className="beam-light"
                style={{ '--delay': `${((direction === 'in' ? beam.stage : LAST_STAGE - beam.stage) * STAGE + (i % 4) * 0.07).toFixed(2)}s` } as React.CSSProperties}
              />
            </g>
          ))}
        </svg>

        <ul className="beam-col beam-chains" aria-label="Source chains">
          {chains.map((chain, i) => (
            <li key={chain.name} className="beam-dot" data-node={`src-${i}`} title={chain.name}>
              {chain.icon && <Logo src={chain.icon} size={26} />}
              <span className="sr-only">{chain.name}</span>
            </li>
          ))}
          {more > 0 && (
            <li className="beam-dot beam-more" data-node={`src-${chains.length}`}>
              +{more}
              <span className="sr-only"> more chains</span>
            </li>
          )}
        </ul>

        <ul className="beam-col" aria-label="Cross-chain swap">
          {routes.map((route, i) => (
            <li key={route.name} className="beam-hub" data-node={`route-${i}`}>
              {route.icon && <Logo src={route.icon} size={26} />}
              {route.name}
            </li>
          ))}
        </ul>

        <div className="beam-col">
          <div className="beam-core" data-node="bch" title="Bitcoin Cash">
            <Logo src="/networks/bch.svg" size={52} />
            <span className="sr-only">Bitcoin Cash</span>
          </div>
        </div>

        <div className="beam-col">
          <div className="beam-hub" data-node="cauldron">
            <Logo src="/providers/cauldron.png" size={26} />
            Cauldron
          </div>
        </div>

        <ul className="beam-col beam-chains" aria-label="CashTokens">
          {tokens.map((token, i) => (
            <li key={token.name} className={token.icon ? 'beam-dot' : 'beam-dot beam-more'} data-node={`tok-${i}`} title={token.name}>
              {token.icon ? <Logo src={token.icon} size={30} /> : <span aria-hidden>+</span>}
              <span className="sr-only">{token.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
