import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createVirtualMachineBch2026 } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, sourcesOf, reviewBuild, tradeTransaction } from '../src/lib/cauldron.ts'
import { orderBinding, saleBinding } from '../src/lib/router-contract.ts'
import { newPageKey, pageCanSettle, pageMayReturn, returnFromPage, settleFromPage } from '../src/lib/page-settle.ts'
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

test('the page settles the largest coin and ignores dust, so neither sends the order back', async () => {
  let funded
  const txid = await settleFromPage(order, page.secret, {
    coinsOf: async () => ({ tip: 100, utxos: [coin(0, 600n), coin(1, 400000n), coin(2)] }),
    trade: async intent => ((funded = intent.funding), trade(intent)),
    send: async (_hex, id) => id
  })
  assert.ok(txid)
  assert.deepEqual(funded.map(f => [f.vout, f.value]), [[2, '1000000']])
  assert.equal(await settleFromPage(order, page.secret, { coinsOf: async () => ({ tip: 1, utxos: [coin(0, 999n)] }), trade: async () => assert.fail('dust is not traded') }), undefined)
})

// What the contract checks for each returned coin: its own output index, the customer's BCH address, no token, fee cap.
const checkReturn = (hex, coins) => {
  const transaction = decodeTx(hex)
  const lockingBytecode = Buffer.from(orderBinding(terms, 0).lockingBytecode, 'hex')
  const sourceOutputs = coins.map(c => ({ lockingBytecode, valueSatoshis: c.value }))
  assert.equal(createVirtualMachineBch2026(true).verify({ transaction, sourceOutputs }), true)
  transaction.outputs.forEach((output, i) => {
    assert.equal(Buffer.from(output.lockingBytecode).toString('hex'), refund.lockingBytecode)
    assert.ok(!output.token && output.valueSatoshis + 2000n >= coins[i].value && output.valueSatoshis < coins[i].value)
  })
  return transaction
}

test('a coin left after the order settled goes back with the page key; once the refund time passes, without any key', async () => {
  const left = [coin(3, 400000n), coin(4, 250000n)]
  const settled = { ...order, state: 'completed', payoutTxid: 'ab'.repeat(32), recoverySats: '650000' }
  let sent
  const send = async (hex, id) => ((sent = hex), id)
  const coinsOf = async () => ({ tip: 100, utxos: [...left, coin(5, 700n)] })
  assert.ok(await returnFromPage(settled, page.secret, { coinsOf, send }))
  assert.equal(checkReturn(sent, left).locktime, 0, 'the page key needs no wait')
  // A closed page's order, or one without a page key, waits for the refund time and then needs no key at all.
  assert.equal(await returnFromPage(settled, undefined, { coinsOf, send: async () => assert.fail('too early') }), undefined)
  const late = (contract.refundAfter + 1) * 1000
  assert.ok(await returnFromPage({ ...order, state: 'streaming' }, undefined, { coinsOf, send, now: late }))
  const expired = checkReturn(sent, left)
  assert.equal(expired.locktime, contract.refundAfter)
  assert.ok(expired.inputs.every(input => input.sequenceNumber < 0xffffffff))
})

test('the page sends nothing back while the order can still settle, is under review or holds nothing', () => {
  const late = (contract.refundAfter + 1) * 1000
  assert.equal(pageMayReturn(order, page.secret), false, 'before the refund time an open order is settled, not returned')
  assert.equal(pageMayReturn({ ...order, state: 'completed', recoverySats: '0' }, page.secret, late), false)
  assert.equal(pageMayReturn({ ...order, state: 'manual_review', recoverySats: '5000' }, page.secret, late), false)
  assert.equal(pageMayReturn({ ...order, state: 'completed', recoverySats: '5000' }, newPageKey().secret), false, 'another key waits for the refund time')
  assert.equal(pageMayReturn(order, undefined, late), true)
})

test('the page leaves the order alone without its key, without a coin or once it is settled', async () => {
  const never = async () => assert.fail('no trade is built')
  assert.equal(pageCanSettle(order, newPageKey().secret), false)
  assert.equal(pageCanSettle({ ...order, contract: { routerKey: router.pubkey, refundAfter: contract.refundAfter } }, page.secret), false)
  assert.equal(pageCanSettle({ ...order, payoutTxid: 'ab'.repeat(32) }, page.secret), false)
  assert.equal(pageCanSettle({ ...order, state: 'completed' }, page.secret), false)
  assert.equal(await settleFromPage(order, page.secret, { coinsOf: async () => ({ tip: 1, utxos: [] }), trade: never }), undefined)
  await assert.rejects(settleFromPage({ ...order, depositAddress: refund.cashAddress }, page.secret, { trade: never }), /not its contract/)
})

// A sale contract (contracts/router-sale.cash) whose Router stopped: the tokens, or the BCH they sold for, go back once the
// refund time passes, through `expire`, which needs no key.
const vault = bindingFromPubkey(otherPubkey, 1)
const saleTerms = { routerKey: router.pubkey, vaultScript: vault.lockingBytecode, memo: '=:BASE.USDC:0xabc:0', refundScript: recipient.lockingBytecode, minSats: '50000', refundAfter: contract.refundAfter }
const saleOrder = {
  id: 's',
  recipientAddress: recipient.tokenAddress,
  refundAddress: recipient.tokenAddress,
  expectedBchSats: '60000',
  contract: { routerKey: router.pubkey, refundAfter: contract.refundAfter },
  depositAddress: saleBinding(saleTerms, 0).cashAddress,
  minPusd: '50000',
  sale: { category: BridgeConfig.pusd.category, tokenAmount: '500', buyAsset: 'BASE.USDC', destination: '0xabc', memo: saleTerms.memo, vaultAddress: vault.cashAddress },
  state: 'awaiting_deposit',
  attempts: []
}

test('a sale whose Router stopped sends its tokens back from the page after the refund time, without any key', async () => {
  const token = { category: BridgeConfig.pusd.category, amount: 500n, nft: false }
  const coins = [{ ...coin(0, 2000n), hasToken: true, token }, coin(1, 58000n), { ...coin(2, 2000n), hasToken: true, token: { ...token, nft: true } }]
  let sent
  const coinsOf = async () => ({ tip: 100, utxos: coins })
  const send = async (hex, id) => ((sent = hex), id)
  const late = (contract.refundAfter + 1) * 1000
  assert.equal(await returnFromPage(saleOrder, undefined, { coinsOf, send: async () => assert.fail('too early') }), undefined)
  assert.equal(pageMayReturn(saleOrder, page.secret), false, 'a page key cannot sign for a sale')
  assert.equal(pageMayReturn({ ...saleOrder, state: 'manual_review' }, undefined, late), false)
  assert.ok(await returnFromPage({ ...saleOrder, state: 'streaming' }, page.secret, { coinsOf, send, now: late }))
  const transaction = decodeTx(sent)
  const lockingBytecode = Buffer.from(saleBinding(saleTerms, 0).lockingBytecode, 'hex')
  const returned = coins.slice(0, 2)
  const sourceOutputs = returned.map(c => ({ lockingBytecode, valueSatoshis: c.value, ...(c.token && { token: { category: Buffer.from(c.token.category, 'hex'), amount: c.token.amount } }) }))
  assert.equal(createVirtualMachineBch2026(true).verify({ transaction, sourceOutputs }), true)
  assert.equal(transaction.locktime, contract.refundAfter)
  assert.equal(transaction.inputs.length, 2, 'the NFT is not the customer’s and stays')
  assert.equal(transaction.outputs[0].token.amount, 500n)
  assert.ok(!transaction.outputs[1].token && transaction.outputs[1].valueSatoshis + 2000n >= 58000n)
  transaction.outputs.forEach(output => assert.equal(Buffer.from(output.lockingBytecode).toString('hex'), recipient.lockingBytecode))
})
