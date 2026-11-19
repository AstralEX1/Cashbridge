'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'

type Mode = 'manual' | 'router'
const ModeContext = createContext<Mode>('manual')

// Text that differs between the two modes sits in one grid cell, so a mode switch crossfades in place.
// Only the current mode's text is exposed to assistive technology.
function Swap({ manual, router }: { manual: React.ReactNode; router: React.ReactNode }) {
  const mode = useContext(ModeContext)
  return (
    <span className="flow-swap">
      <span data-for="manual" aria-hidden={mode !== 'manual'}>
        {manual}
      </span>
      <span data-for="router" aria-hidden={mode !== 'router'}>
        {router}
      </span>
    </span>
  )
}

const Logo = ({ src, size = 28, alt = '' }: { src: string; size?: number; alt?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt={alt} width={size} height={size} className="flow-logo" loading="lazy" />
)

// The connector between two stops; `n` is the stop it leaves from, which times its packet.
function Link({ n }: { n: number }) {
  return (
    <li className="flow-link" aria-hidden="true" style={{ '--n': n } as React.CSSProperties}>
      <span className="flow-packet" />
    </li>
  )
}

// Explanatory loop: a packet runs source → token. Plays only while on screen; never under reduced motion.
export function FlowDiagram({ nearIntents }: { nearIntents: boolean }) {
  const [mode, setMode] = useState<Mode>('manual')
  const [visible, setVisible] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = root.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <ModeContext.Provider value={mode}>
      <div className="flow" ref={root} data-mode={mode} data-play={visible}>
        <div className="flow-modes" role="group" aria-label="Execution mode">
          {(
            [
              ['manual', 'Manual'],
              ['router', 'Cashbridge Router']
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
              {label}
            </button>
          ))}
        </div>

        <ol className="flow-track" aria-label="Route of a transfer to Bitcoin Cash">
          <li className="flow-node" style={{ '--n': 0 } as React.CSSProperties}>
            <span className="flow-icons" aria-hidden>
              <Logo src="/networks/btc.svg" />
              <Logo src="/networks/eth.svg" />
              <Logo src="/networks/sol.svg" />
              <Logo src="/networks/base.svg" />
            </span>
            <strong>Your wallet</strong>
            <span className="flow-note">
              <Swap manual="You sign each step" router="You sign once" />
            </span>
          </li>
          <Link n={0} />
          <li className="flow-node" style={{ '--n': 1 } as React.CSSProperties}>
            <span className="flow-routes">
              <span className="flow-route">
                <Logo src="/providers/thorchain.svg" size={22} alt="" /> THORChain
              </span>
              {nearIntents && (
                <Swap
                  manual={
                    <span className="flow-route">
                      <Logo src="/providers/near.svg" size={22} alt="" /> NEAR Intents
                    </span>
                  }
                  router={null}
                />
              )}
            </span>
            <strong>Cross-chain</strong>
            <span className="flow-note">Asset → native BCH</span>
          </li>
          <Link n={1} />
          <li className="flow-node" style={{ '--n': 2 } as React.CSSProperties}>
            <span className="flow-icons" aria-hidden>
              <Swap manual={<Logo src="/networks/bch.svg" alt="" />} router={<Logo src="/logo.svg" alt="" />} />
            </span>
            <strong>
              <Swap manual="Your BCH wallet" router="Cashbridge Router" />
            </strong>
            <span className="flow-note">
              <Swap manual="BCH lands in your wallet" router="Contract holds BCH for your order" />
            </span>
          </li>
          <Link n={2} />
          <li className="flow-node" style={{ '--n': 3 } as React.CSSProperties}>
            <span className="flow-icons" aria-hidden>
              <Logo src="/providers/cauldron.png" alt="" />
            </span>
            <strong>Cauldron</strong>
            <span className="flow-note">
              <Swap manual="You sign the swap" router="Router signs the swap" />
            </span>
          </li>
          <Link n={3} />
          <li className="flow-node" style={{ '--n': 4 } as React.CSSProperties}>
            <span className="flow-icons" aria-hidden>
              <Logo src="/tokens/pusd.svg" alt="" />
            </span>
            <strong>You</strong>
            <span className="flow-note">Token in your BCH wallet</span>
          </li>
        </ol>

        <p className="flow-caption" aria-live="polite">
          <Swap
            manual="Manual: your wallets sign every step. Cash Bridge never holds funds."
            router="Router: sign once on the source chain; it finishes the trade."
          />
        </p>
      </div>
    </ModeContext.Provider>
  )
}
