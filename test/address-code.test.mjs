// Recipient code check: an RPC that cannot be read never clears a destination.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addressCodeState, readAddressCode } from '../src/hooks/use-address-code.ts'

const KEY = 'ETH:0xabc:0'

test('a failed code read is unverified, not "no code"', async () => {
  const code = await readAddressCode(() => Promise.reject(new Error('RPC down')))
  assert.equal(code, undefined)
  const state = addressCodeState({ key: KEY, code }, KEY, true)
  assert.equal(state.isUnverified, true)
  assert.equal(state.isContract, false)
  assert.equal(state.isDelegated, false)
  assert.equal(state.isChecking, false)
})

test('plain accounts, contracts and EIP-7702 delegates are told apart once the read succeeds', async () => {
  const eoa = addressCodeState({ key: KEY, code: await readAddressCode(async () => '0x') }, KEY, true)
  assert.deepEqual(eoa, { isDelegated: false, isContract: false, isChecking: false, isUnverified: false })

  const contract = addressCodeState({ key: KEY, code: await readAddressCode(async () => '0x6080604052') }, KEY, true)
  assert.equal(contract.isContract, true)

  const delegated = addressCodeState({ key: KEY, code: await readAddressCode(async () => '0xEF0100' + '11'.repeat(20)) }, KEY, true)
  assert.equal(delegated.isDelegated, true)
  assert.equal(delegated.isContract, false)
})

test('a result for another address or an earlier attempt is still checking', () => {
  assert.equal(addressCodeState({ key: 'ETH:0xother:0', code: '0x' }, KEY, true).isChecking, true)
  assert.equal(addressCodeState({ key: 'ETH:0xabc:0', code: undefined }, 'ETH:0xabc:1', true).isChecking, true, 'a retry re-reads')
  assert.deepEqual(addressCodeState({ key: '' }, KEY, false), { isDelegated: false, isContract: false, isChecking: false, isUnverified: false })
})
