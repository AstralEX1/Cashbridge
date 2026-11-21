'use client'

import { useId, useState } from 'react'
import { RouteFigure } from '@/components/docs/route-figure'
import { LOGO, routeScene, type BridgeId, type Direction, type Mode } from '@/components/docs/route-scenes'

// Pick a direction, a mode and a bridge, and watch that route run: the docs' interactive demo.

const DIRECTIONS: [Direction, string][] = [
  ['in', 'Into Bitcoin Cash'],
  ['out', 'Back out']
]
const MODES: [Mode, string][] = [
  ['manual', 'Manual'],
  ['router', 'Cashbridge Router']
]
const BRIDGES: [BridgeId, string, string][] = [
  ['thorchain', 'THORChain', LOGO.thorchain],
  ['near', 'NEAR Intents', LOGO.near],
  ['shapeshift', 'ShapeShift', LOGO.shapeshift]
]

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, string?][]; onChange: (value: T) => void }) {
  return (
    <div className="rx-seg" role="group" aria-label={label}>
      {options.map(([key, name, logo]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {logo && <img src={logo} alt="" width={18} height={18} />}
          {name}
        </button>
      ))}
    </div>
  )
}

export function RouteExplorer() {
  const headingId = useId()
  const [direction, setDirection] = useState<Direction>('in')
  const [mode, setMode] = useState<Mode>('router')
  const [bridge, setBridge] = useState<BridgeId>('near')
  const scene = routeScene(direction, mode, bridge)

  return (
    <section className="rx" aria-labelledby={headingId}>
      <h3 id={headingId} className="sr-only">
        Route explorer
      </h3>
      <div className="rx-controls">
        <Segmented label="Direction" value={direction} options={DIRECTIONS} onChange={setDirection} />
        <Segmented label="Mode" value={mode} options={MODES} onChange={setMode} />
        <Segmented label="Bridge" value={bridge} options={BRIDGES} onChange={setBridge} />
      </div>
      <RouteFigure key={`${direction}-${mode}-${bridge}`} figure={scene.figure} />
      <dl className="rx-stats">
        <div>
          <dt>Your signatures</dt>
          <dd className="rx-big">{scene.signatures}</dd>
        </div>
        <div>
          <dt>Who holds the BCH</dt>
          <dd>{scene.custody}</dd>
        </div>
        <div>
          <dt>If it can&apos;t finish</dt>
          <dd>{scene.failure}</dd>
        </div>
      </dl>
    </section>
  )
}
