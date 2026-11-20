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

  it('rejects unknown chains and non-native bare tickers', () => {
    assert.equal(shapeShiftAssetId('XRP.XRP'), undefined)
    assert.equal(shapeShiftAssetId('THOR.TCY'), undefined)
    assert.equal(shapeShiftAssetId(undefined), undefined)
  })

  it('exports a distinct provider name', () => {
    assert.equal(SHAPESHIFT_PROVIDER, 'SHAPESHIFT')
  })
})
