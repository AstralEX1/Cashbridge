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
import { orderBinding, orderRedeemScript, orderUnlock, parseOrderUnlock, REFUND_FEE_CAP } from '../src/lib/router-contract.ts'
import { BridgeConfig } from '../src/config.ts'
import { otherPubkey, pubkey } from './fixtures/bridge-fixtures.mjs'

const routerKey = generatePrivateKey()
const routerPub = binToHex(secp256k1.derivePublicKeyCompressed(routerKey))
const recipient = bindingFromPubkey(pubkey, 0)
const refund = bindingFromPubkey(otherPubkey, 0)
const baseTerms = { routerKey: routerPub, recipientScript: recipient.lockingBytecode, refundScript: refund.lockingBytecode, category: BridgeConfig.pusd.category, minPusd: '200', refundAfter: 1_800_000_000 }
const vm = createVirtualMachineBch2026(true)

const sign = (transaction, sourceOutputs, inputIndex, terms, key = routerKey) => {
  const preimage = generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode: orderRedeemScript(terms), signingSerializationType: Uint8Array.of(0x61) }
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

// A real Cauldron purchase funded by coins at the contract, the swap signed by `key`; true when every input verifies.
const swap = ({ terms = baseTerms, coins = ['1000000'], payTo = terms.recipientScript, key = routerKey, sell = 990000n } = {}) => {
  const contract = orderBinding(terms, 0)
  const funding = coins.map((value, vout) => ({ txid: 'ee'.repeat(32), vout, value, confirmations: 0, unspent: true }))
  const intent = {
    category: BridgeConfig.pusd.category,
    side: 'buy',
    funding,
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: '',
    cashAddress: '',
    payout: { tokenScript: payTo, changeScript: terms.refundScript },
    sell,
    minOutput: 1n,
    ownUnlockBytes: orderUnlock(terms, 'convert', new Uint8Array(65)).length + 2
  }
  const build = tradeTransaction(bestTrade([pool()], sell), intent)
  const reviewed = reviewBuild(build, intent)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  reviewed.ownIndexes.forEach(i => (transaction.inputs[i].unlockingBytecode = orderUnlock(terms, 'convert', sign(transaction, sourceOutputs, i, terms, key))))
  return { result: vm.verify({ transaction, sourceOutputs }), reviewed, transaction, sourceOutputs }
}

// The BCH of each coin back to `payTo`, through giveBack (Router-signed) or expire (anyone, after the refund time).
const refundTx = ({ fn = 'giveBack', terms = baseTerms, coins = [1000000n], payTo = terms.refundScript, fee = 400n, locktime = 0, key = routerKey } = {}) => {
  const contract = hexToBin(orderBinding(terms, 0).lockingBytecode)
  const transaction = {
    version: 2,
    locktime,
    inputs: coins.map((_, i) => ({ outpointTransactionHash: new Uint8Array(32).fill(9), outpointIndex: i, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() })),
    outputs: coins.map(value => ({ lockingBytecode: hexToBin(payTo), valueSatoshis: value - fee }))
  }
  const sourceOutputs = coins.map(value => ({ lockingBytecode: contract, valueSatoshis: value }))
  transaction.inputs.forEach((input, i) => (input.unlockingBytecode = orderUnlock(terms, fn, fn === 'expire' ? undefined : sign(transaction, sourceOutputs, i, terms, key))))
  return vm.verify({ transaction, sourceOutputs })
}

test('the redeem script carries the compiled contract and its address is a P2SH20 THORChain can pay', () => {
  const artifact = JSON.parse(readFileSync(new URL('../contracts/router-order.json', import.meta.url), 'utf8'))
  assert.ok(binToHex(orderRedeemScript(baseTerms)).endsWith(artifact.debug.bytecode))
  const binding = orderBinding(baseTerms, 3)
  assert.match(binding.cashAddress, /^bitcoincash:p[a-z0-9]{41}$/)
  assert.match(binding.lockingBytecode, /^a914[0-9a-f]{40}87$/)
  assert.notEqual(orderBinding({ ...baseTerms, minPusd: '201' }, 3).cashAddress, binding.cashAddress)
  assert.notEqual(orderBinding({ ...baseTerms, category: 'ab'.repeat(32) }, 3).cashAddress, binding.cashAddress)
})

test('the Router can trade the coin on Cauldron for at least the floor to the recipient, pool covenants included', () => {
  const { result, reviewed, transaction } = swap()
  assert.equal(result, true)
  assert.ok(reviewed.output >= 200n)
  const unlock = transaction.inputs[reviewed.ownIndexes[0]].unlockingBytecode
  assert.equal(binToHex(parseOrderUnlock(baseTerms)(unlock).pubkey), routerPub)
  assert.equal(parseOrderUnlock({ ...baseTerms, minPusd: '201' })(unlock), undefined)
})

test('a swap fails below the floor, to anyone else, under another key, or with two coins on one payout', () => {
  const { reviewed } = swap()
  assert.notEqual(swap({ terms: { ...baseTerms, minPusd: (reviewed.output + 1n).toString() } }).result, true)
  assert.notEqual(swap({ payTo: refund.lockingBytecode }).result, true)
  assert.notEqual(swap({ key: generatePrivateKey() }).result, true)
  assert.notEqual(swap({ coins: ['500000', '500000'] }).result, true)
})

test('giveBack sends the BCH back to the fallback only, signed by the Router, within the fee cap', () => {
  assert.equal(refundTx(), true)
  assert.equal(refundTx({ coins: [600000n, 400000n] }), true, 'all coins of an order go back in one transaction')
  assert.notEqual(refundTx({ payTo: recipient.lockingBytecode }), true)
  assert.notEqual(refundTx({ fee: REFUND_FEE_CAP + 1n }), true)
  assert.notEqual(refundTx({ key: generatePrivateKey() }), true)
})

test('after the refund time anyone can send the BCH back to the fallback, and nowhere else', () => {
  assert.notEqual(refundTx({ fn: 'expire', locktime: baseTerms.refundAfter - 1 }), true)
  assert.equal(refundTx({ fn: 'expire', locktime: baseTerms.refundAfter }), true)
  assert.notEqual(refundTx({ fn: 'expire', locktime: baseTerms.refundAfter, payTo: recipient.lockingBytecode }), true)
  assert.notEqual(refundTx({ fn: 'expire', locktime: baseTerms.refundAfter, fee: REFUND_FEE_CAP + 1n }), true)
})

test('the signed swap pays the relay fee for its larger unlocking script', () => {
  const { transaction, sourceOutputs } = swap()
  const size = BigInt(encodeTransaction(transaction).length)
  const fee = sourceOutputs.reduce((sum, s) => sum + s.valueSatoshis, 0n) - transaction.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
  assert.ok(fee >= size, `fee ${fee} for ${size} bytes`)
})
