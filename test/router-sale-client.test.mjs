import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { hexToBin, binToHex } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx } from '../src/lib/bch.ts'
import { saleBinding } from '../src/lib/router-contract.ts'
import { pubkey, otherPubkey } from './fixtures/bridge-fixtures.mjs'

globalThis.localStorage ??= { length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { buildTokenSend, SALE_COIN_SATS } = await import('../src/lib/router-sale-client.ts')
const { orderRequest } = await import('../src/lib/auto-bridge-client.ts')

const customer = bindingFromPubkey(pubkey, 0)
const vault = bindingFromPubkey(otherPubkey, 7)
const category = 'ab'.repeat(32)
const token = { category, ticker: 'TKN' }
const terms = {
  routerKey: bindingFromPubkey(otherPubkey, 1).pubkey,
  vaultScript: vault.lockingBytecode,
  memo: '=:e:0x1111111111111111111111111111111111111111:0/1/0',
  refundScript: customer.lockingBytecode,
  minSats: '300000',
  refundAfter: 1_800_000_000
}
const contract = saleBinding(terms, 0)
const coin = (vout, value, amount) => ({ txid: String(vout).padStart(64, '0'), vout, value, height: 1, hasToken: amount !== undefined, ...(amount !== undefined && { token: { category, amount, nft: false } }) })

test('the token send pays the contract the exact amount with its BCH, and returns token and BCH change', () => {
  const sent = buildTokenSend([coin(1, 1000n, 70n), coin(2, 1000n, 50n), coin(3, 20000n)], customer, token, 100n, contract.lockingBytecode)
  const tx = decodeTx(sent.unsignedHex)
  assert.equal(binToHex(tx.outputs[0].lockingBytecode), contract.lockingBytecode)
  assert.equal(tx.outputs[0].valueSatoshis, SALE_COIN_SATS)
  assert.equal(tx.outputs[0].token.amount, 100n)
  assert.equal(binToHex(tx.outputs[0].token.category), category)
  assert.equal(tx.outputs[1].token.amount, 20n, 'token change back to the wallet')
  assert.equal(binToHex(tx.outputs[1].lockingBytecode), customer.lockingBytecode)
  assert.ok(!tx.outputs[2].token && binToHex(tx.outputs[2].lockingBytecode) === customer.lockingBytecode)
  assert.deepEqual(sent.ownIndexes, [0, 1, 2])
  const fee = 22000n - tx.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
  assert.equal(fee, sent.feeSats)
  assert.ok(fee > 300n && fee < 1500n)
  assert.throws(() => buildTokenSend([coin(1, 1000n, 70n), coin(3, 20000n)], customer, token, 100n, contract.lockingBytecode), /holds less TKN/)
  assert.throws(() => buildTokenSend([coin(1, 1000n, 100n)], customer, token, 100n, contract.lockingBytecode), /plain BCH/)
})

test('a sale order is accepted only when its deposit is the sale contract of its terms', async () => {
  const sale = { category, tokenAmount: '100', buyAsset: 'ETH.ETH', destination: '0x1111111111111111111111111111111111111111', memo: terms.memo, vaultAddress: vault.cashAddress }
  const intent = { recipientAddress: customer.tokenAddress, refundAddress: customer.tokenAddress, expectedBchSats: '310000', sale }
  const reference = { id: randomUUID(), capability: randomBytes(32).toString('hex'), intent }
  let answer = { contract: { routerKey: terms.routerKey, refundAfter: terms.refundAfter }, depositAddress: contract.cashAddress, sale }
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ id: reference.id, ...intent, minPusd: terms.minSats, ...answer })
  try {
    assert.equal((await orderRequest(reference, 'GET')).depositAddress, contract.cashAddress)
    answer = { ...answer, sale: { ...sale, memo: '=:e:0x2222222222222222222222222222222222222222:0/1/0' } }
    await assert.rejects(orderRequest(reference, 'GET'), /does not match/, 'another memo')
    answer = { ...answer, sale, depositAddress: saleBinding({ ...terms, vaultScript: customer.lockingBytecode }, 0).cashAddress }
    await assert.rejects(orderRequest(reference, 'GET'), /not its contract/, 'another vault')
    answer = { ...answer, depositAddress: customer.cashAddress }
    await assert.rejects(orderRequest(reference, 'GET'), /not its contract/, 'a plain Router address')
    answer = { depositAddress: contract.cashAddress, sale }
    await assert.rejects(orderRequest(reference, 'GET'), /not its contract/, 'no contract terms')
  } finally {
    globalThis.fetch = oldFetch
  }
})
