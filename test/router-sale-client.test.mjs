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

// A routed sale is quoted on the BCH the Router is sure to deposit: NEAR takes a flexible amount down to the floor less
// the fee cap; ShapeShift an exact amount, less the change back too.
test('a routed sale quotes NEAR on the floor less the fee cap, and ShapeShift on an exact amount', async () => {
  const { routedDeposit } = await import('../src/lib/router-sale-client.ts')
  const { ROUTE_MEMO } = await import('../src/lib/auto-bridge-contract.ts')
  const { REFUND_FEE_CAP, SALE_EXACT_RESERVE } = await import('../src/lib/router-contract.ts')
  const { minOutputFor } = await import('../src/lib/bridge.ts')
  const USDC = 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913'
  const NEAR_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
  const destination = '0x1111111111111111111111111111111111111111'
  const bchOut = 1_000_000n
  const floor = minOutputFor(bchOut, 300)
  let nearAsked, shapeAsked
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/tokens'))
      return Response.json([
        { assetId: NEAR_USDC, decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        { assetId: 'nep141:bch.omft.near', decimals: 8, blockchain: 'bch', symbol: 'BCH', price: 400, contractAddress: null }
      ])
    if (url.endsWith('/quote') && !url.includes('shapeshift')) {
      nearAsked = JSON.parse(init.body)
      return Response.json({ correlationId: 'c', timestamp: 't', signature: 's', quote: { depositAddress: vault.cashAddress, amountIn: nearAsked.amount, minAmountIn: nearAsked.amount, amountOut: '3900000', minAmountOut: '3800000', deadline: nearAsked.deadline } })
    }
    if (url.includes('/v1/swap/rates')) return Response.json({ rates: [{ swapperName: 'NEAR Intents', buyAmountCryptoBaseUnit: '3900000', supportsExternalPayment: true }] })
    if (url.endsWith('/v1/swap/quote')) {
      shapeAsked = JSON.parse(init.body)
      return Response.json({ quoteId: 'q-9', swapperName: 'NEAR Intents', sellAmountCryptoBaseUnit: shapeAsked.sellAmountCryptoBaseUnit, buyAmountAfterFeesCryptoBaseUnit: '3900000', depositAddress: vault.cashAddress, expiresAt: Date.now() + 3600_000 })
    }
    if (url.includes('/status?depositAddress='))
      return Response.json({
        status: 'PENDING_DEPOSIT',
        correlationId: 'c-9',
        quoteResponse: {
          timestamp: 't',
          signature: 's',
          quoteRequest: { swapType: 'EXACT_INPUT', originAsset: 'nep141:bch.omft.near', destinationAsset: NEAR_USDC, amount: shapeAsked.sellAmountCryptoBaseUnit, recipient: shapeAsked.receiveAddress, refundTo: shapeAsked.sendAddress, deadline: '2030-01-01T04:00:00.000Z' },
          quote: { depositAddress: vault.cashAddress, amountIn: shapeAsked.sellAmountCryptoBaseUnit, amountOut: '3900000', minAmountOut: '3800000' }
        }
      })
    throw new Error(`Unexpected fetch ${url}`)
  }
  try {
    const near = await routedDeposit({ route: 'near', bchOut, binding: customer, buyAsset: USDC, destination, slippage: 1 })
    assert.equal(nearAsked.swapType, 'FLEX_INPUT')
    assert.equal(nearAsked.amount, (floor - REFUND_FEE_CAP).toString())
    assert.equal(nearAsked.recipient, destination)
    assert.equal(nearAsked.refundTo, customer.cashAddress)
    assert.deepEqual(near.sale, { memo: ROUTE_MEMO, vaultAddress: vault.cashAddress, route: 'near' })

    const shape = await routedDeposit({ route: 'shapeshift', bchOut, binding: customer, buyAsset: USDC, buyDecimals: 6, destination, slippage: 1 })
    assert.equal(shapeAsked.sellAmountCryptoBaseUnit, (floor - SALE_EXACT_RESERVE).toString())
    assert.deepEqual(shape.sale, { memo: ROUTE_MEMO, vaultAddress: vault.cashAddress, route: 'shapeshift', depositSats: (floor - SALE_EXACT_RESERVE).toString(), quoteId: 'q-9' })
    assert.equal(shape.near.shapeshiftQuoteId, 'q-9')
  } finally {
    globalThis.fetch = oldFetch
  }
})
