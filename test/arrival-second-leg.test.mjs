import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrivalSoftMessageKey, arrivalCompletedUpdate } from '../src/lib/arrival-second-leg.ts'

test('soft status keys map for UI retries', () => {
  assert.equal(arrivalSoftMessageKey({ kind: 'Waiting', reason: 'no_coin' }), 'arrival.waiting')
  assert.equal(arrivalSoftMessageKey({ kind: 'BelowFloor', sats: 1n, minimum: 2n, available: 1n }), 'arrival.belowFloor')
  assert.equal(arrivalSoftMessageKey({ kind: 'FeeShortfall', attempt: 1 }), 'arrival.feeShortfall')
  assert.equal(arrivalSoftMessageKey({ kind: 'BroadcastConflict', attempt: 2 }), 'arrival.broadcastConflict')
  assert.equal(arrivalSoftMessageKey({ kind: 'TradeLayoutError', message: 'x' }), undefined)
  assert.equal(arrivalSoftMessageKey({ kind: 'Swapped', txid: 'a', signedHex: 'b', tokens: 1n, soldSats: 1n }), undefined)
})

test('arrivalCompletedUpdate marks the operation completed with second-leg figures', () => {
  const update = arrivalCompletedUpdate(
    { kind: 'Swapped', txid: 'aa'.repeat(32), signedHex: '00', tokens: 42n, soldSats: 900000n },
    'cate'
  )
  assert.equal(update.stage, 'completed')
  assert.equal(update.secondLeg?.tokenOut, '42')
  assert.equal(update.secondLeg?.sellSats, '900000')
  assert.equal(update.secondLeg?.txid, 'aa'.repeat(32))
})
