import assert from 'node:assert/strict'
import test from 'node:test'
import { modifyMemoForLimitSwap, prepareQuoteForLimitSwap } from '../src/lib/memo-helpers.ts'

test('limit-swap memo keeps a full bitcoincash: destination', () => {
  const addr = 'bitcoincash:qp4qeeh8m6zd8r2yq7h0j3k5x9w2v4u6t8s0rm8w9z'
  const out = modifyMemoForLimitSwap(`=:BCH.BCH:${addr}:0/1/0`, '1000', 3)
  assert.equal(out, `=<:BCH.BCH:${addr}:1000/3/0`)
})

test('limit-swap memo keeps a colon-free destination', () => {
  const out = modifyMemoForLimitSwap('=:ETH.USDT:0xabcDEF:0/1/0', '50', 2)
  assert.equal(out, '=<:ETH.USDT:0xabcDEF:50/2/0')
})

test('prepareQuoteForLimitSwap rewrites only the memo', () => {
  const addr = 'bitcoincash:qp4qeeh8m6zd8r2yq7h0j3k5x9w2v4u6t8s0rm8w9z'
  const quote = { memo: `=:BCH.BCH:${addr}`, expected_amount_out: '1' }
  const next = prepareQuoteForLimitSwap(quote, '9', 1)
  assert.equal(next.memo, `=<:BCH.BCH:${addr}:9/1/0`)
  assert.equal(next.expected_amount_out, '1')
  assert.notEqual(next, quote)
})
