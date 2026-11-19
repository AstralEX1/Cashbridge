import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bridgeHopCanRun, bridgeHopEligible, jump, newHop, readBest, saveBest, stepHop } from '../src/components/bridge-hop/game.ts'

test('only network wait stages allow play, for both directions and BCH/token routes', () => {
  for (const direction of ['forward', 'reverse']) {
    for (const destinationAsset of ['BCH', 'PUSD']) {
      for (const stage of ['first_leg_pending', 'bch_unconfirmed', 'second_leg_pending']) {
        const op = { direction, destinationAsset, stage }
        assert.equal(bridgeHopEligible(op), true)
        assert.equal(bridgeHopEligible({ ...op, error: 'Needs attention' }), false)
      }
      for (const stage of ['first_leg_signing', 'first_leg_unknown', 'bch_ready', 'second_leg_signed', 'second_leg_unknown', 'completed', 'kept_bch', 'refunded', 'failed']) {
        assert.equal(bridgeHopEligible({ direction, destinationAsset, stage }), false, `${direction}: ${stage}`)
      }
    }
  }
})

test('closed/paused, hidden and ineligible games never run', () => {
  for (const eligible of [false, true]) {
    for (const running of [false, true]) {
      for (const hidden of [false, true]) {
        assert.equal(bridgeHopCanRun(eligible, running, hidden), eligible && running && !hidden)
      }
    }
  }
})

test('a grounded runner collides; a hop clears the gap; holding cannot double-jump', () => {
  assert.equal(stepHop({ ...newHop(), obstacle: 108 }, 0.016).over, true)
  let state = jump({ ...newHop(), obstacle: 180 })
  state = stepHop(state, 0.016)
  assert.equal(jump(state), state)
  for (let i = 0; i < 65; i++) state = stepHop(state, 0.016)
  assert.equal(state.over, false)
  assert.equal(state.score, 1)
  assert.equal(state.y, 0)
})

test('only passing a gap scores; ended runs freeze and stale frames are bounded', () => {
  const passed = stepHop({ ...newHop(), obstacle: -29 }, 0.016)
  assert.equal(passed.score, 1)
  assert.equal(passed.obstacle, 620)
  assert.equal(stepHop(passed, 0.016).score, 1)
  const over = { ...newHop(), over: true }
  assert.equal(jump(over), over)
  assert.equal(stepHop(over, 1), over)
  assert.deepEqual(stepHop(newHop(), 999), stepHop(newHop(), 0.032))
  for (const seconds of [0, -1, NaN, Infinity]) assert.deepEqual(stepHop(newHop(), seconds), newHop())
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
