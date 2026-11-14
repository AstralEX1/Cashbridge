// Limit order cancel / replace: the order and the refund are matched exactly, never guessed.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findOrderRefund } from '../src/lib/memo-helpers.ts'

const SENDER = 'bc1qsender0000000000000000000000000000000'
const target = { asset: 'BTC.BTC', chain: 'BTC', recipient: SENDER }

test('a swap payout in another asset is never taken for the refund', () => {
  const status = {
    tx: { id: 'IN', from_address: SENDER },
    out_txs: [{ id: 'A', chain: 'ETH', to_address: '0xdest', coins: [{ asset: 'ETH.ETH', amount: '2500000000' }], memo: 'OUT:IN' }]
  }
  assert.equal(findOrderRefund(status, target), undefined)
})

test('a partly filled cancel: the refund is picked out of the payout, whatever their order', () => {
  const status = {
    out_txs: [
      { id: 'A', chain: 'ETH', to_address: '0xdest', coins: [{ asset: 'ETH.ETH', amount: '2500000000' }], memo: 'OUT:IN' },
      { id: 'B', chain: 'BTC', to_address: SENDER, coins: [{ asset: 'BTC.BTC', amount: '40000' }], memo: 'REFUND:IN' }
    ]
  }
  assert.equal(findOrderRefund(status, target), '40000')
})

test('a refund of the right asset to another address, chain or with a payout memo is refused', () => {
  const coins = [{ asset: 'BTC.BTC', amount: '40000' }]
  assert.equal(findOrderRefund({ out_txs: [{ id: 'B', chain: 'BTC', to_address: 'bc1qsomeoneelse', coins, memo: 'REFUND:IN' }] }, target), undefined)
  assert.equal(findOrderRefund({ out_txs: [{ id: 'B', chain: 'ETH', to_address: SENDER, coins, memo: 'REFUND:IN' }] }, target), undefined)
  assert.equal(findOrderRefund({ out_txs: [{ id: 'B', chain: 'BTC', to_address: SENDER, coins, memo: 'OUT:IN' }] }, target), undefined)
  assert.equal(findOrderRefund({ out_txs: [{ id: 'B', chain: 'BTC', to_address: SENDER, coins: [{ asset: 'BTC.BTC', amount: '0' }] }] }, target), undefined)
  assert.equal(findOrderRefund(undefined, target), undefined)
})

test('addresses are compared without case or cash-address prefix', () => {
  const evm = { asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', chain: 'ETH', recipient: '0xAbCdEf0000000000000000000000000000000001' }
  const status = {
    out_txs: [{ id: 'B', chain: 'ETH', to_address: '0xabcdef0000000000000000000000000000000001', coins: [{ asset: 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '500000000' }] }]
  }
  assert.equal(findOrderRefund(status, evm), '500000000')

  const bch = { asset: 'BCH.BCH', chain: 'BCH', recipient: 'bitcoincash:qrdn9qwrs9dwlnd5h8zv6wvp58mtk40ga5qel2ckx8' }
  const bchStatus = { out_txs: [{ id: 'B', chain: 'BCH', to_address: 'qrdn9qwrs9dwlnd5h8zv6wvp58mtk40ga5qel2ckx8', coins: [{ asset: 'BCH.BCH', amount: '1000' }], memo: 'REFUND:IN' }] }
  assert.equal(findOrderRefund(bchStatus, bch), '1000')
})
