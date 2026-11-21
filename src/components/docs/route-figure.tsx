'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useInView } from '@/components/landing/in-view'

// An animated route: wallets, bridges, contracts and pools as marks with their real logos, and one coin that makes the
// trip leg by leg, changing from USDC to BCH to PUSD as it goes. Drawn twice from the same data, across for wide
// columns and down for narrow ones (docs.css picks one with a container query). It plays only while on screen and
// never under reduced motion, where every leg shows its coin at once.

export type FigNode = {
  id: string
  label: string
  sub?: string
  logo?: string
  // The chain the asset lives on, small at the mark's corner.
  badge?: string
  // Several logos in one mark (any of the three bridges).
  logos?: string[]
  kind: 'wallet' | 'bridge' | 'contract' | 'pool'
  // The user signs here.
  sign?: boolean
  // The chain area the mark sits in; neighbours with the same zone share a tinted box.
  zone?: string
  // Drawn beside this node instead of in the row (the pool a sale contract trades with).
  above?: string
}

export type FigLeg = {
  from: string
  to: string
  // The coin that travels this leg, and what the step list says about it.
  coin?: string
  step?: string
  // A dashed way out that is not animated, with its label (the BCH back to you).
  back?: string
  // A trip out to a side node and back, drawn as a loop.
  loop?: boolean
}

export type Figure = { label: string; nodes: FigNode[]; legs: FigLeg[] }

type Pt = { x: number; y: number }
type Layout = { w: number; h: number; tall: boolean; at: Record<string, Pt>; row: number }

const LEG_SECONDS = 1.5
const MOVE_SECONDS = 1.05
const END_SECONDS = 1.4
const R = 32

function layout(figure: Figure, tall: boolean): Layout {
  const row = figure.nodes.filter(node => !node.above)
  const high = figure.nodes.some(node => node.above) || figure.legs.some(leg => leg.back)
  const at: Record<string, Pt> = {}
  if (tall) {
    row.forEach((node, i) => (at[node.id] = { x: 84, y: 66 + i * 128 }))
    figure.nodes.forEach(node => node.above && (at[node.id] = { x: 330, y: at[node.above].y }))
    return { w: 400, h: 66 + (row.length - 1) * 128 + 82, tall, at, row: 0 }
  }
  const y = high ? 180 : 92
  const gap = (900 - 100) / Math.max(1, row.length - 1)
  row.forEach((node, i) => (at[node.id] = { x: 100 + i * gap, y }))
  // A side node sits up and to the right of its anchor, clear of the dashed way back that leaves to the left.
  figure.nodes.forEach(node => node.above && (at[node.id] = { x: at[node.above].x + gap * 0.4, y: 74 }))
  return { w: 1000, h: y + 110, tall, at, row: y }
}

const toward = (p: Pt, c: Pt, r: number): Pt => {
  const len = Math.hypot(c.x - p.x, c.y - p.y) || 1
  return { x: p.x + ((c.x - p.x) / len) * r, y: p.y + ((c.y - p.y) / len) * r }
}

// A leg as a quadratic curve trimmed to the marks' edges: straight between row neighbours, bowed for loops and the
// dashed way back (above the row when wide, left of the column when tall).
function legPath(leg: FigLeg, lay: Layout, side: Set<string>) {
  const [a, b] = [lay.at[leg.from], lay.at[leg.to]]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  let c = mid
  if (leg.back) c = lay.tall ? { x: a.x - 84, y: mid.y } : { x: mid.x, y: lay.row - 128 }
  else if (leg.loop) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const bend = lay.tall ? 92 : 30
    c = { x: mid.x + ((b.y - a.y) / len) * bend, y: mid.y - ((b.x - a.x) / len) * bend }
  }
  const [s, e] = [toward(a, c, side.has(leg.from) ? 32 : R + 8), toward(b, c, side.has(leg.to) ? 34 : R + 10)]
  return { s, c, e, d: `M${s.x.toFixed(1)} ${s.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}` }
}

const along = ({ s, c, e }: { s: Pt; c: Pt; e: Pt }, u: number): Pt => ({
  x: (1 - u) ** 2 * s.x + 2 * (1 - u) * u * c.x + u ** 2 * e.x,
  y: (1 - u) ** 2 * s.y + 2 * (1 - u) * u * c.y + u ** 2 * e.y
})

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)

// Which animated leg is running at `t` seconds, and how far along it the coin is.
function frame(t: number, legs: number) {
  const k = Math.min(Math.floor(t / LEG_SECONDS), legs - 1)
  const u = Math.min(1, Math.max(0, (t - k * LEG_SECONDS) / MOVE_SECONDS))
  return { k, u: ease(u), fade: t > legs * LEG_SECONDS + END_SECONDS - 0.4 }
}

function Coin({ at, logo, faded }: { at: Pt; logo: string; faded?: boolean }) {
  return (
    <g className="fig-coin" opacity={faded ? 0 : 1}>
      <circle cx={at.x} cy={at.y} r={17} />
      <image href={logo} x={at.x - 12} y={at.y - 12} width={24} height={24} />
    </g>
  )
}

// The contract: a lock that opens only on its own terms.
function LockMark({ at }: { at: Pt }) {
  return (
    <g className="fig-lock">
      <rect x={at.x - 34} y={at.y - 34} width={68} height={68} rx={18} />
      <path d={`M${at.x - 10} ${at.y - 3}v-8a10 10 0 0 1 20 0v8`} className="fig-lock-shackle" />
      <rect x={at.x - 16} y={at.y - 4} width={32} height={24} rx={6} className="fig-lock-body" />
      <circle cx={at.x} cy={at.y + 6} r={3.4} className="fig-lock-hole" />
      <rect x={at.x - 1.6} y={at.y + 7} width={3.2} height={7} rx={1.4} className="fig-lock-hole" />
    </g>
  )
}

function NodeMark({ node, at, lit, tall }: { node: FigNode; at: Pt; lit: boolean; tall: boolean }) {
  const side = !!node.above
  return (
    <g className="fig-node" data-kind={node.kind} data-lit={lit}>
      {lit && <circle cx={at.x} cy={at.y} r={44} className="fig-ring" />}
      {node.kind === 'contract' ? (
        <LockMark at={at} />
      ) : (
        <>
          <circle cx={at.x} cy={at.y} r={side ? 26 : R} className="fig-disc" />
          {node.logos ? (
            node.logos.map((logo, i) => {
              const angle = -Math.PI / 2 + (i * 2 * Math.PI) / node.logos!.length
              const p = { x: at.x + Math.cos(angle) * 12, y: at.y + Math.sin(angle) * 12 + 1 }
              return (
                <g key={logo}>
                  <circle cx={p.x} cy={p.y} r={12} className="fig-disc" />
                  <image href={logo} x={p.x - 9} y={p.y - 9} width={18} height={18} />
                </g>
              )
            })
          ) : (
            <image href={node.logo} x={at.x - (side ? 15 : 19)} y={at.y - (side ? 15 : 19)} width={side ? 30 : 38} height={side ? 30 : 38} />
          )}
        </>
      )}
      {node.badge && (
        <g>
          <circle cx={at.x + 24} cy={at.y + 24} r={11} className="fig-disc" />
          <image href={node.badge} x={at.x + 17} y={at.y + 17} width={14} height={14} />
        </g>
      )}
      {node.sign && (
        <g className="fig-sign" transform={`translate(${at.x + 25} ${at.y - 25})`}>
          <circle r={12.5} />
          <path d="M-5.5 5.5l1.3-4.2 6.4-6.4a1.5 1.5 0 0 1 2.9 2.9l-6.4 6.4z" />
        </g>
      )}
      {side ? (
        <text x={at.x} y={tall ? at.y + 50 : at.y - 38} textAnchor="middle" className="fig-label fig-label-side">
          {node.label}
        </text>
      ) : tall ? (
        <>
          <text x={at.x + 50} y={at.y - 2} className="fig-label">
            {node.label}
          </text>
          {node.sub && (
            <text x={at.x + 50} y={at.y + 21} className="fig-sub">
              {node.sub}
            </text>
          )}
        </>
      ) : (
        <>
          <text x={at.x} y={at.y + 62} textAnchor="middle" className="fig-label">
            {node.label}
          </text>
          {node.sub && (
            <text x={at.x} y={at.y + 86} textAnchor="middle" className="fig-sub">
              {node.sub}
            </text>
          )}
        </>
      )}
    </g>
  )
}

// Consecutive row nodes on the same chain share a tinted box with the chain's name.
function Zones({ figure, lay }: { figure: Figure; lay: Layout }) {
  const row = figure.nodes.filter(node => !node.above)
  const runs: { zone: string; first: Pt; last: Pt; right: number }[] = []
  row.forEach((node, i) => {
    if (!node.zone) return
    const at = lay.at[node.id]
    // Reach over a side node anchored here, so the pool a sale contract trades with sits on Bitcoin Cash too.
    const side = figure.nodes.find(other => other.above === node.id)
    const right = Math.max(at.x + 84, side ? lay.at[side.id].x + 46 : 0)
    const run = runs[runs.length - 1]
    if (run && row[i - 1]?.zone === node.zone) Object.assign(run, { last: at, right: Math.max(run.right, right) })
    else runs.push({ zone: node.zone, first: at, last: at, right })
  })
  return runs.map(({ zone, first, last, right }) => {
    const box = lay.tall
      ? { x: 10, y: first.y - 52, w: lay.w - 20, h: last.y - first.y + (figure.nodes.some(n => n.above) ? 116 : 104) }
      : { x: first.x - 84, y: 12, w: right - first.x + 84, h: lay.h - 22 }
    return (
      <g key={zone + first.x + first.y} className="fig-zone" data-zone={zone === 'Bitcoin Cash' ? 'bch' : undefined}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={22} />
        <text x={lay.tall ? box.x + box.w - 14 : box.x + 14} y={box.y + 22} textAnchor={lay.tall ? 'end' : 'start'} className="fig-zone-label">
          {zone.toUpperCase()}
        </text>
      </g>
    )
  })
}

function Drawing({ figure, tall, t, still, arrow }: { figure: Figure; tall: boolean; t: number; still: boolean; arrow: string }) {
  const lay = layout(figure, tall)
  const side = new Set(figure.nodes.filter(node => node.above).map(node => node.id))
  const moving = figure.legs.filter(leg => !leg.back)
  const { k, u, fade } = frame(t, moving.length)
  const current = moving[k]
  return (
    <svg viewBox={`0 0 ${lay.w} ${lay.h}`} className={tall ? 'fig-tall' : 'fig-wide'} role="img" aria-label={figure.label}>
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="fig-arrow" />
        </marker>
      </defs>
      <Zones figure={figure} lay={lay} />
      {figure.legs.map(leg => {
        const path = legPath(leg, lay, side)
        const mid = along(path, 0.5)
        return (
          <g key={`${leg.from}-${leg.to}`} className="fig-leg" data-back={!!leg.back} data-live={!still && leg === current}>
            <path d={path.d} markerEnd={`url(#${arrow})`} />
            {leg.back &&
              (tall ? (
                <text x={mid.x - 12} y={mid.y} textAnchor="middle" transform={`rotate(-90 ${mid.x - 12} ${mid.y})`} className="fig-back-label">
                  {leg.back.toUpperCase()}
                </text>
              ) : (
                <text x={mid.x} y={mid.y - 12} textAnchor="middle" className="fig-back-label">
                  {leg.back.toUpperCase()}
                </text>
              ))}
          </g>
        )
      })}
      {figure.nodes.map(node => (
        <NodeMark key={node.id} node={node} at={lay.at[node.id]} tall={tall} lit={!still && !!current && (node.id === current.to ? u > 0.92 : node.id === current.from)} />
      ))}
      {still
        ? moving.map(leg => leg.coin && <Coin key={`${leg.from}-${leg.to}`} at={along(legPath(leg, lay, side), 0.5)} logo={leg.coin} />)
        : current?.coin && <Coin at={along(legPath(current, lay, side), u)} logo={current.coin} faded={fade} />}
    </svg>
  )
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

export function RouteFigure({ figure, caption, steps = true }: { figure: Figure; caption?: string; steps?: boolean }) {
  const [root, inView] = useInView<HTMLElement>(0.3)
  const reduced = useReducedMotion()
  const [paused, setPaused] = useState(false)
  const [t, setT] = useState(0)
  const last = useRef<number | null>(null)
  const arrow = `fig-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const moving = figure.legs.filter(leg => !leg.back)
  const total = moving.length * LEG_SECONDS + END_SECONDS
  const play = inView && !paused && !reduced

  useEffect(() => {
    if (!play) return
    let raf = 0
    const tick = (now: number) => {
      const before = last.current
      last.current = now
      if (before !== null) setT(prev => (prev + (now - before) / 1000) % total)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      last.current = null
    }
  }, [play, total])

  const { k } = frame(t, moving.length)
  return (
    <figure className="fig" ref={root}>
      <div className="fig-canvas">
        <Drawing figure={figure} tall={false} t={t} still={reduced} arrow={`${arrow}-w`} />
        <Drawing figure={figure} tall t={t} still={reduced} arrow={`${arrow}-t`} />
        {!reduced && (
          <button type="button" className="fig-pause" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play the animation' : 'Pause the animation'}>
            {paused ? (
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 2.5v11l9-5.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />
              </svg>
            )}
          </button>
        )}
      </div>
      {steps && (
        <ol className="fig-steps">
          {moving.map((leg, i) => (
            <li key={`${leg.from}-${leg.to}`} data-current={!reduced && i === k}>
              <button type="button" onClick={() => setT(i * LEG_SECONDS)}>
                <span className="fig-step-n">{i + 1}</span>
                {leg.coin && <img src={leg.coin} alt="" width={18} height={18} />}
                <span>{leg.step}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
