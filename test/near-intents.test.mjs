// NEAR Intents (1Click) as the bridge's second route: token matching, the quote request, the route built from
// the answer, the status the tracker acts on, and the on-chain check of a payout without a memo.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexToBin } from '@bitauth/libauth'
import { checkPayment, bindingFromPubkey, decodeTx, txidOf } from '../src/lib/bch.ts'
import { findNearToken, interpretNearStatus, isNearRoute, nearLegOf, nearQuoteBody, nearRoute, NEAR_BCH } from '../src/lib/near-intents.ts'
import { bestRoute, nearSlippageBps } from '../src/hooks/use-quote.ts'
import { isBridgeRoute } from '../src/lib/api.ts'
import { otherPubkey, outboundTx, PUSD, pubkey } from './fixtures/bridge-fixtures.mjs'

// Entries shaped as /v0/tokens lists them.
const TOKENS = [
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { assetId: 'nep141:base.omft.near', decimals: 18, blockchain: 'base', symbol: 'ETH', price: 1800, contractAddress: null },
  { assetId: 'nep141:eth.omft.near', decimals: 18, blockchain: 'eth', symbol: 'ETH', price: 1800, contractAddress: null },
  { assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', decimals: 6, blockchain: 'sol', symbol: 'USDC', price: 1, contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { assetId: 'nep141:btc.omft.near', decimals: 8, blockchain: 'btc', symbol: 'BTC', price: 63000 },
  { assetId: '1cs_v1:btc:native:coin', decimals: 8, blockchain: 'btc', symbol: 'BTC(OMNI)', price: 63000 },
  { assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', decimals: 6, blockchain: 'tron', symbol: 'USDT', price: 1, contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  { assetId: 'nep141:xrp.omft.near', decimals: 6, blockchain: 'xrp', symbol: 'XRP', price: 1 },
  { assetId: NEAR_BCH, decimals: 8, blockchain: 'bch', symbol: 'BCH', price: 207, contractAddress: null }
]
const usdc = TOKENS[0]
const bch = TOKENS.at(-1)
const binding = bindingFromPubkey(pubkey, 0)

test('THORChain identifiers map to 1Click tokens by chain and contract, or by ticker for a chain’s own coin', () => {
  assert.equal(findNearToken(TOKENS, 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913')?.assetId, usdc.assetId)
  assert.equal(findNearToken(TOKENS, 'BASE.ETH')?.assetId, 'nep141:base.omft.near')
  assert.equal(findNearToken(TOKENS, 'ETH.ETH')?.assetId, 'nep141:eth.omft.near')
  assert.equal(findNearToken(TOKENS, 'BCH.BCH')?.assetId, NEAR_BCH)
  assert.equal(findNearToken(TOKENS, 'BTC.BTC')?.assetId, 'nep141:btc.omft.near')
  // THORChain upper-cases base58 contracts too.
  assert.equal(findNearToken(TOKENS, 'TRON.USDT-TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T')?.decimals, 6)
  assert.equal(findNearToken(TOKENS, 'SOL.USDC-EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYTDT1V')?.decimals, 6)
  assert.equal(findNearToken(TOKENS, 'BASE.USDC-0X0000000000000000000000000000000000000001'), undefined)
  // Not listed by 1Click, or a deposit that needs a memo the wallet send does not carry.
  assert.equal(findNearToken(TOKENS, 'DOGE.DOGE'), undefined)
  assert.equal(findNearToken(TOKENS, 'XRP.XRP'), undefined)
})

test('a forward quote asks exact input in base units, pays the plain BCH address and refunds the source', () => {
  const now = Date.parse('2030-01-01T07:00:00Z')
  const body = nearQuoteBody({ sellAsset: 'BASE.USDC-0X8335', buyAsset: 'BCH.BCH', sellAmount: '5.1234567', recipient: binding.cashAddress, refundTo: '0xabc', dry: false, slippageBps: 100, now }, usdc, bch)
  assert.equal(body.amount, '5123456', 'extra precision is cut, never rounded up')
  assert.equal(body.swapType, 'EXACT_INPUT')
  assert.equal(body.recipient, binding.cashAddress)
  assert.ok(body.recipient.startsWith('bitcoincash:q'), '1Click refuses token-aware z… addresses')
  assert.equal(body.refundTo, '0xabc')
  assert.equal(body.deadline, '2030-01-01T08:00:00.000Z')
  assert.equal(body.originAsset, usdc.assetId)
  assert.equal(body.destinationAsset, NEAR_BCH)
  assert.equal(body.dry, false)
})

test('a dry quote carries placeholder addresses of each side’s chain, and coming out waits longer', () => {
  const now = 0
  const forward = nearQuoteBody({ sellAsset: 'x', buyAsset: 'BCH.BCH', sellAmount: '1', dry: true, slippageBps: 100, now }, usdc, bch)
  assert.ok(forward.recipient.startsWith('bitcoincash:q'))
  assert.ok(forward.refundTo.startsWith('0x'))
  const fromBitcoin = nearQuoteBody({ sellAsset: 'BTC.BTC', buyAsset: 'BCH.BCH', sellAmount: '0.0001', dry: true, slippageBps: 100, now }, TOKENS[4], bch)
  assert.equal(fromBitcoin.refundTo, '122ALQhLw63cHbrSnTG9uuUao8SNd3S7K2', 'a refund placeholder of the source chain')
  assert.equal(fromBitcoin.amount, '10000')
  const reverse = nearQuoteBody({ sellAsset: 'BCH.BCH', buyAsset: 'x', sellAmount: '0.1', dry: true, slippageBps: 100, flexible: true, now }, bch, usdc)
  assert.ok(reverse.refundTo.startsWith('bitcoincash:'))
  assert.equal(reverse.swapType, 'FLEX_INPUT')
  assert.equal(Date.parse(reverse.deadline), 4 * 60 * 60_000)
})

const answer = {
  correlationId: 'c0ffee',
  timestamp: '2030-01-01T07:00:00.000Z',
  signature: 'ed25519:sig',
  quote: {
    depositAddress: '0x76b4c56085ED136a8744D52bE956396624a730E8',
    amountIn: '5000000',
    amountInFormatted: '5',
    minAmountIn: '5000000',
    amountOut: '2400565',
    amountOutFormatted: '0.02400565',
    minAmountOut: '2376559',
    deadline: '2030-01-01T08:00:00.000Z',
    timeEstimate: 152
  }
}

test('the 1Click answer becomes a NEAR route the bridge checks like any other', () => {
  const request = { sellAsset: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', buyAsset: 'BCH.BCH', sellAmount: '5', recipient: binding.cashAddress, refundTo: '0xabc', sourceAddress: '0xabc', dry: false, slippageBps: 100 }
  const route = nearRoute(answer, request, usdc, bch)
  assert.ok(isNearRoute(route))
  assert.equal(route.sellAmount, '5')
  assert.equal(route.expectedBuyAmount, '0.02400565')
  assert.equal(route.expectedBuyAmountMaxSlippage, '0.02376559')
  assert.equal(route.inboundAddress, answer.quote.depositAddress)
  assert.equal(route.expiration, String(Date.parse(answer.quote.deadline) / 1000))
  assert.equal(route.estimatedTime.total, 152)
  assert.equal(route.memo, undefined)
  assert.equal(route.meta.near.sellAsset, usdc.assetId, 'the deposit plugin needs it')
  assert.ok(isBridgeRoute(route, { sellAsset: request.sellAsset, destinationAddress: binding.cashAddress }))
  assert.ok(isBridgeRoute(route, { sellAsset: request.sellAsset, destinationAddress: binding.tokenAddress }), 'z… and q… pay the same script')
  assert.equal(isBridgeRoute(route, { sellAsset: request.sellAsset, destinationAddress: bindingFromPubkey(otherPubkey, 0).cashAddress }), false)
  // A route that only claims to be NEAR's (no 1Click answer kept) is not one this app built.
  const { near, ...claimed } = route
  assert.equal(isBridgeRoute(claimed, { sellAsset: request.sellAsset }), false)
  assert.deepEqual(nearLegOf(route), {
    depositAddress: answer.quote.depositAddress,
    correlationId: 'c0ffee',
    signature: 'ed25519:sig',
    quotedAt: answer.timestamp,
    deadline: answer.quote.deadline,
    amountIn: '5000000',
    amountOut: '2400565',
    minAmountOut: '2376559'
  })
  assert.ok(near)
})

test('the better route is taken, THORChain on a tie or when NEAR does not quote', () => {
  const thor = { expectedBuyAmount: '0.024' }
  assert.equal(bestRoute({ thorchain: thor, near: { expectedBuyAmount: '0.0241' } }), 'near')
  assert.equal(bestRoute({ thorchain: thor, near: { expectedBuyAmount: '0.024' } }), 'thorchain')
  assert.equal(bestRoute({ thorchain: thor }), 'thorchain')
  assert.equal(bestRoute({ near: { expectedBuyAmount: '0.01' } }), 'near')
  assert.equal(bestRoute(undefined), undefined)
  assert.equal(nearSlippageBps(1), 100)
  assert.equal(nearSlippageBps(undefined), 100)
  assert.equal(nearSlippageBps(0.5), 50)
})

test('1Click status: payout hashes are pointers to check on chain; refunds, failures and short deposits are told apart', () => {
  const paid = { hash: 'ab'.repeat(32), explorerUrl: '' }
  assert.deepEqual(interpretNearStatus({ status: 'SUCCESS', swapDetails: { destinationChainTxHashes: [paid], amountOut: '1' } }), { kind: 'paid', txids: [paid.hash], amountOut: '1' })
  assert.equal(interpretNearStatus({ status: 'SUCCESS', swapDetails: {} }).kind, 'pending')
  assert.equal(interpretNearStatus({ status: 'PROCESSING', swapDetails: { destinationChainTxHashes: [paid] } }).kind, 'paid', 'a payout on its way counts')
  assert.equal(interpretNearStatus({ status: 'PENDING_DEPOSIT' }).kind, 'pending')
  assert.equal(interpretNearStatus({ status: 'KNOWN_DEPOSIT_TX' }).kind, 'pending')
  assert.ok(interpretNearStatus({ status: 'INCOMPLETE_DEPOSIT' }).detail)
  assert.deepEqual(interpretNearStatus({ status: 'REFUNDED', swapDetails: { refundedAmount: '4990000', refundedAmountFormatted: '4.99', refundReason: 'X' } }), {
    kind: 'refunded',
    amount: '499000000',
    reason: 'X'
  })
  assert.equal(interpretNearStatus({ status: 'FAILED' }).kind, 'failed')
})

test('a payout without a memo is counted only from its plain outputs to the bound address', () => {
  const ownScript = hexToBin(binding.lockingBytecode)
  const hex = outboundTx({ to: ownScript, amount: 2_400_000n, memo: 'anything' })
  const raw = { hex, tx: decodeTx(hex) }
  const txid = txidOf(hex)
  const ok = checkPayment(raw, binding.lockingBytecode, { tip: 10, utxos: [{ txid, vout: 0, value: 2_400_000n, height: 0, hasToken: false }] })
  assert.equal(ok.kind, 'ok')
  assert.equal(ok.total, '2400000')
  assert.equal(ok.outputs[0].unspent, true)
  assert.equal(ok.confirmations, 0)
  const other = bindingFromPubkey(otherPubkey, 0)
  assert.equal(checkPayment(raw, other.lockingBytecode, { tip: 10, utxos: [] }).kind, 'invalid')
  const tokenHex = outboundTx({ to: ownScript, amount: 1000n, token: { category: hexToBin(PUSD), amount: 1n } })
  assert.equal(checkPayment({ hex: tokenHex, tx: decodeTx(tokenHex) }, binding.lockingBytecode, { tip: 10, utxos: [] }).kind, 'invalid')
})
