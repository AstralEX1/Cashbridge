import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binToHex, generatePrivateKey, secp256k1 } from '@bitauth/libauth'
import { bindingFromPubkey } from '../src/lib/bch.ts'
import {
  assertLocalOnly,
  clearArrival,
  clearArrivalMemory,
  listPendingArrivals,
  loadArrival,
  prepareArrival,
  publicArrivalTerms,
  putArrivalMemory
} from '../src/lib/arrival-session.ts'
import { arrivalBinding } from '../src/lib/swap-on-arrival.ts'
import { BridgeConfig } from '../src/config.ts'
import { pubkey } from './fixtures/bridge-fixtures.mjs'

test('prepareArrival keeps the trade key local and rebuilds the same P2SH20', async () => {
  clearArrivalMemory()
  const owner = bindingFromPubkey(pubkey, 0)
  const session = await prepareArrival({
    ownerScript: owner.lockingBytecode,
    category: BridgeConfig.pusd.category,
    rateNum: '200',
    rateDen: '1000000'
  })
  assert.equal(session.tradePrivateKeyHex.length, 64)
  assert.equal(session.terms.tradeKey.length, 66)
  assert.match(session.address, /^bitcoincash:p[a-z0-9]{41}$/)
  assert.equal(session.lockingBytecode, arrivalBinding(session.terms, 0).lockingBytecode)

  const loaded = await loadArrival(session.address)
  assert.ok(loaded)
  assert.equal(loaded.tradePrivateKeyHex, session.tradePrivateKeyHex)

  const pub = publicArrivalTerms(session)
  assert.equal('tradePrivateKeyHex' in pub, false)
  assert.equal(pub.tradeKey, session.terms.tradeKey)

  assertLocalOnly(session)
  await clearArrival(session.address)
  assert.equal(await loadArrival(session.address), undefined)
})

test('listPendingArrivals and memory put work without IndexedDB', async () => {
  clearArrivalMemory()
  const owner = bindingFromPubkey(pubkey, 0)
  const privateKey = generatePrivateKey()
  const tradeKey = binToHex(secp256k1.derivePublicKeyCompressed(privateKey))
  const terms = {
    tradeKey,
    ownerScript: owner.lockingBytecode,
    category: BridgeConfig.pusd.category,
    rateNum: '10',
    rateDen: '100000',
    refundAfter: 2_000_000_000
  }
  const binding = arrivalBinding(terms, 0)
  putArrivalMemory({
    address: binding.cashAddress,
    lockingBytecode: binding.lockingBytecode,
    terms,
    tradePrivateKeyHex: binToHex(privateKey),
    createdAt: Date.now()
  })
  const listed = await listPendingArrivals()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].address, binding.cashAddress)
})
