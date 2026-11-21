import { type BridgeOperation, isBridgeTerminal, isBridgeWaiting } from '@/store/transaction-store'

// Bridge Hero: hold to grow a bridge, release to drop it across the gap, and the hero rolls over
// when the tip lands on the next block. A tap while crossing hops for the BCH coin over the gap.
// Pure state so the rules are testable without a canvas.

export const bridgeHeroEligible = (op: BridgeOperation) =>
  !op.error &&
  !isBridgeTerminal(op) &&
  (isBridgeWaiting(op) || ['first_leg_pending', 'bch_unconfirmed', 'second_leg_pending'].includes(op.stage))

// World units; the canvas scales this box to its width.
export const WORLD = { width: 360, height: 220, top: 156 }
// Screen x where the block the coin stands on ends; the rest of the scene sits right of it.
export const EDGE = 112
export const COIN = 8
// Where the hero's centre rests on a block, and the collectible BCH coin over a gap.
export const REST_Y = WORLD.top - COIN - 1
export const CASH = 5
const CASH_LIFT = 26 // above the bridge: out of reach without a hop
const CASH_ODDS = 0.6
const HOP = 300
const GROW = 210 // bridge growth, units per second
const ROLL = 240 // coin speed
const FALL = 1800 // bridge tip-over, degrees per second squared
const GRAVITY = 1500
const SLIDE = 0.36 // seconds for the view to follow the coin
// The bridge stands up before it falls, so its tip must stay on screen: that caps every reach.
const MAX_BRIDGE = WORLD.top - 4
const REACH = WORLD.top - 8

export type Phase = 'ready' | 'growing' | 'falling' | 'rolling' | 'sliding' | 'dropping' | 'over'
export type Block = { x: number; w: number }
export type HeroState = {
  phase: Phase
  // The last three blocks: the one behind, the one the coin stands on, the next one.
  blocks: Block[]
  bridge: number
  angle: number // 0 points up, 90 lies across the gap, 180 hangs down
  spin: number
  laid?: { x: number; length: number }
  coinX: number
  coinY: number
  coinVy: number
  roll: number
  camera: number
  slide?: { from: number; to: number; t: number }
  score: number
  seed: number
  // BCH coins still on screen, the newest over the gap ahead; coins taken this run.
  cash: { x: number; y: number }[]
  collected: number
  hop: number
  hopV: number
}

// mulberry32: small, seedable, and good enough for block sizes.
const random = (seed: number): [number, number] => {
  const next = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(next ^ (next >>> 15), next | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

// Blocks narrow and gaps widen with the score, but the far edge is always within reach of a
// bridge whose tip is still on screen.
export const nextBlock = (from: Block, score: number, seed: number): [Block, number] => {
  const [a, s1] = random(seed)
  const [b, s2] = random(s1)
  const maxW = Math.max(22, 64 - score * 2)
  const minW = Math.min(maxW, Math.max(18, 40 - score * 1.5))
  const w = minW + a * (maxW - minW)
  const maxGap = Math.min(REACH - w, 70 + score * 6)
  const gap = 28 + b * (maxGap - 28)
  return [{ x: from.x + from.w + gap, w }, s2]
}

// Most gaps carry a coin a little past their middle.
const spawnCash = (from: Block, to: Block, seed: number): [{ x: number; y: number }[], number] => {
  const [odds, s1] = random(seed)
  if (odds > CASH_ODDS) return [[], s1]
  const [at, s2] = random(s1)
  const start = from.x + from.w
  return [[{ x: start + (to.x - start) * (0.3 + 0.4 * at), y: REST_Y - CASH_LIFT }], s2]
}

const restX = (block: Block) => block.x + block.w - COIN - 3
const current = (state: HeroState) => state.blocks[state.blocks.length - 2]
const target = (state: HeroState) => state.blocks[state.blocks.length - 1]
export const bridgeStart = (state: HeroState) => current(state).x + current(state).w
export const bridgeLands = (state: HeroState) => {
  const tip = bridgeStart(state) + state.bridge
  const next = target(state)
  return tip >= next.x && tip <= next.x + next.w
}
const airborne = (state: HeroState) => state.hop > 0 || state.hopV > 0
export const isAnimating = (state: HeroState) => (state.phase !== 'ready' && state.phase !== 'over') || airborne(state)

export const newHero = (seed: number): HeroState => {
  const start = { x: EDGE - 60, w: 60 }
  const [next, after] = nextBlock(start, 0, seed >>> 0)
  const [cash, rest] = spawnCash(start, next, after)
  return {
    phase: 'ready',
    blocks: [start, next],
    bridge: 0,
    angle: 0,
    spin: 0,
    coinX: restX(start),
    coinY: 0,
    coinVy: 0,
    roll: 0,
    camera: 0,
    score: 0,
    seed: rest,
    cash,
    collected: 0,
    hop: 0,
    hopV: 0
  }
}

// One button: in a pause it starts the bridge, while crossing it hops (once, until landing).
export const press = (state: HeroState): HeroState =>
  state.phase === 'ready'
    ? { ...state, phase: 'growing' }
    : state.phase === 'rolling' && !airborne(state)
      ? { ...state, hopV: HOP }
      : state
export const release = (state: HeroState): HeroState => (state.phase === 'growing' ? { ...state, phase: 'falling', spin: 0 } : state)
// A hold cut short by a hidden tab or a lost pointer starts over instead of dropping by surprise.
export const cancelHold = (state: HeroState): HeroState => (state.phase === 'growing' ? { ...state, phase: 'ready', bridge: 0 } : state)

const easeOut = (t: number) => 1 - (1 - t) ** 3

// `still` (reduced motion) finishes each animated phase in one step; only the hold itself grows.
export const stepHero = (state: HeroState, seconds: number, still = false): HeroState => {
  if (!Number.isFinite(seconds) || seconds <= 0) return state
  // A late frame (background tab, slow phone) cannot skip past a decision.
  const dt = Math.min(seconds, 1 / 30)
  return collect(fly(stepPhase(state, dt, still), dt, still))
}

const fly = (state: HeroState, dt: number, still: boolean): HeroState => {
  if (!airborne(state)) return state
  const hopV = state.hopV - GRAVITY * dt
  const hop = still ? 0 : state.hop + hopV * dt
  return hop > 0 ? { ...state, hop, hopV } : { ...state, hop: 0, hopV: 0 }
}

// Takes any coin the hero touches; drops the ones the view has left behind.
const collect = (state: HeroState): HeroState => {
  if (!state.cash.length) return state
  const y = REST_Y - state.hop + state.coinY
  const left = state.cash.filter(c => Math.hypot(c.x - state.coinX, c.y - y) > COIN + CASH && c.x - state.camera > -CASH * 2)
  if (left.length === state.cash.length) return state
  const taken = state.cash.filter(c => Math.hypot(c.x - state.coinX, c.y - y) <= COIN + CASH).length
  return { ...state, cash: left, collected: state.collected + taken }
}

const stepPhase = (state: HeroState, dt: number, still: boolean): HeroState => {
  switch (state.phase) {
    case 'growing':
      return { ...state, bridge: Math.min(MAX_BRIDGE, state.bridge + GROW * dt) }
    case 'falling': {
      const spin = state.spin + FALL * dt
      const angle = still ? 90 : state.angle + spin * dt
      return angle < 90 ? { ...state, angle, spin } : { ...state, angle: 90, spin, phase: 'rolling' }
    }
    case 'rolling': {
      const lands = bridgeLands(state)
      const goal = lands ? restX(target(state)) : bridgeStart(state) + state.bridge + COIN
      const dx = still ? goal - state.coinX : Math.min(ROLL * dt, goal - state.coinX)
      const rolled = { ...state, coinX: state.coinX + dx, roll: state.roll + dx / COIN }
      if (rolled.coinX < goal) return rolled
      if (!lands) return { ...rolled, phase: 'dropping', coinVy: 0 }
      const score = state.score + 1
      const [added, s1] = nextBlock(target(state), score, state.seed)
      const [cash, seed] = spawnCash(target(state), added, s1)
      // Reduced motion has no hop, so crossing a gap takes its coin.
      const passed = still ? state.cash.filter(c => c.x < target(state).x).length : 0
      const to = target(state).x + target(state).w - EDGE
      return {
        ...rolled,
        phase: 'sliding',
        blocks: [current(state), target(state), added],
        laid: { x: bridgeStart(state), length: state.bridge },
        bridge: 0,
        angle: 0,
        spin: 0,
        score,
        seed,
        cash: [...(still ? state.cash.filter(c => c.x >= target(state).x) : state.cash), ...cash],
        collected: state.collected + passed,
        slide: { from: state.camera, to, t: 0 }
      }
    }
    case 'sliding': {
      const slide = state.slide!
      const t = still ? 1 : Math.min(1, slide.t + dt / SLIDE)
      const camera = slide.from + (slide.to - slide.from) * easeOut(t)
      return t < 1 ? { ...state, camera, slide: { ...slide, t } } : { ...state, camera, slide: undefined, phase: 'ready' }
    }
    case 'dropping': {
      // A short bridge swings down from its hinge; a long one rests on the block and stays.
      const short = bridgeStart(state) + state.bridge < target(state).x
      const spin = state.spin + FALL * dt
      const angle = short ? Math.min(180, still ? 180 : state.angle + spin * dt) : state.angle
      const coinVy = state.coinVy + GRAVITY * dt
      const coinY = still ? WORLD.height : state.coinY + coinVy * dt
      const gone = coinY > WORLD.height - WORLD.top + COIN * 2
      return { ...state, angle, spin, coinVy, coinY, phase: gone && (!short || angle === 180) ? 'over' : 'dropping' }
    }
    default:
      return state
  }
}

export const readBest = (read: () => string | null) => {
  try {
    const value = Number(read())
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}
