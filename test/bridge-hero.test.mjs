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
  release,
  stepHero
} from '../src/components/bridge-hero/game.ts'
import { CHARACTERS, WALLET_KEY, addRun, buyOrSelect, readWallet, saveWallet } from '../src/components/bridge-hero/wallet.ts'
import { BLOCKS_PER_WORLD, THEMES, startWorld, worldAt } from '../src/components/bridge-hero/scene.ts'

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

test('crossing a gap picks up its coin; a bridge that stops short of it does not', () => {
  const base = newHero(42)
  const { near, far } = gapTo(base)
  const coinAt = bridgeStart(base) + near * 0.7
  const ready = { ...base, cash: coinAt }
  const crossed = play(ready, (near + far) / 2)
  assert.equal(crossed.collected, 1)
  assert.equal(crossed.score, 1)
  // Reduced motion rolls the whole way in one step and still picks it up.
  assert.equal(play(ready, (near + far) / 2, true).collected, 1)
  // A bridge far too short ends before the coin: the hero falls without it.
  const short = play(ready, near * 0.2)
  assert.equal(short.phase, 'over')
  assert.equal(short.collected, 0)
})

test('coins sit on the way across most gaps, never on a block', () => {
  let state = newHero(77)
  let withCoin = 0
  const rounds = 60
  for (let round = 0; round < rounds; round++) {
    const { near, far } = gapTo(state)
    if (state.cash !== undefined) {
      withCoin++
      assert.ok(state.cash > bridgeStart(state) && state.cash < state.blocks.at(-1).x, 'over the gap')
    }
    const before = state.collected
    const had = state.cash !== undefined
    state = play(state, (near + far) / 2)
    assert.equal(state.collected, before + Number(had), 'every coin on a crossed gap is taken')
  }
  assert.ok(withCoin > rounds * 0.4 && withCoin < rounds * 0.8, `${withCoin} of ${rounds}`)
})

test('the wallet keeps the record, coins and characters, and survives bad storage', () => {
  const store = new Map()
  const read = key => store.get(key) ?? null
  const write = (key, value) => store.set(key, value)
  const fresh = readWallet(read)
  assert.deepEqual(fresh, { best: 0, coins: 0, owned: ['cash'], selected: 'cash' })
  // The record from before the wallet existed carries over.
  store.set('cashbridge:bridge-hero:best', '7')
  assert.equal(readWallet(read).best, 7)
  let wallet = addRun(readWallet(read), 3, 20)
  assert.equal(wallet.best, 7, 'a lower score never lowers the record')
  wallet = addRun(wallet, 12, 0)
  assert.equal(wallet.best, 12)
  saveWallet(wallet, write)
  assert.deepEqual(readWallet(read), wallet)
  for (const bad of ['oops', '[]', '{"coins":-5,"owned":["dragon"],"selected":"dragon","best":"9"}', '{"coins":1.5}']) {
    store.set(WALLET_KEY, bad)
    const back = readWallet(read)
    assert.equal(back.coins, 0)
    assert.deepEqual(back.owned, ['cash'])
    assert.equal(back.selected, 'cash')
  }
  assert.doesNotThrow(() => readWallet(() => { throw new Error('Blocked storage') }))
  assert.doesNotThrow(() => saveWallet(wallet, () => { throw new Error('Quota exceeded') }))
})

test('characters cost coins once, then switch for free', () => {
  const gold = CHARACTERS.find(c => c.id === 'gold')
  const poor = { best: 0, coins: gold.price - 1, owned: ['cash'], selected: 'cash' }
  assert.equal(buyOrSelect(poor, 'gold'), poor)
  const rich = { ...poor, coins: gold.price + 5 }
  const bought = buyOrSelect(rich, 'gold')
  assert.deepEqual(bought, { best: 0, coins: 5, owned: ['cash', 'gold'], selected: 'gold' })
  const back = buyOrSelect(bought, 'cash')
  assert.equal(back.coins, 5)
  assert.equal(buyOrSelect(back, 'gold').coins, 5, 'owned: no second charge')
  assert.equal(CHARACTERS[0].price, 0)
})

test('a run starts in its source chain world and moves on every few blocks', () => {
  assert.equal(startWorld('SOL'), 1)
  assert.equal(startWorld('NEAR'), 2)
  assert.equal(startWorld('BASE'), 3)
  assert.equal(startWorld('DOGE'), 0)
  assert.equal(startWorld(undefined), 0)
  assert.equal(worldAt(1, BLOCKS_PER_WORLD - 1), 1)
  assert.equal(worldAt(1, BLOCKS_PER_WORLD), 2)
  assert.equal(worldAt(THEMES.length - 1, BLOCKS_PER_WORLD), 0)
  for (const theme of THEMES) for (const color of [...theme.sky, theme.orb.color, theme.cloud]) assert.match(color, /^#[0-9a-f]{6}$/, 'alpha is appended to these')
})
