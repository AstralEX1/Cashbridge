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
  memo: 'cashbridge',
  refundScript: customer.lockingBytecode,
  minSats: '300000',
  refundAfter: 1_800_000_000,
  depositSats: '297000'
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
const verify = (transaction, sourceOutputs, fn, { key = routerKey, signed = terms } = {}) => {
  sourceOutputs.forEach((source, i) => {
    if (binToHex(source.lockingBytecode) !== contract.lockingBytecode) return
    transaction.inputs[i].unlockingBytecode = saleUnlock(signed, fn, fn === 'expire' ? undefined : sign(transaction, sourceOutputs, i, key, signed))
  })
  return vm.verify({ transaction, sourceOutputs })
}

const coin = (value, token) => ({ lockingBytecode: contractScript, valueSatoshis: value, ...(token && { token }) })
const input = vout => ({ outpointTransactionHash: new Uint8Array(32).fill(9), outpointIndex: vout, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() })

const deposit = ({ value = 400000n, fee = 300n, amount = BigInt(terms.depositSats), memo = terms.memo, to = terms.vaultScript, back = terms.refundScript, extra = [] } = {}) => ({
  transaction: {
    version: 2,
    locktime: 0,
    inputs: [input(0)],
    outputs: [
      { lockingBytecode: hexToBin(to), valueSatoshis: amount },
      { lockingBytecode: memoScript(memo), valueSatoshis: 0n },
      { lockingBytecode: hexToBin(back), valueSatoshis: value - amount - fee },
      ...extra
    ]
  },
  sourceOutputs: [coin(value)]
})

test('the exact sale contract is the compiled one and commits to the deposit amount', () => {
  const artifact = JSON.parse(readFileSync(new URL('../contracts/router-sale-exact.json', import.meta.url), 'utf8'))
  assert.ok(binToHex(saleRedeemScript(terms)).endsWith(artifact.debug.bytecode))
  assert.match(contract.cashAddress, /^bitcoincash:p[a-z0-9]{41}$/)
  assert.notEqual(saleBinding({ ...terms, depositSats: '297001' }, 0).cashAddress, contract.cashAddress)
  assert.notEqual(saleBinding({ ...terms, depositSats: undefined }, 0).cashAddress, contract.cashAddress, 'the exact contract is a different address')
})

test('the Router can sell the tokens only back into the contract, for at least the minimum', () => {
  const withdraw = new Uint8Array(20).fill(7)
  const pool = {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdraw },
    outpoint: { txhash: new Uint8Array(32).fill(8), index: 0 },
    output: { locking_bytecode: poolLockingBytecode(withdraw), token: { amount: 30000n, token_id: category }, amount: 108000000n }
  }
  const intent = {
    category,
    side: 'sell',
    funding: [{ txid: 'ee'.repeat(32), vout: 0, value: '2000', token: { category, amount: '100' } }],
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: contract.tokenAddress,
    cashAddress: contract.cashAddress,
    sell: 100n,
    minOutput: BigInt(terms.minSats),
    ownUnlockBytes: saleUnlock(terms, 'sell', new Uint8Array(65)).length + 2
  }
  const reviewed = reviewBuild(tradeTransaction(bestTrade([pool], 100n, category, 'sell'), intent), intent)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  const own = reviewed.ownIndexes[0]
  assert.equal(verify(transaction, sourceOutputs, 'sell'), true)
  assert.equal(binToHex(parseSaleUnlock(terms)(transaction.inputs[own].unlockingBytecode).pubkey), routerPub)
  const floor = { ...terms, minSats: (transaction.outputs[own].valueSatoshis + 1n).toString() }
  assert.notEqual(verify(transaction, sourceOutputs, 'sell', { signed: floor }), true)
})

test('the deposit pays exactly the quoted amount to the deposit address and the rest to the customer', () => {
  const ok = deposit()
  assert.equal(verify(ok.transaction, ok.sourceOutputs, 'deposit'), true)
  const more = deposit({ amount: BigInt(terms.depositSats) + 1n })
  assert.notEqual(verify(more.transaction, more.sourceOutputs, 'deposit'), true, 'not a satoshi more than quoted')
  const less = deposit({ amount: BigInt(terms.depositSats) - 1n })
  assert.notEqual(verify(less.transaction, less.sourceOutputs, 'deposit'), true)
  const away = deposit({ to: terms.refundScript })
  assert.notEqual(verify(away.transaction, away.sourceOutputs, 'deposit'), true)
  const kept = deposit({ back: vault.lockingBytecode })
  assert.notEqual(verify(kept.transaction, kept.sourceOutputs, 'deposit'), true, 'the change goes to the customer only')
  const memo = deposit({ memo: 'other' })
  assert.notEqual(verify(memo.transaction, memo.sourceOutputs, 'deposit'), true)
  const extra = deposit({ extra: [{ lockingBytecode: memoScript('x'), valueSatoshis: 0n }] })
  assert.notEqual(verify(extra.transaction, extra.sourceOutputs, 'deposit'), true)
  const greedy = deposit({ fee: REFUND_FEE_CAP + 1n })
  assert.notEqual(verify(greedy.transaction, greedy.sourceOutputs, 'deposit'), true)
  const small = deposit({ value: 299999n })
  assert.notEqual(verify(small.transaction, small.sourceOutputs, 'deposit'), true)
  const second = deposit()
  second.transaction.inputs.unshift(input(1))
  second.sourceOutputs.unshift({ lockingBytecode: hexToBin(customer.lockingBytecode), valueSatoshis: 1000n })
  verify(second.transaction, second.sourceOutputs, 'deposit')
  assert.notEqual(vm.stateSuccess(vm.evaluate({ inputIndex: 1, sourceOutputs: second.sourceOutputs, transaction: second.transaction })), true)
})

test('giveBack and expire return the coin as it came, to the customer only', () => {
  const back = (locktime = 0, to = terms.refundScript) => ({
    transaction: {
      version: 2,
      locktime,
      inputs: [input(0)],
      outputs: [{ lockingBytecode: hexToBin(to), valueSatoshis: 1600n, token: { category: hexToBin(category), amount: 100n } }]
    },
    sourceOutputs: [coin(2000n, { category: hexToBin(category), amount: 100n })]
  })
  const ok = back()
  assert.equal(verify(ok.transaction, ok.sourceOutputs, 'giveBack'), true)
  const away = back(0, vault.lockingBytecode)
  assert.notEqual(verify(away.transaction, away.sourceOutputs, 'giveBack'), true)
  const early = back(terms.refundAfter - 1)
  assert.notEqual(verify(early.transaction, early.sourceOutputs, 'expire'), true)
  const late = back(terms.refundAfter)
  assert.equal(verify(late.transaction, late.sourceOutputs, 'expire'), true)
})
