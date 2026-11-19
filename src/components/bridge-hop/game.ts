import { type BridgeOperation, isBridgeTerminal, isBridgeWaiting } from '@/store/transaction-store'

export const bridgeHopEligible = (op: BridgeOperation) =>
  !op.error &&
  !isBridgeTerminal(op) &&
  (isBridgeWaiting(op) || ['first_leg_pending', 'bch_unconfirmed', 'second_leg_pending'].includes(op.stage))

export const bridgeHopCanRun = (eligible: boolean, running: boolean, hidden: boolean) => eligible && running && !hidden

export type HopState = { y: number; velocity: number; obstacle: number; score: number; over: boolean }
export const newHop = (): HopState => ({ y: 0, velocity: 0, obstacle: 620, score: 0, over: false })
export const jump = (state: HopState): HopState => (state.over || state.y > 0 ? state : { ...state, velocity: 590 })

export const stepHop = (state: HopState, seconds: number): HopState => {
  if (state.over || !Number.isFinite(seconds) || seconds <= 0) return state
  // A delayed frame cannot skip a gap or collide after the tab wakes up.
  const dt = Math.min(seconds, 0.032)
  const velocity = state.velocity - 1600 * dt
  const y = Math.max(0, state.y + velocity * dt)
  const obstacle = state.obstacle - Math.min(360, 240 + state.score * 6) * dt
  const over = obstacle < 106 && obstacle + 30 > 74 && y < 40
  const passed = obstacle < -30
  return { y, velocity: y === 0 ? 0 : velocity, obstacle: passed ? 620 : obstacle, score: state.score + Number(passed), over }
}

export const readBest = (read: () => string | null) => {
  try {
    const value = Number(read())
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

export const saveBest = (score: number, write: (value: string) => void) => {
  try {
    write(String(score))
  } catch {
    // Private browsing or full storage: the session score still works.
  }
}
