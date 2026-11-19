'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

type Axis = 'mode' | 'bridge' | 'direction'

type Scene = {
  id: string
  mode: 'Manual' | 'Cashbridge Router'
  bridge: 'THORChain' | 'NEAR Intents'
  direction: 'To Bitcoin Cash' | 'Back from BCH'
  title: string
  blurb: string
  custody: string
  nodes: { title: string; note: string; kind?: 'onchain' | 'service' | 'wallet' }[]
}

const SCENES: Scene[] = [
  {
    id: 'manual-thor-fwd',
    mode: 'Manual',
    bridge: 'THORChain',
    direction: 'To Bitcoin Cash',
    title: 'Manual · THORChain · forward',
    blurb: 'You sign every step. THORChain pays native BCH to your wallet; Cauldron is a second signature when you want a CashToken.',
    custody: 'Only your wallets. No Cashbridge contract.',
    nodes: [
      { title: 'Source wallet', note: 'Signs the deposit', kind: 'wallet' },
      { title: 'THORChain', note: 'Vault + memo → BCH', kind: 'onchain' },
      { title: 'Your BCH wallet', note: 'Receives BCH', kind: 'wallet' },
      { title: 'Cauldron', note: 'Optional token swap you sign', kind: 'onchain' }
    ]
  },
  {
    id: 'manual-near-fwd',
    mode: 'Manual',
    bridge: 'NEAR Intents',
    direction: 'To Bitcoin Cash',
    title: 'Manual · NEAR Intents · forward',
    blurb: 'Plain transfer to a one-use deposit address — no memo, no Cashbridge contract on that leg. Payout is checked on Bitcoin Cash.',
    custody: 'NEAR 1Click deposit address only; covenant never on the NEAR leg.',
    nodes: [
      { title: 'Source wallet', note: 'Plain transfer', kind: 'wallet' },
      { title: 'NEAR deposit', note: 'One-use address', kind: 'onchain' },
      { title: 'Your BCH wallet', note: 'Receives BCH', kind: 'wallet' },
      { title: 'Cauldron', note: 'Optional token swap you sign', kind: 'onchain' }
    ]
  },
  {
    id: 'router-thor-fwd',
    mode: 'Cashbridge Router',
    bridge: 'THORChain',
    direction: 'To Bitcoin Cash',
    title: 'Router · THORChain · forward',
    blurb: 'One source signature. BCH lands in a per-order P2SH purchase covenant (apiVersion=2). The Router may buy your token or refund BCH — only those paths.',
    custody: 'apiVersion=2 purchase covenant · not legacy P2PKH custody.',
    nodes: [
      { title: 'Source wallet', note: 'Signs once', kind: 'wallet' },
      { title: 'THORChain', note: 'Pays order contract', kind: 'onchain' },
      { title: 'Order contract', note: 'convert / giveBack / expire', kind: 'onchain' },
      { title: 'Cashbridge Router', note: 'Builds Cauldron payout', kind: 'service' },
      { title: 'Your address', note: 'Token or BCH fallback', kind: 'wallet' }
    ]
  },
  {
    id: 'router-near-fwd',
    mode: 'Cashbridge Router',
    bridge: 'NEAR Intents',
    direction: 'To Bitcoin Cash',
    title: 'Router · NEAR Intents · forward',
    blurb: 'NEAR still uses a plain deposit address. Its BCH payout targets the Router order address. No Cashbridge covenant sits on the NEAR leg.',
    custody: 'Covenant begins only once BCH sits at the order address.',
    nodes: [
      { title: 'Source wallet', note: 'Signs once', kind: 'wallet' },
      { title: 'NEAR deposit', note: 'Plain address', kind: 'onchain' },
      { title: 'Order contract', note: 'Receives BCH', kind: 'onchain' },
      { title: 'Cashbridge Router', note: 'Settles Cauldron', kind: 'service' },
      { title: 'Your address', note: 'Token or fallback', kind: 'wallet' }
    ]
  },
  {
    id: 'manual-rev',
    mode: 'Manual',
    bridge: 'THORChain',
    direction: 'Back from BCH',
    title: 'Manual · reverse',
    blurb: 'Your BCH wallet sells the CashToken on Cauldron, then signs the bridge deposit. THORChain or NEAR Intents carries the cross-chain leg.',
    custody: 'Only your wallets on both legs.',
    nodes: [
      { title: 'BCH wallet', note: 'Sells CashToken', kind: 'wallet' },
      { title: 'Cauldron', note: 'Token → BCH', kind: 'onchain' },
      { title: 'BCH wallet', note: 'Signs bridge deposit', kind: 'wallet' },
      { title: 'THOR / NEAR', note: 'Cross-chain payout', kind: 'onchain' }
    ]
  },
  {
    id: 'router-sale',
    mode: 'Cashbridge Router',
    bridge: 'THORChain',
    direction: 'Back from BCH',
    title: 'Router · sale contract · reverse',
    blurb: 'One BCH-wallet send into a sale covenant. The Router may sell for ≥ min BCH and deposit to THORChain with the fixed memo, or return the tokens. Sales stay on THORChain.',
    custody: 'apiVersion=2 sale covenant · THORChain only.',
    nodes: [
      { title: 'BCH wallet', note: 'Sends token to sale', kind: 'wallet' },
      { title: 'Sale contract', note: 'sell / return / expire', kind: 'onchain' },
      { title: 'Cashbridge Router', note: 'Sell + THOR deposit', kind: 'service' },
      { title: 'Destination', note: 'Asset on other chain', kind: 'wallet' }
    ]
  }
]

function pickScene(mode: Scene['mode'], bridge: Scene['bridge'], direction: Scene['direction']): Scene {
  const exact = SCENES.find(s => s.mode === mode && s.bridge === bridge && s.direction === direction)
  if (exact) return exact
  if (direction === 'Back from BCH') {
    return mode === 'Cashbridge Router' ? SCENES.find(s => s.id === 'router-sale')! : SCENES.find(s => s.id === 'manual-rev')!
  }
  return SCENES.find(s => s.mode === mode && s.bridge === bridge) ?? SCENES[0]
}

export function DocsDemoFlow() {
  const labelId = useId()
  const scrubId = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const ignoreScroll = useRef(false)
  const [index, setIndex] = useState(0)
  const [reduced, setReduced] = useState(false)
  const scene = SCENES[index]

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(SCENES.length - 1, next))
      setIndex(clamped)
      const track = trackRef.current
      if (!track) return
      const card = track.children[clamped] as HTMLElement | undefined
      ignoreScroll.current = true
      card?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
      window.setTimeout(() => {
        ignoreScroll.current = false
      }, reduced ? 50 : 450)
    },
    [reduced]
  )

  const setAxis = (key: Axis, value: string) => {
    const next = pickScene(
      key === 'mode' ? (value as Scene['mode']) : scene.mode,
      key === 'bridge' ? (value as Scene['bridge']) : scene.bridge,
      key === 'direction' ? (value as Scene['direction']) : scene.direction
    )
    go(SCENES.findIndex(s => s.id === next.id))
  }

  const onScroll = () => {
    if (ignoreScroll.current) return
    const track = trackRef.current
    if (!track) return
    const mid = track.scrollLeft + track.clientWidth / 2
    let best = 0
    let bestDist = Infinity
    Array.from(track.children).forEach((child, i) => {
      const el = child as HTMLElement
      const center = el.offsetLeft + el.offsetWidth / 2
      const dist = Math.abs(center - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    if (best !== index) setIndex(best)
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      go(index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      go(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      go(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      go(SCENES.length - 1)
    }
  }

  const bridgeSelected = (option: string) => (scene.direction === 'Back from BCH' ? option === 'THORChain' : scene.bridge === option)

  return (
    <section className="docs-demo" aria-labelledby={labelId}>
      <header className="docs-demo-head">
        <div>
          <p className="docs-demo-kicker">Interactive demo</p>
          <h3 id={labelId}>Route storyboard</h3>
          <p>Scrub or click through Manual vs Cashbridge Router, THORChain vs NEAR Intents, and forward vs reverse.</p>
        </div>
        <div className="docs-demo-controls" role="group" aria-label="Storyboard controls">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous scene">
            ←
          </button>
          <span>
            {index + 1} / {SCENES.length}
          </span>
          <button type="button" onClick={() => go(index + 1)} disabled={index === SCENES.length - 1} aria-label="Next scene">
            →
          </button>
        </div>
      </header>

      <div className="docs-demo-filters">
        <div className="docs-demo-filter" role="group" aria-label="Mode">
          <span>Mode</span>
          {(['Manual', 'Cashbridge Router'] as const).map(option => (
            <button key={option} type="button" aria-pressed={scene.mode === option} className={scene.mode === option ? 'is-active' : undefined} onClick={() => setAxis('mode', option)}>
              {option}
            </button>
          ))}
        </div>
        <div className="docs-demo-filter" role="group" aria-label="Bridge">
          <span>Bridge</span>
          {(['THORChain', 'NEAR Intents'] as const).map(option => {
            const disabled = scene.direction === 'Back from BCH' && scene.mode === 'Cashbridge Router' && option === 'NEAR Intents'
            return (
              <button key={option} type="button" aria-pressed={bridgeSelected(option)} className={bridgeSelected(option) ? 'is-active' : undefined} disabled={disabled} onClick={() => setAxis('bridge', option)}>
                {option}
              </button>
            )
          })}
        </div>
        <div className="docs-demo-filter" role="group" aria-label="Direction">
          <span>Direction</span>
          {(['To Bitcoin Cash', 'Back from BCH'] as const).map(option => (
            <button key={option} type="button" aria-pressed={scene.direction === option} className={scene.direction === option ? 'is-active' : undefined} onClick={() => setAxis('direction', option)}>
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="docs-demo-scrub">
        <label htmlFor={scrubId}>Scene</label>
        <input
          id={scrubId}
          type="range"
          min={0}
          max={SCENES.length - 1}
          step={1}
          value={index}
          onInput={e => go(Number((e.target as HTMLInputElement).value))}
          onChange={e => go(Number(e.target.value))}
          aria-valuetext={scene.title}
        />
        <ol className="docs-demo-dots" aria-hidden="true">
          {SCENES.map((item, i) => (
            <li key={item.id} className={i === index ? 'is-active' : undefined} />
          ))}
        </ol>
      </div>

      <div
        ref={trackRef}
        className="docs-demo-track"
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Route scenes"
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {SCENES.map((item, i) => (
          <article key={item.id} className={`docs-demo-card${i === index ? ' is-current' : ''}`} aria-hidden={i !== index}>
            <div className="docs-demo-card-top">
              <p className="docs-demo-card-title">{item.title}</p>
              <p className="docs-demo-custody">{item.custody}</p>
            </div>
            <p>{item.blurb}</p>
            <ol className="docs-demo-nodes" aria-label={item.title}>
              {item.nodes.map((node, ni) => (
                <li key={node.title + node.note} data-kind={node.kind ?? 'onchain'}>
                  {ni > 0 && <span className="docs-demo-node-join" aria-hidden="true" />}
                  <strong>{node.title}</strong>
                  <span>{node.note}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <div className="docs-demo-legend" aria-label="Node legend">
        <span data-kind="wallet">Wallet</span>
        <span data-kind="onchain">On-chain</span>
        <span data-kind="service">Router service</span>
      </div>
      <p className="docs-demo-hint">Scroll sideways, drag the scrubber, use the arrows, or press ← → while the storyboard is focused.</p>
    </section>
  )
}
