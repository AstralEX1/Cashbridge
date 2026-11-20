import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shapeShiftAssetId, SHAPESHIFT_PROVIDER } from '../src/lib/shapeshift.ts'

describe('shapeShiftAssetId', () => {
  it('maps native BCH and BTC', () => {
    assert.equal(shapeShiftAssetId('BCH.BCH'), 'bip122:000000000000000000651ef99cb9fcbe/slip44:145')
    assert.equal(shapeShiftAssetId('BTC.BTC'), 'bip122:000000000019d6689c085ae165831e93/slip44:0')
  })

  it('maps Base USDC with lower-cased contract', () => {
    assert.equal(
      shapeShiftAssetId('BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913'),
      'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    )
  })

  it('maps known Solana USDC by restoring base58 casing', () => {
    assert.equal(
      shapeShiftAssetId('SOL.USDC-EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYTDT1V'),
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    )
  })

  it('maps Gnosis, Monad, MAYA, MegaETH and buy-side natives from ShapeShift /v1/chains', () => {
    assert.equal(shapeShiftAssetId('GNO.xDAI'), 'eip155:100/slip44:60')
    assert.equal(shapeShiftAssetId('MONAD.MON'), 'eip155:143/slip44:60')
    assert.equal(shapeShiftAssetId('MAYA.CACAO'), 'cosmos:mayachain-mainnet-v1/slip44:931')
    assert.equal(shapeShiftAssetId('MEGAETH.ETH'), 'eip155:4326/slip44:60')
    assert.equal(shapeShiftAssetId('NEAR.NEAR'), 'near:mainnet/slip44:397')
    assert.equal(shapeShiftAssetId('SUI.SUI'), 'sui:35834a8a/slip44:784')
    assert.equal(shapeShiftAssetId('TON.TON'), 'ton:mainnet/slip44:607')
  })

  it('rejects unknown chains and non-native bare tickers', () => {
    assert.equal(shapeShiftAssetId('XRP.XRP'), undefined)
    assert.equal(shapeShiftAssetId('THOR.TCY'), undefined)
    assert.equal(shapeShiftAssetId(undefined), undefined)
  })

  it('exports a distinct provider name', () => {
    assert.equal(SHAPESHIFT_PROVIDER, 'SHAPESHIFT')
  })
})

// A ShapeShift quote touching BCH is followed as the NEAR Intents swap behind it: 1Click's status of the deposit address
// must describe this exact transfer, or the route is refused.
describe('getShapeShiftBridgeRoute', async () => {
  const { bindingFromPubkey } = await import('../src/lib/bch.ts')
  const { pubkey, otherPubkey } = await import('./fixtures/bridge-fixtures.mjs')
  const { getShapeShiftBridgeRoute } = await import('../src/lib/shapeshift.ts')
  const USDC = 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913'
  const NEAR_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
  // The same Base USDC behind another 1Click row (as ShapeShift quotes BSC USDT through HOT's retired one), and a
  // different token on the same chain.
  const HOT_USDC = 'nep245:v2_1.omni.hot.tg:8453_test'
  const OTHER_TOKEN = 'nep141:base-0xfde4c96c8593536e31f229ea8f37b2ada2699bb2.omft.near'
  const SOURCE = '0x3333333333333333333333333333333333333333'
  const DEPOSIT = '0x5555555555555555555555555555555555555555'
  const to = bindingFromPubkey(pubkey, 0)
  const other = bindingFromPubkey(otherPubkey, 3)
  let edit = s => s
  let asked

  const fake = async (input, init) => {
    const url = String(input)
    if (url.includes('/v1/swap/rates'))
      return Response.json({ rates: [{ swapperName: 'NEAR Intents', buyAmountCryptoBaseUnit: '6000000', sellAmountCryptoBaseUnit: '25000000', supportsExternalPayment: true }] })
    if (url.endsWith('/v1/swap/quote')) {
      asked = JSON.parse(init.body)
      return Response.json({ quoteId: 'q-1', swapperName: 'NEAR Intents', sellAmountCryptoBaseUnit: asked.sellAmountCryptoBaseUnit, buyAmountAfterFeesCryptoBaseUnit: '6000000', depositAddress: DEPOSIT, expiresAt: Date.now() + 3600_000 })
    }
    if (url.endsWith('/v0/tokens'))
      return Response.json([
        { assetId: NEAR_USDC, decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        { assetId: HOT_USDC, decimals: 6, blockchain: 'base', symbol: 'USDC(DEPRECATED)', price: 1, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
        { assetId: OTHER_TOKEN, decimals: 6, blockchain: 'base', symbol: 'USDT', price: 1, contractAddress: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' },
        { assetId: 'nep141:bch.omft.near', decimals: 8, blockchain: 'bch', symbol: 'BCH', price: 400, contractAddress: null }
      ])
    if (url.includes('/v0/status?depositAddress='))
      return Response.json(
        edit({
          status: 'PENDING_DEPOSIT',
          correlationId: 'c-1',
          quoteResponse: {
            timestamp: '2030-01-01T00:00:00.000Z',
            signature: 'ed25519:s',
            quoteRequest: { swapType: 'EXACT_INPUT', originAsset: NEAR_USDC, destinationAsset: 'nep141:bch.omft.near', amount: asked.sellAmountCryptoBaseUnit, recipient: asked.receiveAddress, refundTo: asked.sendAddress, deadline: '2030-01-01T04:00:00.000Z' },
            quote: { depositAddress: DEPOSIT, amountIn: asked.sellAmountCryptoBaseUnit, amountOut: '6000000', minAmountOut: '5900000', deadline: '2030-01-04T00:00:00.000Z' }
          }
        })
      )
    throw new Error(`Unexpected fetch ${url}`)
  }
  const request = { sellAsset: USDC, buyAsset: 'BCH.BCH', sellAmount: '25', sellDecimals: 6, buyDecimals: 8, sourceAddress: SOURCE, destinationAddress: to.cashAddress }
  const withFetch = async run => {
    const original = globalThis.fetch
    globalThis.fetch = fake
    try {
      return await run()
    } finally {
      globalThis.fetch = original
      edit = s => s
    }
  }

  it('returns the NEAR leg with the swap deadline and the quote id', async () => {
    const route = await withFetch(() => getShapeShiftBridgeRoute(request))
    assert.equal(route.shapeshift.near.depositAddress, DEPOSIT)
    assert.equal(route.shapeshift.near.amountIn, '25000000')
    assert.equal(route.shapeshift.near.deadline, '2030-01-01T04:00:00.000Z', 'the refund deadline, not when the address goes inactive')
    assert.equal(route.shapeshift.near.shapeshiftQuoteId, 'q-1')
  })

  it('accepts the same token through another 1Click row', async () => {
    const route = await withFetch(() => {
      edit = s => ({ ...s, quoteResponse: { ...s.quoteResponse, quoteRequest: { ...s.quoteResponse.quoteRequest, originAsset: HOT_USDC } } })
      return getShapeShiftBridgeRoute(request)
    })
    assert.equal(route.shapeshift.near.depositAddress, DEPOSIT)
  })

  it('refuses a swap that pays or refunds someone else, takes another amount or token, or is not an exact one', async () => {
    const cases = [
      s => ({ ...s, quoteResponse: { ...s.quoteResponse, quoteRequest: { ...s.quoteResponse.quoteRequest, originAsset: OTHER_TOKEN } } }),
      s => ({ ...s, quoteResponse: { ...s.quoteResponse, quoteRequest: { ...s.quoteResponse.quoteRequest, destinationAsset: NEAR_USDC } } }),
      s => ({ ...s, quoteResponse: { ...s.quoteResponse, quoteRequest: { ...s.quoteResponse.quoteRequest, recipient: other.cashAddress } } }),
      s => ({ ...s, quoteResponse: { ...s.quoteResponse, quoteRequest: { ...s.quoteResponse.quoteRequest, refundTo: DEPOSIT } } }),
      s => ({ ...s, quoteResponse: { ...s.quoteResponse, quoteRequest: { ...s.quoteResponse.quoteRequest, swapType: 'FLEX_INPUT' } } }),
      s => ({ ...s, quoteResponse: { ...s.quoteResponse, quote: { ...s.quoteResponse.quote, amountIn: '1' } } }),
      s => ({ ...s, status: 'PROCESSING' })
    ]
    for (const change of cases) {
      await assert.rejects(
        withFetch(() => {
          edit = change
          return getShapeShiftBridgeRoute(request)
        }),
        /does not match/
      )
    }
  })
})
