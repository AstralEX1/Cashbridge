import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { binToHex, createVirtualMachineBch2026, generatePrivateKey, generateSigningSerializationBch, hash256, hexToBin, secp256k1 } from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx } from '../src/lib/bch.ts'
import { bestTrade, poolLockingBytecode, reviewBuild, sourcesOf, tradeTransaction } from '../src/lib/cauldron.ts'
import { memoScript, parseSaleUnlock, REFUND_FEE_CAP, saleBinding, saleRedeemScript, saleUnlock } from '../src/lib/router-contract.ts'
import { BridgeConfig } from '../src/config.ts'
import { otherPubkey, pubkey } from './fixtures/bridge-fixtures.mjs'

const routerKey = generatePrivateKey()
const routerPub = binToHex(secp256k1.derivePublicKeyCompressed(routerKey))
const customer = bindingFromPubkey(pubkey, 0)
const vault = bindingFromPubkey(otherPubkey, 7)
const category = BridgeConfig.pusd.category
const terms = {
  routerKey: routerPub,
  vaultScript: vault.lockingBytecode,
  memo: '=:e:0x1111111111111111111111111111111111111111:0/1/0',
  refundScript: customer.lockingBytecode,
  minSats: '300000',
  refundAfter: 1_800_000_000
}
const contract = saleBinding(terms, 0)
const contractScript = hexToBin(contract.lockingBytecode)
const vm = createVirtualMachineBch2026(true)

const sign = (transaction, sourceOutputs, inputIndex, key = routerKey, signed = terms) => {
  const preimage = generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode: saleRedeemScript(signed), signingSerializationType: Uint8Array.of(0x61) }
  )
  return Uint8Array.from([...secp256k1.signMessageHashSchnorr(key, hash256(preimage)), 0x61])
}
// Unlocks every contract input with `fn` and runs the whole transaction in the VM.
const verify = (transaction, sourceOutputs, fn, { key = routerKey, signed = terms } = {}) => {
  sourceOutputs.forEach((source, i) => {
    if (binToHex(source.lockingBytecode) !== contract.lockingBytecode) return
    transaction.inputs[i].unlockingBytecode = saleUnlock(signed, fn, fn === 'expire' ? undefined : sign(transaction, sourceOutputs, i, key, signed))
  })
  return vm.verify({ transaction, sourceOutputs })
}

const pool = () => {
  const withdraw = new Uint8Array(20).fill(7)
  return {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdraw },
    outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
    output: { locking_bytecode: poolLockingBytecode(withdraw), token: { amount: 30000n, token_id: category }, amount: 108000000n }
  }
}

// A real Cauldron sale of the contract's token coin; the BCH change comes back to the contract.
const sale = (tokens = 100n) => {
  const intent = {
    category,
    side: 'sell',
    funding: [{ txid: 'ee'.repeat(32), vout: 0, value: '2000', token: { category, amount: tokens.toString() } }],
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: contract.tokenAddress,
    cashAddress: contract.cashAddress,
    sell: tokens,
    minOutput: BigInt(terms.minSats),
    ownUnlockBytes: saleUnlock(terms, 'sell', new Uint8Array(65)).length + 2
  }
  const reviewed = reviewBuild(tradeTransaction(bestTrade([pool()], tokens, category, 'sell'), intent), intent)
  return { reviewed, transaction: decodeTx(reviewed.unsignedHex), sourceOutputs: sourcesOf(reviewed) }
}

const coin = (value, token) => ({ lockingBytecode: contractScript, valueSatoshis: value, ...(token && { token }) })
const input = vout => ({ outpointTransactionHash: new Uint8Array(32).fill(9), outpointIndex: vout, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() })

const deposit = ({ value = 400000n, fee = 300n, memo = terms.memo, to = terms.vaultScript, extra = [] } = {}) => ({
  transaction: {
    version: 2,
    locktime: 0,
    inputs: [input(0)],
    outputs: [{ lockingBytecode: hexToBin(to), valueSatoshis: value - fee }, { lockingBytecode: memoScript(memo), valueSatoshis: 0n }, ...extra]
  },
  sourceOutputs: [coin(value)]
})

const giveBack = ({ coins = [coin(2000n, { category: hexToBin(category), amount: 100n })], to = terms.refundScript, fee = 400n, keep = c => c.token, locktime = 0 } = {}) => ({
  transaction: {
    version: 2,
    locktime,
    inputs: coins.map((_, i) => input(i)),
    outputs: coins.map(c => ({ lockingBytecode: hexToBin(to), valueSatoshis: c.valueSatoshis - fee, ...(keep(c) && { token: keep(c) }) }))
  },
  sourceOutputs: coins
})

test('the sale contract is the compiled one and its address is a P2SH20 THORChain can pay and refund', () => {
  const artifact = JSON.parse(readFileSync(new URL('../contracts/router-sale.json', import.meta.url), 'utf8'))
  assert.ok(binToHex(saleRedeemScript(terms)).endsWith(artifact.debug.bytecode))
  assert.match(contract.cashAddress, /^bitcoincash:p[a-z0-9]{41}$/)
  assert.notEqual(saleBinding({ ...terms, memo: terms.memo.replace('1111', '2222') }, 0).cashAddress, contract.cashAddress)
  assert.notEqual(saleBinding({ ...terms, vaultScript: customer.lockingBytecode }, 0).cashAddress, contract.cashAddress)
})

test('the Router can sell the tokens on Cauldron only for at least the minimum BCH, back into the contract', () => {
  const { reviewed, transaction, sourceOutputs } = sale()
  const own = reviewed.ownIndexes[0]
  assert.equal(binToHex(transaction.outputs[own].lockingBytecode), contract.lockingBytecode)
  assert.ok(transaction.outputs[own].valueSatoshis >= 300000n)
  assert.equal(verify(transaction, sourceOutputs, 'sell'), true)
  assert.equal(binToHex(parseSaleUnlock(terms)(transaction.inputs[own].unlockingBytecode).pubkey), routerPub)
  assert.notEqual(verify(transaction, sourceOutputs, 'sell', { key: generatePrivateKey() }), true)
  const floor = { ...terms, minSats: (transaction.outputs[own].valueSatoshis + 1n).toString() }
  assert.notEqual(verify(transaction, sourceOutputs, 'sell', { signed: floor }), true)
  const elsewhere = sale()
  elsewhere.transaction.outputs[own].lockingBytecode = hexToBin(terms.refundScript)
  assert.notEqual(verify(elsewhere.transaction, elsewhere.sourceOutputs, 'sell'), true)
})

test('the BCH goes to THORChain only to the vault, with the order memo, alone and within the fee cap', () => {
  const ok = deposit()
  assert.equal(verify(ok.transaction, ok.sourceOutputs, 'deposit'), true)
  const other = deposit({ memo: '=:e:0x2222222222222222222222222222222222222222:0/1/0' })
  assert.notEqual(verify(other.transaction, other.sourceOutputs, 'deposit'), true)
  const away = deposit({ to: terms.refundScript })
  assert.notEqual(verify(away.transaction, away.sourceOutputs, 'deposit'), true)
  const extra = deposit({ extra: [{ lockingBytecode: memoScript('=:e:0x2222'), valueSatoshis: 0n }] })
  assert.notEqual(verify(extra.transaction, extra.sourceOutputs, 'deposit'), true, 'no second memo')
  const greedy = deposit({ fee: REFUND_FEE_CAP + 1n })
  assert.notEqual(verify(greedy.transaction, greedy.sourceOutputs, 'deposit'), true)
  const small = deposit({ value: 299999n })
  assert.notEqual(verify(small.transaction, small.sourceOutputs, 'deposit'), true, 'a THORChain refund below the minimum is not deposited again')
  const second = deposit()
  second.transaction.inputs.unshift(input(1))
  second.sourceOutputs.unshift({ lockingBytecode: hexToBin(customer.lockingBytecode), valueSatoshis: 1000n })
  verify(second.transaction, second.sourceOutputs, 'deposit')
  const state = vm.evaluate({ inputIndex: 1, sourceOutputs: second.sourceOutputs, transaction: second.transaction })
  assert.notEqual(vm.stateSuccess(state), true, 'the contract must be the sender THORChain refunds')
  assert.equal(vm.stateSuccess(vm.evaluate({ inputIndex: 0, ...ok })), true, 'the same check passes for the lone contract input')
})

test('giveBack returns the tokens or the BCH as they came, to the customer only', () => {
  const tokens = giveBack()
  assert.equal(verify(tokens.transaction, tokens.sourceOutputs, 'giveBack'), true)
  const both = giveBack({ coins: [coin(2000n, { category: hexToBin(category), amount: 100n }), coin(250000n)] })
  assert.equal(verify(both.transaction, both.sourceOutputs, 'giveBack'), true, 'a sale coin and a THORChain refund go back together')
  const away = giveBack({ to: vault.lockingBytecode })
  assert.notEqual(verify(away.transaction, away.sourceOutputs, 'giveBack'), true)
  const fewer = giveBack({ keep: c => ({ ...c.token, amount: c.token.amount - 1n }) })
  assert.notEqual(verify(fewer.transaction, fewer.sourceOutputs, 'giveBack'), true)
  const greedy = giveBack({ coins: [coin(250000n)], fee: REFUND_FEE_CAP + 1n })
  assert.notEqual(verify(greedy.transaction, greedy.sourceOutputs, 'giveBack'), true)
  const stranger = giveBack()
  assert.notEqual(verify(stranger.transaction, stranger.sourceOutputs, 'giveBack', { key: generatePrivateKey() }), true)
})

test('after the refund time anyone can return the coins to the customer, and nowhere else', () => {
  const early = giveBack({ locktime: terms.refundAfter - 1 })
  assert.notEqual(verify(early.transaction, early.sourceOutputs, 'expire'), true)
  const late = giveBack({ locktime: terms.refundAfter })
  assert.equal(verify(late.transaction, late.sourceOutputs, 'expire'), true)
  const away = giveBack({ locktime: terms.refundAfter, to: vault.lockingBytecode })
  assert.notEqual(verify(away.transaction, away.sourceOutputs, 'expire'), true)
})
