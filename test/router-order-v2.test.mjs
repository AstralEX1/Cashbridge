import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  binToHex,
  createVirtualMachineBch2026,
  generatePrivateKey,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1
} from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, sourcesOf, reviewBuild, tradeTransaction } from '../src/lib/cauldron.ts'
import { coinFloor, orderBinding, orderRedeemScript, orderUnlock, parseOrderUnlock, REFUND_FEE_CAP } from '../src/lib/router-contract.ts'
import { BridgeConfig } from '../src/config.ts'
import { otherPubkey, pubkey } from './fixtures/bridge-fixtures.mjs'

const routerKey = generatePrivateKey()
const pageKey = generatePrivateKey()
const hexPub = key => binToHex(secp256k1.derivePublicKeyCompressed(key))
const recipient = bindingFromPubkey(pubkey, 0)
const refund = bindingFromPubkey(otherPubkey, 0)
const terms = {
  version: 2,
  routerKey: hexPub(routerKey),
  pageKey: hexPub(pageKey),
  recipientScript: recipient.lockingBytecode,
  refundScript: refund.lockingBytecode,
  category: BridgeConfig.pusd.category,
  minPusd: '200',
  quotedSats: '1000000',
  refundAfter: 1_800_000_000
}
const vm = createVirtualMachineBch2026(true)

const sign = (transaction, sourceOutputs, inputIndex, t, key) => {
  const preimage = generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode: orderRedeemScript(t), signingSerializationType: Uint8Array.of(0x61) }
  )
  return Uint8Array.from([...secp256k1.signMessageHashSchnorr(key, hash256(preimage)), 0x61])
}

const pool = (tokens = 30000n, sats = 108000000n) => {
  const withdraw = new Uint8Array(20).fill(7)
  return {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdraw },
    outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
    output: { locking_bytecode: poolLockingBytecode(withdraw), token: { amount: tokens, token_id: BridgeConfig.pusd.category }, amount: sats }
  }
}

// A real Cauldron purchase with the one coin at the contract, signed by `key` (claimed as `claimed`).
const swap = ({ t = terms, coin = '1000000', key = routerKey, claimed = hexPub(key), payTo = t.recipientScript, poolTokens } = {}) => {
  const contract = orderBinding(t, 0)
  const funding = [{ txid: 'ee'.repeat(32), vout: 0, value: coin, confirmations: 0, unspent: true }]
  const sell = BigInt(coin) - 10000n
  const intent = {
    category: BridgeConfig.pusd.category,
    side: 'buy',
    funding,
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: '',
    cashAddress: '',
    payout: { tokenScript: payTo, changeScript: t.refundScript },
    sell,
    minOutput: 1n,
    ownUnlockBytes: orderUnlock(t, 'convert', new Uint8Array(65)).length + 2
  }
  const build = tradeTransaction(bestTrade([pool(poolTokens)], sell), intent)
  const reviewed = reviewBuild(build, intent)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  reviewed.ownIndexes.forEach(i => (transaction.inputs[i].unlockingBytecode = orderUnlock(t, 'convert', sign(transaction, sourceOutputs, i, t, key), claimed)))
  return { result: vm.verify({ transaction, sourceOutputs }), reviewed, transaction }
}

const refundTx = ({ fn = 'giveBack', coins = [1000000n], payTo = terms.refundScript, fee = 400n, locktime = 0, key = routerKey } = {}) => {
  const contract = hexToBin(orderBinding(terms, 0).lockingBytecode)
  const transaction = {
    version: 2,
    locktime,
    inputs: coins.map((_, i) => ({ outpointTransactionHash: new Uint8Array(32).fill(9), outpointIndex: i, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() })),
    outputs: coins.map(value => ({ lockingBytecode: hexToBin(payTo), valueSatoshis: value - fee }))
  }
  const sourceOutputs = coins.map(value => ({ lockingBytecode: contract, valueSatoshis: value }))
  transaction.inputs.forEach(
    (input, i) => (input.unlockingBytecode = orderUnlock(terms, fn, fn === 'expire' ? undefined : sign(transaction, sourceOutputs, i, terms, key), hexPub(key)))
  )
  return vm.verify({ transaction, sourceOutputs })
}

test('version 2 carries its own compiled code, so its address differs from version 1 and from other page keys', () => {
  const artifact = JSON.parse(readFileSync(new URL('../contracts/router-order-v2.json', import.meta.url), 'utf8'))
  assert.ok(binToHex(orderRedeemScript(terms)).endsWith(artifact.debug.bytecode))
  const binding = orderBinding(terms, 0)
  assert.match(binding.cashAddress, /^bitcoincash:p[a-z0-9]{41}$/)
  assert.notEqual(orderBinding({ ...terms, version: undefined }, 0).cashAddress, binding.cashAddress)
  assert.notEqual(orderBinding({ ...terms, pageKey: hexPub(generatePrivateKey()) }, 0).cashAddress, binding.cashAddress)
  assert.notEqual(orderBinding({ ...terms, quotedSats: '1000001' }, 0).cashAddress, binding.cashAddress)
  // Without a page the Router's key stands in for it.
  assert.equal(orderBinding({ ...terms, pageKey: undefined }, 0).cashAddress, orderBinding({ ...terms, pageKey: terms.routerKey }, 0).cashAddress)
})

test('the Router or the page can buy the token for the customer, nobody else, and only to the customer', () => {
  const byRouter = swap()
  assert.equal(byRouter.result, true)
  const own = r => r.transaction.inputs[r.reviewed.ownIndexes[0]].unlockingBytecode
  assert.equal(binToHex(parseOrderUnlock(terms)(own(byRouter)).pubkey), terms.routerKey)
  const byPage = swap({ key: pageKey })
  assert.equal(byPage.result, true)
  assert.equal(binToHex(parseOrderUnlock(terms)(own(byPage)).pubkey), terms.pageKey)
  const stranger = generatePrivateKey()
  assert.notEqual(swap({ key: stranger }).result, true)
  assert.equal(parseOrderUnlock(terms)(own(swap({ key: stranger }))), undefined)
  // A stranger's signature presented as the page's key fails the signature check.
  assert.notEqual(swap({ key: stranger, claimed: terms.pageKey }).result, true)
  assert.notEqual(swap({ key: pageKey, payTo: refund.lockingBytecode }).result, true)
})

test('a coin under the quote must buy its share of the minimum; a larger one the minimum itself', () => {
  assert.equal(coinFloor(terms, 1000000n), 200n)
  assert.equal(coinFloor(terms, 970000n), 194n)
  assert.equal(coinFloor(terms, 5000000n), 200n)
  assert.equal(coinFloor({ minPusd: '200' }, 970000n), 200n, 'version 1 keeps the fixed minimum')
  // 970,000 sats buy about 263 tokens from this pool: fine against a share of 194 + slack, not against a higher minimum.
  const short = swap({ coin: '970000' })
  assert.equal(short.result, true)
  const out = short.reviewed.output
  assert.notEqual(swap({ t: { ...terms, minPusd: (((out + 1n) * 1000000n) / 970000n + 1n).toString() }, coin: '970000' }).result, true)
  // Quoted at the full coin: version 1 refuses the short coin, version 2 takes it at the quoted rate.
  const full = swap().reviewed.output
  const v1 = { ...terms, version: undefined, minPusd: full.toString() }
  assert.equal(swap({ t: v1 }).result, true)
  assert.notEqual(swap({ t: v1, coin: '970000' }).result, true)
  const v2 = { ...terms, minPusd: full.toString() }
  assert.equal(swap({ t: v2, coin: '970000' }).result, true, 'version 2 takes the short coin at the quoted rate')
})

test('giveBack goes only to the fallback, signed by the Router or the page; expire waits for the refund time', () => {
  assert.equal(refundTx(), true)
  assert.equal(refundTx({ key: pageKey }), true)
  assert.notEqual(refundTx({ key: generatePrivateKey() }), true)
  assert.notEqual(refundTx({ key: pageKey, payTo: recipient.lockingBytecode }), true)
  assert.notEqual(refundTx({ fee: REFUND_FEE_CAP + 1n }), true)
  assert.notEqual(refundTx({ fn: 'expire', locktime: terms.refundAfter - 1 }), true)
  assert.equal(refundTx({ fn: 'expire', locktime: terms.refundAfter }), true)
  assert.notEqual(refundTx({ fn: 'expire', locktime: terms.refundAfter, payTo: recipient.lockingBytecode }), true)
})
