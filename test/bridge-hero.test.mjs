import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EDGE,
  WORLD,
  bridgeHeroEligible,
  bridgeLands,
  bridgeStart,
  cancelHold,
  newHero,
  nextBlock,
  press,
  readBest,
  release,
  saveBest,
  stepHero
} from '../src/components/bridge-hero/game.ts'

// Plays one round to rest: grows the bridge to `length`, drops it, and runs frames until it settles.
const play = (state, length, still = false) => {
  state = { ...press(state), bridge: length }
  state = release(state)
  for (let i = 0; i < 600 && !['ready', 'over'].includes(state.phase); i++) state = stepHero(state, 1 / 60, still)
  return state
}
const gapTo = state => {
  const next = state.blocks.at(-1)
  return { near: next.x - bridgeStart(state), far: next.x + next.w - bridgeStart(state) }
}

test('only network wait stages allow play, for both directions and BCH/token routes', () => {
  for (const direction of ['forward', 'reverse']) {
    for (const destinationAsset of ['BCH', 'PUSD']) {
      for (const stage of ['first_leg_pending', 'bch_unconfirmed', 'second_leg_pending']) {
        const op = { direction, destinationAsset, stage }
        assert.equal(bridgeHeroEligible(op), true)
        assert.equal(bridgeHeroEligible({ ...op, error: 'Needs attention' }), false)
      }
      for (const stage of ['first_leg_signing', 'first_leg_unknown', 'bch_ready', 'second_leg_signed', 'second_leg_unknown', 'completed', 'kept_bch', 'refunded', 'failed']) {
        assert.equal(bridgeHeroEligible({ direction, destinationAsset, stage }), false, `${direction}: ${stage}`)
      }
    }
  }
})

test('holding grows the bridge and releasing drops it; input out of turn is ignored', () => {
  const ready = newHero(7)
  assert.equal(release(ready), ready)
  let state = press(ready)
  assert.equal(state.phase, 'growing')
  assert.equal(press(state), state)
  state = stepHero(state, 0.5)
  assert.ok(state.bridge > 0)
  assert.equal(stepHero(state, 0.5).bridge, state.bridge + 210 / 30, 'a late frame grows at most one capped step')
  state = release(state)
  assert.equal(state.phase, 'falling')
  assert.equal(press(state), state)
  assert.equal(release(state), state)
})

test('a bridge that reaches the next block carries the coin over and scores', () => {
  let state = newHero(42)
  const { near, far } = gapTo(state)
  state = play(state, (near + far) / 2)
  assert.equal(state.phase, 'ready')
  assert.equal(state.score, 1)
  assert.equal(state.bridge, 0)
  // The view followed: the block under the coin now ends at the left edge again, the next one is on screen.
  assert.equal(bridgeStart(state) - state.camera, EDGE)
  const next = state.blocks.at(-1)
  assert.ok(next.x + next.w - state.camera <= WORLD.width)
  assert.ok(state.coinX > state.blocks.at(-2).x && state.coinX < bridgeStart(state))
})

test('both ends of the next block count; short or long by one unit misses', () => {
  const state = newHero(3)
  const { near, far } = gapTo(state)
  assert.equal(bridgeLands({ ...state, bridge: near }), true)
  assert.equal(bridgeLands({ ...state, bridge: far }), true)
  assert.equal(bridgeLands({ ...state, bridge: near - 1 }), false)
  assert.equal(bridgeLands({ ...state, bridge: far + 1 }), false)
  for (const length of [near - 1, far + 1]) {
    const missed = play(state, length)
    assert.equal(missed.phase, 'over', `length ${length}`)
    assert.equal(missed.score, 0)
    assert.ok(missed.coinY > WORLD.height - WORLD.top)
    assert.equal(stepHero(missed, 1), missed, 'an ended round stays still')
  }
  assert.equal(play(state, near - 1).angle, 180, 'a short bridge swings down')
  assert.equal(play(state, far + 1).angle, 90, 'a long bridge stays across')
})

test('reduced motion settles each step at once and gives the same result', () => {
  const state = newHero(11)
  const { near, far } = gapTo(state)
  let still = { ...press(state), bridge: (near + far) / 2 }
  still = release(still)
  let frames = 0
  while (!['ready', 'over'].includes(still.phase)) {
    still = stepHero(still, 1 / 60, true)
    frames++
  }
  assert.ok(frames <= 4, `took ${frames} frames`)
  const moving = play(state, (near + far) / 2)
  assert.equal(still.score, moving.score)
  assert.equal(still.camera, moving.camera)
  assert.equal(play(state, near - 1, true).phase, 'over')
})

test('a hold cut short starts over instead of dropping', () => {
  let state = stepHero(press(newHero(5)), 0.03)
  state = cancelHold(state)
  assert.equal(state.phase, 'ready')
  assert.equal(state.bridge, 0)
  const falling = release(press(newHero(5)))
  assert.equal(cancelHold(falling), falling)
})

test('broken frame times change nothing', () => {
  const state = press(newHero(9))
  for (const seconds of [0, -1, NaN, Infinity]) assert.equal(stepHero(state, seconds), state)
})

test('every generated block fits on screen at any score and gets harder', () => {
  for (let seed = 1; seed < 400; seed++) {
    let from = { x: EDGE - 60, w: 60 }
    let s = seed
    for (let score = 0; score < 60; score++) {
      const [block, next] = nextBlock(from, score, s)
      const gap = block.x - (from.x + from.w)
      assert.ok(gap >= 28, `gap ${gap}`)
      assert.ok(block.w >= 18, `width ${block.w}`)
      assert.ok(EDGE + gap + block.w <= WORLD.width, `seed ${seed} score ${score} off screen`)
      assert.ok(gap + block.w < WORLD.top, `seed ${seed} score ${score}: the tip would leave the screen`)
      from = block
      s = next
    }
  }
  const [easy] = nextBlock({ x: 0, w: 50 }, 0, 99)
  const [hard] = nextBlock({ x: 0, w: 50 }, 40, 99)
  assert.ok(hard.w < easy.w)
})

test('a long run keeps scoring when every bridge is right', () => {
  let state = newHero(2024)
  for (let round = 1; round <= 30; round++) {
    const { near, far } = gapTo(state)
    state = play(state, (near + far) / 2)
    assert.equal(state.score, round)
    assert.equal(state.blocks.length, 3)
  }
})

test('local best tolerates unavailable, corrupt and full storage', () => {
  assert.equal(readBest(() => '42'), 42)
  for (const value of [null, 'oops', '-2', 'Infinity', '1.5', '9007199254740992']) assert.equal(readBest(() => value), 0)
  assert.equal(readBest(() => { throw new Error('Blocked storage') }), 0)
  let saved
  saveBest(12, value => { saved = value })
  assert.equal(saved, '12')
  assert.doesNotThrow(() => saveBest(12, () => { throw new Error('Quota exceeded') }))
})
