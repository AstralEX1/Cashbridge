// Reverse-bridge payouts on chains without a THORChain router: fixture tests for the checks that
// decide a payout arrived. Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binToHex, encodeBase58AddressFormat, hexToBin, utf8ToBin } from '@bitauth/libauth'
import { Registry } from '@cosmjs/proto-signing'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'
import { cosmosPayout, solanaPayout, thorchainPayout, tronHex, tronPayout, utxoPayout, xrpPayout } from '../src/lib/payout-check.ts'
import { isPayoutChain, sameAddress } from '../src/lib/payout-chains.ts'
import { checkDepositMemo, checkInbound } from '../src/lib/thorchain-deposit.ts'
import { bindingFromPubkey } from '../src/lib/bch.ts'
import { pubkey } from './fixtures/bridge-fixtures.mjs'

const deposit = 'ab'.repeat(32)
const memo = `OUT:${deposit.toUpperCase()}`
const memoHex = binToHex(utf8ToBin(memo))
const opReturn = hex => `6a${(hex.length / 2).toString(16).padStart(2, '0')}${hex}`

test('reverse payouts are offered only on chains whose payout this app checks', () => {
  for (const chain of ['BTC', 'LTC', 'DOGE', 'ZEC', 'XRP', 'SOL', 'TRON', 'GAIA', 'THOR', 'BASE', 'ETH', 'BSC', 'AVAX']) assert.ok(isPayoutChain(chain), chain)
  assert.equal(isPayoutChain('BCH'), false, 'BCH is the bridge’s own side')
  assert.equal(isPayoutChain('XMR'), false)
})

test('addresses compare case-insensitively only where the format is', () => {
  assert.ok(sameAddress('0xAbC', '0xabc'))
  assert.ok(sameAddress('bc1qxyz', 'BC1QXYZ'))
  assert.equal(sameAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T'), false)
})

test('a UTXO payout needs this deposit’s OUT memo and an output to the destination; mempool counts', () => {
  const destination = 'bc1qdestination'
  const hash = 'cd'.repeat(32)
  const dashboard = outputs => ({ data: { [hash]: { transaction: { block_id: -1 }, outputs } } })
  const expect = { destination, depositTxid: deposit, buyAsset: 'BTC.BTC' }
  const pays = [
    { recipient: destination, value: 150_000, script_hex: '0014aa' },
    { recipient: 'nulldata', value: 0, script_hex: opReturn(memoHex) },
    { recipient: 'bc1qvault', value: 9_000_000, script_hex: '0014bb' }
  ]
  assert.deepEqual(utxoPayout(dashboard(pays), hash, expect), { hash, amount: '150000' })
  assert.equal(utxoPayout(dashboard(pays.filter(o => o.recipient !== 'nulldata')), hash, expect), undefined, 'no memo')
  assert.equal(utxoPayout(dashboard([pays[0], { ...pays[1], script_hex: opReturn(binToHex(utf8ToBin(`OUT:${'ef'.repeat(32)}`))) }]), hash, expect), undefined, 'another deposit')
  assert.equal(utxoPayout(dashboard(pays.slice(1)), hash, expect), undefined, 'not to the destination')
  assert.equal(utxoPayout({ data: {} }, hash, expect), undefined, 'unknown hash')
})

test('an XRP payout is a validated, successful Payment to the destination with the memo', () => {
  const destination = 'rDestination1111111111111111111'
  const expect = { destination, depositTxid: deposit, buyAsset: 'XRP.XRP' }
  const tx = {
    validated: true,
    TransactionType: 'Payment',
    Destination: destination,
    Memos: [{ Memo: { MemoData: memoHex.toUpperCase() } }],
    meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '2500000' }
  }
  assert.deepEqual(xrpPayout(tx, 'H', expect), { hash: 'H', amount: '2500000' })
  assert.equal(xrpPayout({ ...tx, validated: false }, 'H', expect), undefined)
  assert.equal(xrpPayout({ ...tx, meta: { ...tx.meta, TransactionResult: 'tecPATH_DRY' } }, 'H', expect), undefined)
  assert.equal(xrpPayout({ ...tx, Destination: 'rOther' }, 'H', expect), undefined)
  assert.equal(xrpPayout({ ...tx, Memos: [] }, 'H', expect), undefined)
  assert.equal(xrpPayout({ ...tx, meta: { ...tx.meta, delivered_amount: { currency: 'USD', value: '1' } } }, 'H', expect), undefined)
})

test('a Solana payout sums system transfers to the destination; a memo, if any, must match', () => {
  const destination = 'So1Destination111111111111111111111111111111'
  const expect = { destination, depositTxid: deposit, buyAsset: 'SOL.SOL' }
  const transfer = (to, lamports) => ({ program: 'system', parsed: { type: 'transfer', info: { destination: to, lamports } } })
  const tx = (instructions, err = null) => ({ meta: { err, innerInstructions: [] }, transaction: { message: { instructions } } })
  assert.deepEqual(solanaPayout(tx([transfer(destination, 1_000_000), { program: 'spl-memo', parsed: memo }]), 'S', expect), { hash: 'S', amount: '1000000' })
  assert.deepEqual(solanaPayout(tx([transfer(destination, 7)]), 'S', expect), { hash: 'S', amount: '7' })
  assert.equal(solanaPayout(tx([transfer(destination, 7), { program: 'spl-memo', parsed: 'OUT:FFFF' }]), 'S', expect), undefined)
  assert.equal(solanaPayout(tx([transfer('Other', 7)]), 'S', expect), undefined)
  assert.equal(solanaPayout(tx([transfer(destination, 7)], { InstructionError: [0, 'x'] }), 'S', expect), undefined)
  assert.equal(solanaPayout(null, 'S', expect), undefined)
})

test('a TRON payout pays the destination in TRX or in the asked TRC-20 contract', () => {
  const destinationHex = `41${'12'.repeat(20)}`
  const destination = encodeBase58AddressFormat(0x41, hexToBin('12'.repeat(20)))
  assert.equal(tronHex(destination), destinationHex)
  const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  const info = { blockNumber: 1, receipt: { result: 'SUCCESS' } }
  const trx = { raw_data: { data: memoHex, contract: [{ type: 'TransferContract', parameter: { value: { to_address: destinationHex, amount: 5_000_000 } } }] } }
  const trxExpect = { destination, depositTxid: deposit, buyAsset: 'TRON.TRX' }
  assert.deepEqual(tronPayout(trx, info, 'T', trxExpect), { hash: 'T', amount: '5000000' })
  assert.equal(tronPayout(trx, {}, 'T', trxExpect), undefined, 'not in a block yet')
  assert.equal(tronPayout(trx, { blockNumber: 1, result: 'FAILED' }, 'T', trxExpect), undefined)
  assert.equal(tronPayout({ raw_data: { ...trx.raw_data, data: binToHex(utf8ToBin('OUT:00')) } }, info, 'T', trxExpect), undefined)

  const call = `a9059cbb${'0'.repeat(24)}${'12'.repeat(20)}${(1_234_567n).toString(16).padStart(64, '0')}`
  const trc20 = { raw_data: { data: memoHex, contract: [{ type: 'TriggerSmartContract', parameter: { value: { contract_address: tronHex(usdt), data: call } } }] } }
  const usdtExpect = { destination, depositTxid: deposit, buyAsset: `TRON.USDT-${usdt}` }
  assert.deepEqual(tronPayout(trc20, info, 'T', usdtExpect), { hash: 'T', amount: '1234567' })
  assert.equal(tronPayout(trc20, info, 'T', trxExpect), undefined, 'a token is not TRX')
  assert.equal(tronPayout(trx, info, 'T', usdtExpect), undefined, 'TRX is not the token')
  assert.equal(tronPayout(trc20, { blockNumber: 1, receipt: { result: 'REVERT' } }, 'T', usdtExpect), undefined)
})

test('a Cosmos payout is a successful MsgSend of uatom to the destination with the memo', () => {
  const registry = new Registry()
  const destination = 'cosmos1destination'
  const expect = { destination, depositTxid: deposit, buyAsset: 'GAIA.ATOM' }
  const encode = (to, txMemo) =>
    Buffer.from(
      TxRaw.encode({
        bodyBytes: registry.encodeTxBody({
          messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: 'cosmos1vault', toAddress: to, amount: [{ denom: 'uatom', amount: '420000' }] } }],
          memo: txMemo
        }),
        authInfoBytes: new Uint8Array(),
        signatures: []
      }).finish()
    ).toString('base64')
  assert.deepEqual(cosmosPayout({ tx: encode(destination, memo), tx_result: {} }, 'C', expect), { hash: 'C', amount: '420000' })
  assert.equal(cosmosPayout({ tx: encode(destination, memo), tx_result: { code: 5 } }, 'C', expect), undefined)
  assert.equal(cosmosPayout({ tx: encode('cosmos1other', memo), tx_result: {} }, 'C', expect), undefined)
  assert.equal(cosmosPayout({ tx: encode(destination, 'OUT:00'), tx_result: {} }, 'C', expect), undefined)
})

test('a THORChain-native payout is THORNode’s outbound in the asked asset, linked by the deposit', () => {
  const destination = 'thor1destination'
  const expect = { destination, depositTxid: deposit, buyAsset: 'THOR.RUNE' }
  const out = { id: '0'.repeat(64), chain: 'THOR', to_address: destination, coins: [{ asset: 'THOR.RUNE', amount: '123000000' }], memo }
  assert.deepEqual(thorchainPayout(out, expect), { hash: deposit.toUpperCase(), amount: '123000000' })
  assert.equal(thorchainPayout({ ...out, coins: [{ asset: 'THOR.TCY', amount: '1' }] }, expect), undefined)
  assert.equal(thorchainPayout({ ...out, to_address: 'thor1other' }, expect), undefined)
  assert.equal(thorchainPayout({ ...out, memo: 'REFUND:00' }, expect), undefined)
})

test('reported non-EVM payouts do not require an EVM router', async () => {
  const { default: axios } = await import('axios')
  const adapter = axios.defaults.adapter
  const destination = 'thor1destination'
  axios.defaults.adapter = async config => ({ status: 200, headers: {}, config, data: {
    out_txs: [{ id: '0'.repeat(64), chain: 'THOR', to_address: destination, coins: [{ asset: 'THOR.RUNE', amount: '123000000' }], memo }]
  } })
  try {
    const { confirmReportedPayout } = await import('../src/lib/reverse-bridge.ts')
    assert.deepEqual(await confirmReportedPayout({ reverse: { buyAsset: 'THOR.RUNE', destination, deposit: { txid: deposit } } }), {
      hash: deposit.toUpperCase(), amount: '123000000'
    })
  } finally { axios.defaults.adapter = adapter }
})

test('a deposit to RUNE needs no THOR inbound; memos may name the asset by its short code', () => {
  const inbounds = [{ chain: 'BCH', address: bindingFromPubkey(pubkey, 0).cashAddress, gas_rate: '2' }]
  const ok = checkInbound(inbounds, inbounds[0].address, 'THOR')
  assert.equal(ok.router, undefined)
  assert.throws(() => checkInbound(inbounds, inbounds[0].address, 'BTC'), /paused BTC/)

  checkDepositMemo('=:b:bc1qdest:0/1/0', { buyAsset: 'BTC.BTC', destination: 'bc1qdest', shortCode: 'b' })
  assert.throws(() => checkDepositMemo('=:e:bc1qdest', { buyAsset: 'BTC.BTC', destination: 'bc1qdest', shortCode: 'b' }), /different asset/)
  const sol = 'So1Destination111111111111111111111111111111'
  checkDepositMemo(`=:SOL.SOL:${sol}`, { buyAsset: 'SOL.SOL', destination: sol })
  // The aggregator's real BCH -> SOL memo: THORNode's code `o`, while its token list gives SOL no shortCode.
  checkDepositMemo(`=:o:${sol}:55280894`, { buyAsset: 'SOL.SOL', destination: sol })
  checkDepositMemo('=:z:t1dest', { buyAsset: 'ZEC.ZEC', destination: 't1dest' })
  assert.throws(() => checkDepositMemo(`=:o:${sol}`, { buyAsset: 'BTC.BTC', destination: sol, shortCode: 'b' }), /different asset/)
  assert.throws(() => checkDepositMemo(`=:SOL.SOL:${sol.toLowerCase()}`, { buyAsset: 'SOL.SOL', destination: sol }), /different address/)
})
