import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindingFromPubkey } from '../src/lib/bch.ts'
import { prepareArrivalDestination, swapOnArrivalEnabled } from '../src/lib/arrival-prepare.ts'
import { clearArrivalMemory, loadArrival } from '../src/lib/arrival-session.ts'
import { BridgeConfig } from '../src/config.ts'
import { PUSD_TOKEN } from '../src/lib/cauldron-tokens.ts'
import { pubkey } from './fixtures/bridge-fixtures.mjs'

test('swapOnArrival follows BridgeConfig', () => {
  assert.equal(swapOnArrivalEnabled(), BridgeConfig.swapOnArrival)
})

test('prepareArrivalDestination builds a contract destination and stores the local key', async () => {
  clearArrivalMemory()
  const owner = bindingFromPubkey(pubkey, 0)
  const dest = await prepareArrivalDestination({
    owner,
    token: PUSD_TOKEN,
    expectedBchSats: 1_000_000n,
    expectedTokenUnits: 200n
  })
  if (!BridgeConfig.swapOnArrival) {
    assert.equal(dest.mode, 'wallet')
    return
  }
  assert.equal(dest.mode, 'arrival')
  assert.match(dest.binding.cashAddress, /^bitcoincash:p/)
  assert.notEqual(dest.binding.cashAddress, owner.cashAddress)
  assert.equal(dest.terms.ownerScript, owner.lockingBytecode)
  const session = await loadArrival(dest.binding.cashAddress)
  assert.ok(session)
  assert.equal(session.tradePrivateKeyHex.length, 64)
})

test('prepareArrivalDestination falls back when the floor is zero', async () => {
  clearArrivalMemory()
  const owner = bindingFromPubkey(pubkey, 0)
  const dest = await prepareArrivalDestination({
    owner,
    token: PUSD_TOKEN,
    expectedBchSats: 1_000_000n,
    expectedTokenUnits: 0n
  })
  assert.equal(dest.mode, 'wallet')
  assert.equal(dest.binding.cashAddress, owner.cashAddress)
  assert.equal(dest.reason, 'missing_quote')
})
