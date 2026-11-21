'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Bot, CircleCheck, PenLine, Plug } from 'lucide-react'
import { useInView } from '@/components/landing/in-view'

// A looping sketch of an agent bridging through the MCP server: the ask, the tool calls and the user's own signature.
// The rows come in one by one while it is on screen; before hydration and under reduced motion they all just show.
const ROWS = 5
const STEP_MS = 900
const HOLD_MS = 3200
const REDUCE = '(prefers-reduced-motion: reduce)'
const onMotionChange = (change: () => void) => {
  const query = matchMedia(REDUCE)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

const Logo = ({ src, size = 18 }: { src: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt="" width={size} height={size} loading="lazy" />
)

const Tool = ({ name, children }: { name: string; children?: React.ReactNode }) => (
  <>
    <CircleCheck size={16} aria-hidden />
    <code>{name}</code>
    <span className="agent-chat-meta">{children}</span>
  </>
)

export function AgentChat() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3)
  // False on the server, so the first paint shows every row.
  const animated = useSyncExternalStore(
    onMotionChange,
    () => !matchMedia(REDUCE).matches,
    () => false
  )
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!animated || !inView) return
    // Each tick shows one more row; after the last one the chat holds, clears and starts again.
    const timer = setTimeout(() => setStep(s => (s >= ROWS ? 0 : s + 1)), step >= ROWS ? HOLD_MS : STEP_MS)
    return () => clearTimeout(timer)
  }, [animated, inView, step])

  const row = (i: number) => ({ 'data-on': !animated || i < step })
  return (
    <div
      ref={ref}
      className="agent-chat"
      data-animated={animated || undefined}
      role="img"
      aria-label="An AI agent asked to bridge 25 USDC from Base to PUSD quotes the transfer, prepares it, the user signs in their wallet, and the agent reports it settled."
    >
      <div className="agent-chat-head" aria-hidden>
        <span className="agent-chat-avatar">
          <Bot size={16} />
        </span>
        Agent
        <span className="agent-chat-server">
          <Plug size={14} /> MCP
        </span>
      </div>
      <ul aria-hidden>
        <li className="agent-chat-ask" {...row(0)}>
          Bridge 25 <Logo src="/tokens/usdc.svg" /> from <Logo src="/networks/base.svg" /> to <Logo src="/tokens/pusd.svg" />
        </li>
        <li className="agent-chat-tool" {...row(1)}>
          <Tool name="get_bridge_quote">
            <Logo src="/providers/thorchain.svg" />
            <Logo src="/providers/near.svg" />
            <Logo src="/providers/shapeshift.svg" />
          </Tool>
        </li>
        <li className="agent-chat-tool" {...row(2)}>
          <Tool name="prepare_bridge" />
        </li>
        <li className="agent-chat-sign" {...row(3)}>
          <PenLine size={16} /> You sign in your wallet
        </li>
        <li className="agent-chat-tool" {...row(4)}>
          <Tool name="get_bridge_status">
            <span className="agent-chat-done">
              <Logo src="/tokens/pusd.svg" size={16} /> Settled
            </span>
          </Tool>
        </li>
      </ul>
    </div>
  )
}
