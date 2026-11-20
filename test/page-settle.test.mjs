import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createVirtualMachineBch2026 } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, sourcesOf, reviewBuild, tradeTransaction } from '../src/lib/cauldron.ts'
import { orderBinding } from '../src/lib/router-contract.ts'
import { newPageKey, pageCanSettle, settleFromPage } from '../src/lib/page-settle.ts'
import { BridgeConfig } from '../src/config.ts'
import { otherPubkey, pubkey } from './fixtures/bridge-fixtures.mjs'

const recipient = bindingFromPubkey(pubkey, 0)
const refund = bindingFromPubkey(otherPubkey, 0)
const router = newPageKey()
const page = newPageKey()
const contract = { routerKey: router.pubkey, refundAfter: Math.floor(Date.now() / 1000) + 3 * 60 * 60, version: 2, pageKey: page.pubkey }
const terms = { ...contract, recipientScript: recipient.lockingBytecode, refundScript: refund.lockingBytecode, category: BridgeConfig.pusd.category, minPusd: '200', quotedSats: '1000000' }
const order = {
  id: 'x',
  recipientAddress: recipient.tokenAddress,
  refundAddress: refund.cashAddress,
  expectedBchSats: '1000000',
  contract,
  depositAddress: orderBinding(terms, 0).cashAddress,
  minPusd: '200',
  state: 'awaiting_deposit',
  attempts: []
}
const pool = {
  version: '0',
  parameters: { withdraw_pubkey_hash: new Uint8Array(20).fill(7) },
  outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
  output: { locking_bytecode: poolLockingBytecode(new Uint8Array(20).fill(7)), token: { amount: 30000n, token_id: BridgeConfig.pusd.category }, amount: 108000000n }
}
const coin = (vout, value = 1000000n) => ({ txid: 'ee'.repeat(32), vout, value, height: 0, hasToken: false })
// The live builder against one local pool, keeping fee room as the real one does.
const trade = async intent => {
  const fitted = { ...intent, sell: intent.sell - 10000n }
  return { build: tradeTransaction(bestTrade([pool], fitted.sell), fitted), intent: fitted }
}

test('the page buys the token with the one coin at its contract, signed by its own key, paid only to the customer', async () => {
  let sent
  const txid = await settleFromPage(order, page.secret, {
    coinsOf: async () => ({ tip: 100, utxos: [coin(0)] }),
    trade: async intent => {
      const built = await trade(intent)
      sent = { reviewed: reviewBuild(built.build, built.intent) }
      return built
    },
    send: async (hex, id) => ((sent.hex = hex), id)
  })
  assert.equal(txid, txidOf(sent.hex))
  const transaction = decodeTx(sent.hex)
  assert.equal(createVirtualMachineBch2026(true).verify({ transaction, sourceOutputs: sourcesOf(sent.reviewed) }), true)
  const own = sent.reviewed.ownIndexes[0]
  assert.equal(Buffer.from(transaction.outputs[own].lockingBytecode).toString('hex'), recipient.lockingBytecode)
  assert.ok(transaction.outputs[own].token.amount >= 200n)
})

test('the page leaves the order alone without its key, without a coin, with two coins or once it is settled', async () => {
  const never = async () => assert.fail('no trade is built')
  assert.equal(pageCanSettle(order, newPageKey().secret), false)
  assert.equal(pageCanSettle({ ...order, contract: { routerKey: router.pubkey, refundAfter: contract.refundAfter } }, page.secret), false)
  assert.equal(pageCanSettle({ ...order, payoutTxid: 'ab'.repeat(32) }, page.secret), false)
  assert.equal(pageCanSettle({ ...order, state: 'completed' }, page.secret), false)
  assert.equal(await settleFromPage(order, page.secret, { coinsOf: async () => ({ tip: 1, utxos: [] }), trade: never }), undefined)
  assert.equal(await settleFromPage(order, page.secret, { coinsOf: async () => ({ tip: 1, utxos: [coin(0), coin(1)] }), trade: never }), undefined)
  await assert.rejects(settleFromPage({ ...order, depositAddress: refund.cashAddress }, page.secret, { trade: never }), /not its contract/)
})
