import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexToBin } from '@bitauth/libauth'
import { sourceTransactionId, sameSourceTransaction, sourceIdFromMemo } from '../src/lib/source-transaction.ts'
import { bindingFromPubkey, checkOutbound, decodeTx, txidOf } from '../src/lib/bch.ts'
import { thorTxId } from '../src/lib/api.ts'
import { outboundTx, pubkey } from './fixtures/bridge-fixtures.mjs'

const solana = 'AbCdEfGhJkMnPqRsTuVwXyZ123456789'.repeat(4).slice(0, 88)
test('source identifiers retain Solana case, accept indexed Cosmos and canonicalize only hex', () => {
  assert.equal(sourceTransactionId(solana), solana)
  assert.equal(sourceTransactionId(solana.slice(1)), solana.slice(1))
  assert.equal(thorTxId(solana), solana)
  assert.equal(sourceTransactionId('0x' + 'AB'.repeat(32)), 'ab'.repeat(32))
  assert.equal(sourceTransactionId('AB'.repeat(32) + '-12'), 'ab'.repeat(32) + '-12')
  assert.equal(sameSourceTransaction(solana, solana.toUpperCase()), false)
  assert.equal(sourceTransactionId('not-a-payment'), undefined)
  assert.equal(sourceTransactionId('../' + 'ab'.repeat(32)), undefined)
})

test('Sui digests keep their base58 case', () => {
  const digest = 'Ckj3Fbk3Yw4V3bBYRdVr1ZtLUfiQbyPjSU4XaDbswDtV'
  assert.equal(sourceTransactionId(digest), digest)
  assert.equal(sameSourceTransaction(digest, digest.toLowerCase()), false)
  assert.equal(sourceTransactionId(digest.slice(0, 40)), undefined)
})
test('BCH outbound review binds case-sensitive and indexed source memos to the right payment', () => {
  const binding = bindingFromPubkey(pubkey, 0)
  for (const id of [solana, 'AB'.repeat(32) + '-1']) {
    const hex = outboundTx({ to: hexToBin(binding.lockingBytecode), amount: 1000000n, memo: `OUT:${id}` })
    const txid = txidOf(hex)
    const context = { inboundHash: id, lockingBytecode: binding.lockingBytecode, expectedSats: 1000000n }
    const unspent = { tip: 100, utxos: [{ txid, vout: 0, value: 1000000n, height: 100, hasToken: false }] }
    assert.equal(checkOutbound({ hex, tx: decodeTx(hex) }, context, unspent).kind, 'ok')
    if (id === solana) assert.equal(checkOutbound({ hex, tx: decodeTx(hex) }, { ...context, inboundHash: id.toUpperCase() }, unspent).kind, 'invalid')
    assert.equal(sourceIdFromMemo(`REFUND:${id}`), undefined)
    assert.equal(sourceIdFromMemo(`REFUND:${id}`, 'REFUND'), sourceTransactionId(id))
  }
})
