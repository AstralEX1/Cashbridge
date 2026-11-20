import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  binToHex,
  createVirtualMachineBch2026,
  encodeTransaction,
  generatePrivateKey,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1
} from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, sourcesOf, reviewBuild, tradeTransaction } from '../src/lib/cauldron.ts'
import {
  arrivalCanClearFloor,
  buildArrivalReturn,
  buildArrivalSwapLocal,
  completeArrivalTrade
} from '../src/lib/arrival-trade.ts'
import {
  arrivalBinding,
  arrivalMinimum,
  arrivalRedeemScript,
  arrivalUnlock,
  ARRIVAL_REFUND_FEE_CAP
} from '../src/lib/swap-on-arrival.ts'
import { BridgeConfig } from '../src/config.ts'
import { pubkey } from './fixtures/bridge-fixtures.mjs'

const tradeKey = generatePrivateKey()
const tradePub = binToHex(secp256k1.derivePublicKeyCompressed(tradeKey))
const owner = bindingFromPubkey(pubkey, 0)
const baseTerms = {
  tradeKey: tradePub,
  ownerScript: owner.lockingBytecode,
  category: BridgeConfig.pusd.category,
  rateNum: '200',
  rateDen: '1000000',
  refundAfter: 1_800_000_000
}
const vm = createVirtualMachineBch2026(true)

const sign = (transaction, sourceOutputs, inputIndex, terms, key = tradeKey) => {
  const preimage = generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode: arrivalRedeemScript(terms), signingSerializationType: Uint8Array.of(0x61) }
  )
  return Uint8Array.from([...secp256k1.signMessageHashSchnorr(key, hash256(preimage)), 0x61])
}

const pool = () => {
  const withdraw = new Uint8Array(20).fill(7)
  return {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdraw },
    outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
    output: {
      locking_bytecode: poolLockingBytecode(withdraw),
      token: { amount: 30000n, token_id: BridgeConfig.pusd.category },
      amount: 108000000n
    }
  }
}

test('buildArrivalSwapLocal clears the contract floor and verifies under the trade key', () => {
  const funding = [{ txid: 'ee'.repeat(32), vout: 0, value: '1000000' }]
  const reviewed = buildArrivalSwapLocal(baseTerms, funding, 990000n, [pool()])
  assert.ok(reviewed.output >= 200n)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  reviewed.ownIndexes.forEach(i => {
    transaction.inputs[i].unlockingBytecode = arrivalUnlock(baseTerms, 'swap', sign(transaction, sourceOutputs, i, baseTerms))
  })
  assert.equal(vm.verify({ transaction, sourceOutputs }), true)
  const size = BigInt(encodeTransaction(transaction).length)
  const fee =
    sourceOutputs.reduce((sum, s) => sum + s.valueSatoshis, 0n) - transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
  assert.ok(fee >= size)
})

test('arrivalCanClearFloor reports soft below-floor vs ok', () => {
  assert.equal(arrivalCanClearFloor(baseTerms, 1000000n, 200n).ok, true)
  assert.equal(arrivalCanClearFloor(baseTerms, 1000000n, 199n).ok, false)
  assert.equal(arrivalMinimum(baseTerms, 500000n), 100n)
})

test('completeArrivalTrade returns Waiting when no coins are present', async () => {
  const status = await completeArrivalTrade({
    terms: baseTerms,
    tradePrivateKeyHex: binToHex(tradeKey),
    coins: [],
    broadcast: false
  })
  assert.deepEqual(status, { kind: 'Waiting', reason: 'no_coin' })
})

test('buildArrivalReturn release and reclaim verify; fee cap and stranger fail', async () => {
  const coin = { txid: '09'.repeat(32), vout: 0, value: '1000000' }
  const released = await buildArrivalReturn({
    terms: baseTerms,
    tradePrivateKeyHex: binToHex(tradeKey),
    coin,
    mode: 'release',
    broadcast: false
  })
  assert.equal(released.kind, 'Released')

  const early = await buildArrivalReturn({
    terms: baseTerms,
    coin,
    mode: 'reclaim',
    locktime: baseTerms.refundAfter - 1,
    broadcast: false
  })
  assert.deepEqual(early, { kind: 'Waiting', reason: 'confirming' })

  const reclaimed = await buildArrivalReturn({
    terms: baseTerms,
    coin,
    mode: 'reclaim',
    locktime: baseTerms.refundAfter,
    broadcast: false
  })
  assert.equal(reclaimed.kind, 'Reclaimed')

  await assert.rejects(
    () =>
      buildArrivalReturn({
        terms: baseTerms,
        tradePrivateKeyHex: binToHex(tradeKey),
        coin,
        mode: 'release',
        fee: ARRIVAL_REFUND_FEE_CAP + 1n,
        broadcast: false
      }),
    err => err instanceof Error && /fee exceeds|TradeLayoutError/i.test(err.message)
  )

  await assert.rejects(
    () =>
      buildArrivalReturn({
        terms: baseTerms,
        tradePrivateKeyHex: binToHex(generatePrivateKey()),
        coin,
        mode: 'release',
        broadcast: false
      }),
    err => err instanceof Error && /does not verify|TradeLayoutError/i.test(err.message)
  )
})

test('local swap below floor fails review', () => {
  const funding = [{ txid: 'ee'.repeat(32), vout: 0, value: '1000000' }]
  const highFloor = { ...baseTerms, rateNum: '999999' }
  assert.throws(() => buildArrivalSwapLocal(highFloor, funding, 990000n, [pool()]))
})
