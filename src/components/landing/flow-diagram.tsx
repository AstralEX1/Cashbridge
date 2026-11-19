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

const Logo = ({ src, size = 28 }: { src: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt="" width={size} height={size} className="flow-logo" loading="lazy" />
)

// The connector between two stops; `n` is the stop it leaves from, which times its packet.
function Link({ n }: { n: number }) {
  return (
    <li className="flow-link" aria-hidden="true" style={{ '--n': n } as React.CSSProperties}>
      <span className="flow-packet" />
    </li>
  )
}

// How a transfer moves, as an explanatory loop: a packet runs from the source wallet to the token in the
// user's wallet, and each stop lights up as it arrives. It runs only while on screen and never under reduced motion.
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
            <span className="flow-icons">
              <Logo src="/networks/btc.svg" />
              <Logo src="/networks/eth.svg" />
              <Logo src="/networks/sol.svg" />
              <Logo src="/networks/base.svg" />
            </span>
            <strong>Your wallet</strong>
            <span className="flow-note">BTC, ETH, USDC, SOL and more, on the chain they live on</span>
            <span className="flow-badge">
              <Swap manual="You sign" router="You sign once" />
            </span>
          </li>
          <Link n={0} />
          <li className="flow-node" style={{ '--n': 1 } as React.CSSProperties}>
            <span className="flow-routes">
              <span className="flow-route">
                <Logo src="/providers/thorchain.svg" size={22} /> THORChain
              </span>
              {/* NEAR Intents carries manual transfers; the Cashbridge Router uses THORChain. */}
              {nearIntents && (
                <Swap
                  manual={
                    <span className="flow-route">
                      <Logo src="/providers/near.svg" size={22} /> NEAR Intents
                    </span>
                  }
                  router={null}
                />
              )}
            </span>
            <strong>Cross-chain route</strong>
            <span className="flow-note">Swaps your asset for native BCH and pays it out on Bitcoin Cash</span>
            <span className="flow-badge flow-badge-quiet">
              {nearIntents ? <Swap manual="Best of two quotes" router="Permissionless" /> : 'Permissionless'}
            </span>
          </li>
          <Link n={1} />
          <li className="flow-node" style={{ '--n': 2 } as React.CSSProperties}>
            <span className="flow-icons">
              <Swap manual={<Logo src="/networks/bch.svg" />} router={<Logo src="/logo.svg" />} />
            </span>
            <strong>
              <Swap manual="Your BCH wallet" router="Cashbridge Router" />
            </strong>
            <span className="flow-note">
              <Swap manual="The BCH lands at an address in your own wallet" router="A one-time order address receives the BCH" />
            </span>
            <span className="flow-badge">
              <Swap manual="Only you can spend it" router="Held for minutes" />
            </span>
          </li>
          <Link n={2} />
          <li className="flow-node" style={{ '--n': 3 } as React.CSSProperties}>
            <span className="flow-icons">
              <Logo src="/providers/cauldron.png" />
            </span>
            <strong>Cauldron</strong>
            <span className="flow-note">Live Bitcoin Cash pools swap the BCH for PUSD or any CashToken</span>
            <span className="flow-badge">
              <Swap manual="You sign" router="The Router signs" />
            </span>
          </li>
          <Link n={3} />
          <li className="flow-node" style={{ '--n': 4 } as React.CSSProperties}>
            <span className="flow-icons">
              <Logo src="/tokens/pusd.svg" />
            </span>
            <strong>You</strong>
            <span className="flow-note">The token arrives in your own BCH wallet</span>
            <span className="flow-badge flow-badge-quiet">Done</span>
          </li>
        </ol>

        <p className="flow-caption" aria-live="polite">
          <Swap
            manual="Manual is the default. Your wallets sign every step and Cash Bridge never holds your funds."
            router="With the Cashbridge Router you sign once on the source chain, and the Router finishes the trade for you."
          />
        </p>
      </div>
    </ModeContext.Provider>
  )
}
