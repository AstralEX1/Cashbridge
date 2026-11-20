import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
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
  arrivalBinding,
  arrivalMinimum,
  arrivalRedeemScript,
  arrivalUnlock,
  parseArrivalUnlock,
  ARRIVAL_REFUND_FEE_CAP
} from '../src/lib/swap-on-arrival.ts'
import { BridgeConfig } from '../src/config.ts'
import { otherPubkey, pubkey } from './fixtures/bridge-fixtures.mjs'

// Browser-held trade key — never a Cashbridge service key.
const tradeKey = generatePrivateKey()
const tradePub = binToHex(secp256k1.derivePublicKeyCompressed(tradeKey))
const owner = bindingFromPubkey(pubkey, 0)
const stranger = bindingFromPubkey(otherPubkey, 0)
// Full bridge promise: 1_000_000 sats → at least 200 token units.
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
    output: { locking_bytecode: poolLockingBytecode(withdraw), token: { amount: 30000n, token_id: BridgeConfig.pusd.category }, amount: 108000000n }
  }
}

const swap = ({ terms = baseTerms, coins = ['1000000'], payTo = terms.ownerScript, key = tradeKey, sell = 990000n } = {}) => {
  const contract = arrivalBinding(terms, 0)
  const funding = coins.map((value, vout) => ({ txid: 'ee'.repeat(32), vout, value, confirmations: 0, unspent: true }))
  const intent = {
    category: BridgeConfig.pusd.category,
    side: 'buy',
    funding,
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: '',
    cashAddress: '',
    payout: { tokenScript: payTo, changeScript: terms.ownerScript },
    sell,
    minOutput: 1n,
    ownUnlockBytes: arrivalUnlock(terms, 'swap', new Uint8Array(65)).length + 2
  }
  const build = tradeTransaction(bestTrade([pool()], sell), intent)
  const reviewed = reviewBuild(build, intent)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  reviewed.ownIndexes.forEach(i => (transaction.inputs[i].unlockingBytecode = arrivalUnlock(terms, 'swap', sign(transaction, sourceOutputs, i, terms, key))))
  return { result: vm.verify({ transaction, sourceOutputs }), reviewed, transaction, sourceOutputs, contract }
}

// release / reclaim: exactly one input and one BCH output to the owner (Hashi shape).
const reclaimTx = ({ fn = 'release', terms = baseTerms, value = 1000000n, payTo = terms.ownerScript, fee = 400n, locktime = 0, key = tradeKey } = {}) => {
  const contract = hexToBin(arrivalBinding(terms, 0).lockingBytecode)
  const transaction = {
    version: 2,
    locktime,
    inputs: [{ outpointTransactionHash: new Uint8Array(32).fill(9), outpointIndex: 0, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() }],
    outputs: [{ lockingBytecode: hexToBin(payTo), valueSatoshis: value - fee }]
  }
  const sourceOutputs = [{ lockingBytecode: contract, valueSatoshis: value }]
  transaction.inputs[0].unlockingBytecode = arrivalUnlock(terms, fn, fn === 'reclaim' ? undefined : sign(transaction, sourceOutputs, 0, terms, key))
  return vm.verify({ transaction, sourceOutputs })
}

test('the redeem script carries the compiled contract and its address is a P2SH20 a bridge can pay', () => {
  const artifact = JSON.parse(readFileSync(new URL('../contracts/swap-on-arrival.json', import.meta.url), 'utf8'))
  assert.ok(binToHex(arrivalRedeemScript(baseTerms)).endsWith(artifact.debug.bytecode))
  const binding = arrivalBinding(baseTerms, 3)
  assert.match(binding.cashAddress, /^bitcoincash:p[a-z0-9]{41}$/)
  assert.match(binding.lockingBytecode, /^a914[0-9a-f]{40}87$/)
  assert.notEqual(arrivalBinding({ ...baseTerms, rateNum: '201' }, 3).cashAddress, binding.cashAddress)
  assert.equal(arrivalMinimum(baseTerms, 1000000n), 200n)
  assert.equal(arrivalMinimum(baseTerms, 500000n), 100n, 'short deposit scales the floor')
  assert.equal(arrivalMinimum(baseTerms, 2000000n), 200n, 'overpay does not raise the floor')
})

test('the browser trade key can buy at least the floor to the owner; BCH never needs a Cashbridge wallet', () => {
  const { result, reviewed, transaction, contract } = swap()
  assert.equal(result, true)
  assert.ok(reviewed.output >= 200n)
  assert.match(contract.cashAddress, /^bitcoincash:p/)
  const unlock = transaction.inputs[reviewed.ownIndexes[0]].unlockingBytecode
  assert.equal(binToHex(parseArrivalUnlock(baseTerms)(unlock).pubkey), tradePub)
  assert.equal(parseArrivalUnlock({ ...baseTerms, rateNum: '201' })(unlock), undefined)
})

test('a swap fails below the floor, to anyone else, under another key, or with two coins on one payout', () => {
  const { reviewed } = swap()
  assert.notEqual(swap({ terms: { ...baseTerms, rateNum: (reviewed.output + 1n).toString(), rateDen: '1000000' } }).result, true)
  assert.notEqual(swap({ payTo: stranger.lockingBytecode }).result, true)
  assert.notEqual(swap({ key: generatePrivateKey() }).result, true)
  assert.notEqual(swap({ coins: ['500000', '500000'] }).result, true)
})

test('a short deposit still swaps when the pro-rata floor is met', () => {
  const short = { ...baseTerms }
  // Half the promised BCH → floor 100; sell almost all of 500k sats into the pool.
  const { result, reviewed } = swap({ terms: short, coins: ['500000'], sell: 490000n })
  assert.equal(result, true)
  assert.ok(reviewed.output >= 100n)
})

test('release sends the BCH to the owner only, signed by the trade key, within the fee cap', () => {
  assert.equal(reclaimTx(), true)
  assert.notEqual(reclaimTx({ payTo: stranger.lockingBytecode }), true)
  assert.notEqual(reclaimTx({ fee: ARRIVAL_REFUND_FEE_CAP + 1n }), true)
  assert.notEqual(reclaimTx({ key: generatePrivateKey() }), true)
})

test('after the refund time anyone can reclaim BCH to the owner, and nowhere else', () => {
  assert.notEqual(reclaimTx({ fn: 'reclaim', locktime: baseTerms.refundAfter - 1 }), true)
  assert.equal(reclaimTx({ fn: 'reclaim', locktime: baseTerms.refundAfter }), true)
  assert.notEqual(reclaimTx({ fn: 'reclaim', locktime: baseTerms.refundAfter, payTo: stranger.lockingBytecode }), true)
  assert.notEqual(reclaimTx({ fn: 'reclaim', locktime: baseTerms.refundAfter, fee: ARRIVAL_REFUND_FEE_CAP + 1n }), true)
})

test('the signed swap pays the relay fee for its larger unlocking script', () => {
  const { transaction, sourceOutputs } = swap()
  const size = BigInt(encodeTransaction(transaction).length)
  const fee = sourceOutputs.reduce((sum, s) => sum + s.valueSatoshis, 0n) - transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
  assert.ok(fee >= size, `fee ${fee} for ${size} bytes`)
})
