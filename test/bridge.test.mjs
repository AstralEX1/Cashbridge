// THORChain -> BCH -> PUSD bridge: fixture tests for the money-moving checks.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binToHex, decodeTransaction, encodeTransaction, hash160, hexToBin } from '@bitauth/libauth'
import { addressPaysScript, bindingFromPubkey, checkOutbound, decodeTx, isValidBinding, opReturnText, txidOf } from '../src/lib/bch.ts'
import { bestTrade, checkPoolCovenants, checkSigned, poolLockingBytecode, reviewBuild, sourcesOf, tradeTransaction } from '../src/lib/cauldron.ts'
import { formatBaseUnits, inboundMatchesBinding, interpretMidgard, interpretTxStatus, minOutputFor, secondLegSellAmount, toBaseUnits } from '../src/lib/bridge.ts'
import { assertBridgeQuoteRequest, isBridgeRoute } from '../src/lib/api.ts'
import { BridgeConfig } from '../src/config.ts'
import { inboundHash, otherKey, otherPubkey, OTHER_TOKEN, outboundTx, pubkey, PUSD, signBuild, swapBuild } from './fixtures/bridge-fixtures.mjs'

const binding = bindingFromPubkey(pubkey, 0)
const ownScript = hexToBin(binding.lockingBytecode)
const otherBinding = bindingFromPubkey(otherPubkey, 0)

// --- Identity and addresses --------------------------------------------------------------------

test('PUSD identity is the verified category with 2 decimals', () => {
  assert.equal(BridgeConfig.pusd.category, PUSD)
  assert.equal(BridgeConfig.pusd.decimals, 2)
})

test('plain and token-aware addresses of the binding pay the same script', () => {
  assert.ok(binding.cashAddress.startsWith('bitcoincash:q'))
  assert.ok(binding.tokenAddress.startsWith('bitcoincash:z'))
  assert.ok(addressPaysScript(binding.cashAddress, binding.lockingBytecode))
  assert.ok(addressPaysScript(binding.tokenAddress, binding.lockingBytecode))
  assert.ok(addressPaysScript(binding.cashAddress.replace('bitcoincash:', ''), binding.lockingBytecode), 'THORNode may print it without prefix')
  assert.ok(addressPaysScript(binding.cashAddress.toUpperCase(), binding.lockingBytecode))
  assert.ok(!addressPaysScript(otherBinding.cashAddress, binding.lockingBytecode))
  assert.ok(!addressPaysScript('bchtest:' + binding.cashAddress.split(':')[1], binding.lockingBytecode))
})

test('a restored binding is accepted only if it still derives from its key', () => {
  assert.ok(isValidBinding(binding))
  assert.ok(!isValidBinding({ ...binding, cashAddress: otherBinding.cashAddress }), 'swapped destination')
  assert.ok(!isValidBinding({ ...binding, lockingBytecode: otherBinding.lockingBytecode }))
  assert.ok(!isValidBinding({ ...binding, pubkey: 'zz' }))
  assert.ok(!isValidBinding(null))
})

// --- Amounts -----------------------------------------------------------------------------------

test('decimal strings convert to base units exactly, or not at all', () => {
  assert.equal(toBaseUnits('1', 8), 100_000_000n)
  assert.equal(toBaseUnits('0.00012345', 8), 12_345n)
  assert.equal(toBaseUnits('12.30', 2), 1_230n)
  assert.throws(() => toBaseUnits('0.000000001', 8))
  assert.throws(() => toBaseUnits('-1', 8))
  assert.throws(() => toBaseUnits('1e8', 8))
  assert.equal(formatBaseUnits(123_456n, 2), '1234.56')
  assert.equal(formatBaseUnits('100000000', 8), '1')
})

test('second-leg reserve leaves room for fees and grows on retry', () => {
  const total = 1_000_000n
  assert.ok(secondLegSellAmount(total, 0) < total)
  assert.ok(secondLegSellAmount(total, 1) < secondLegSellAmount(total, 0))
  assert.equal(secondLegSellAmount(3_000n), 0n, 'too small to swap')
  assert.equal(minOutputFor(10_000n, 100), 9_900n)
})

// --- First-leg restrictions (crafted URLs / state / quotes) -------------------------------------

test('only THORChain quotes to BCH.BCH are requested', () => {
  assert.doesNotThrow(() => assertBridgeQuoteRequest({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH', providers: ['THORCHAIN'] }))
  assert.throws(() => assertBridgeQuoteRequest({ sellAsset: 'ETH.ETH', buyAsset: 'BTC.BTC', providers: ['THORCHAIN'] }))
  assert.throws(() => assertBridgeQuoteRequest({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH', providers: ['MAYACHAIN'] }))
  assert.throws(() => assertBridgeQuoteRequest({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH', providers: ['THORCHAIN', 'HOUDINI'] }))
  assert.throws(() => assertBridgeQuoteRequest({ sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH', providers: [] }))
  assert.throws(() => assertBridgeQuoteRequest({ sellAsset: 'BCH.BCH', buyAsset: 'BCH.BCH', providers: ['THORCHAIN'] }))
})

test('a returned route must still be THORChain to BCH paying the asked address', () => {
  const route = { sellAsset: 'ETH.ETH', buyAsset: 'BCH.BCH', providers: ['THORCHAIN'], destinationAddress: binding.cashAddress }
  const request = { sellAsset: 'ETH.ETH', destinationAddress: binding.cashAddress }
  assert.ok(isBridgeRoute(route, request))
  assert.ok(isBridgeRoute({ ...route, providers: ['THORCHAIN_STREAMING'] }, request))
  assert.ok(!isBridgeRoute({ ...route, buyAsset: 'ETH.USDC-0XA0B8' }, request))
  assert.ok(!isBridgeRoute({ ...route, providers: ['MAYACHAIN'] }, request))
  assert.ok(!isBridgeRoute({ ...route, destinationAddress: otherBinding.cashAddress }, request))
  assert.ok(!isBridgeRoute({ ...route, sellAsset: 'BTC.BTC' }, request))
  // As the aggregator really answers: the asked `bitcoincash:` address comes back without its prefix.
  assert.ok(isBridgeRoute({ ...route, destinationAddress: binding.cashAddress.split(':')[1] }, request))
  assert.ok(!isBridgeRoute({ ...route, destinationAddress: otherBinding.cashAddress.split(':')[1] }, request))
  assert.ok(!isBridgeRoute({ ...route, destinationAddress: undefined }, request))
})

// --- THORNode first-leg interpretation ---------------------------------------------------------

const done = { swap_status: { pending: false }, swap_finalised: { completed: true }, outbound_signed: { completed: true } }
const bchOut = (amount = '1000000', to = binding.cashAddress) => ({ id: 'CC'.repeat(32), chain: 'BCH', to_address: to, coins: [{ asset: 'BCH.BCH', amount }], memo: `OUT:${inboundHash}` })

test('a swap still streaming is pending', () => {
  const view = interpretTxStatus({ stages: { swap_status: { pending: true } } }, binding.lockingBytecode)
  assert.equal(view.kind, 'pending')
})

test('a planned outbound is never presented as received', () => {
  const view = interpretTxStatus(
    { planned_out_txs: [{ chain: 'BCH', to_address: binding.cashAddress, coin: { asset: 'BCH.BCH', amount: '1000000' }, refund: false }], stages: { swap_status: { pending: false } } },
    binding.lockingBytecode
  )
  assert.equal(view.kind, 'pending')
})

test('an executed outbound to the bound address is reported with its amount', () => {
  const view = interpretTxStatus({ out_txs: [bchOut()], planned_out_txs: [{ chain: 'BCH', to_address: binding.cashAddress, coin: { asset: 'BCH.BCH', amount: '1000000' }, refund: false }], stages: done }, binding.lockingBytecode)
  assert.equal(view.kind, 'outbound')
  assert.equal(view.result, 'swapped')
  assert.deepEqual(view.outbound, [{ txid: 'cc'.repeat(32), amountSats: '1000000' }])
})

test('an outbound to another address or of another asset is refused', () => {
  assert.equal(interpretTxStatus({ out_txs: [bchOut('1', otherBinding.cashAddress)], stages: done }, binding.lockingBytecode).kind, 'invalid')
  assert.equal(interpretTxStatus({ out_txs: [{ ...bchOut(), chain: 'BTC', coins: [{ asset: 'BTC.BTC', amount: '1' }] }], stages: done }, binding.lockingBytecode).kind, 'invalid')
})

test('full refund, pending refund and partial fill are told apart', () => {
  const refund = { id: 'DD'.repeat(32), chain: 'ETH', to_address: '0xabc', coins: [{ asset: 'ETH.ETH', amount: '100' }], memo: `REFUND:${inboundHash}` }
  const full = interpretTxStatus({ out_txs: [refund], planned_out_txs: [{ chain: 'ETH', to_address: '0xabc', coin: refund.coins[0], refund: true }], stages: done }, binding.lockingBytecode)
  assert.equal(full.kind, 'refunded')

  const pendingRefund = interpretTxStatus({ planned_out_txs: [{ chain: 'ETH', to_address: '0xabc', coin: refund.coins[0], refund: true }], stages: done }, binding.lockingBytecode)
  assert.equal(pendingRefund.kind, 'pending')
  assert.equal(pendingRefund.result, 'refund_pending')

  const partial = interpretTxStatus(
    {
      out_txs: [bchOut('500000'), refund],
      planned_out_txs: [
        { chain: 'BCH', to_address: binding.cashAddress, coin: { asset: 'BCH.BCH', amount: '500000' }, refund: false },
        { chain: 'ETH', to_address: '0xabc', coin: refund.coins[0], refund: true }
      ],
      stages: done
    },
    binding.lockingBytecode
  )
  assert.equal(partial.kind, 'outbound')
  assert.equal(partial.result, 'partial')
  assert.equal(partial.refunds.length, 1)
})

test('Midgard is used only to conclude refunds', () => {
  assert.equal(interpretMidgard([{ type: 'swap', status: 'success', in: [], out: [] }]), undefined)
  assert.equal(interpretMidgard([{ type: 'refund', status: 'success', in: [], out: [{ txID: 'x', address: 'a', coins: [{ asset: 'ETH.ETH', amount: '1' }] }] }]).kind, 'refunded')
  assert.equal(interpretMidgard([{ type: 'refund', status: 'pending', in: [], out: [] }]).kind, 'pending')
})

test('a hand-entered source hash must be a swap to BCH paying the bound address', () => {
  assert.ok(inboundMatchesBinding({ tx: { memo: `=:BCH.BCH:${binding.cashAddress}:0/1/0` } }, binding.lockingBytecode))
  assert.ok(inboundMatchesBinding({ tx: { memo: `=:c:${binding.cashAddress.split(':')[1]}:0/1/0:t:0` } }, binding.lockingBytecode))
  assert.ok(!inboundMatchesBinding({ tx: { memo: `=:BCH.BCH:${otherBinding.cashAddress}:0` } }, binding.lockingBytecode))
  assert.ok(!inboundMatchesBinding({ tx: { memo: `=:ETH.ETH:0xabc:0` } }, binding.lockingBytecode))
  assert.ok(!inboundMatchesBinding({ tx: { memo: `+:BCH.BCH:${binding.cashAddress}` } }, binding.lockingBytecode))
})

// --- On-chain BCH receipt ----------------------------------------------------------------------

const outboundFixture = opts => {
  const hex = outboundTx({ to: ownScript, amount: 1_000_000n, ...opts })
  return { hex, tx: decodeTx(hex), txid: txidOf(hex) }
}

test('the outbound memo is read from its OP_RETURN', () => {
  const { tx } = outboundFixture()
  assert.equal(opReturnText(tx.outputs[2].lockingBytecode), `OUT:${inboundHash}`)
})

test('confirmed, unspent outputs of THORChain’s outbound are verified', () => {
  const raw = outboundFixture()
  const check = checkOutbound(raw, { inboundHash, lockingBytecode: binding.lockingBytecode, expectedSats: 1_000_000n }, { tip: 100, utxos: [{ txid: raw.txid, vout: 0, value: 1_000_000n, height: 100, hasToken: false }] })
  assert.equal(check.kind, 'ok')
  assert.equal(check.total, '1000000')
  assert.equal(check.confirmations, 1)
  assert.ok(check.outputs[0].unspent)
})

test('insufficient confirmations and spent outputs are reported, not unlocked', () => {
  const raw = outboundFixture()
  const unconfirmed = checkOutbound(raw, { inboundHash, lockingBytecode: binding.lockingBytecode, expectedSats: 1_000_000n }, { tip: 100, utxos: [{ txid: raw.txid, vout: 0, value: 1_000_000n, height: 0, hasToken: false }] })
  assert.equal(unconfirmed.confirmations, 0)
  const spent = checkOutbound(raw, { inboundHash, lockingBytecode: binding.lockingBytecode, expectedSats: 1_000_000n }, { tip: 100, utxos: [] })
  assert.equal(spent.outputs[0].unspent, false)
})

test('wrong memo, wrong recipient, token outputs and amount mismatch are refused', () => {
  const ctx = { inboundHash, lockingBytecode: binding.lockingBytecode, expectedSats: 1_000_000n }
  const none = { tip: 1, utxos: [] }
  assert.equal(checkOutbound(outboundFixture({ memo: 'OUT:' + 'F'.repeat(64) }), ctx, none).kind, 'invalid')
  assert.equal(checkOutbound(outboundFixture({ memo: `REFUND:${inboundHash}` }), ctx, none).kind, 'invalid')
  assert.equal(checkOutbound(outboundFixture({ to: hexToBin(otherBinding.lockingBytecode) }), ctx, none).kind, 'invalid')
  assert.equal(checkOutbound(outboundFixture({ token: { category: hexToBin(PUSD), amount: 1n } }), ctx, none).kind, 'invalid')
  assert.equal(checkOutbound(outboundFixture({ amount: 999_999n }), ctx, none).kind, 'invalid', 'planned amount is not received amount')
})

// --- Cauldron transaction review ---------------------------------------------------------------

const funding = [{ txid: 'cc'.repeat(32), vout: 0, value: '1000000' }]
const sellSats = 990_000n
const intent = { funding, lockingBytecode: binding.lockingBytecode, tokenAddress: binding.tokenAddress, cashAddress: binding.cashAddress, sellSats, minOutput: 4_900n }
const build = (opts = {}) => swapBuild({ ownScript, funding, sellSats, pusdOut: 5_000n, ...opts })

test('a correct build is accepted and its money flows are computed from the transaction', () => {
  const reviewed = reviewBuild(build(), intent)
  assert.equal(reviewed.pusdOut, 5_000n)
  assert.equal(reviewed.routerFeeSats, 0n)
  assert.equal(reviewed.minerFeeSats, 600n)
  assert.deepEqual(reviewed.ownIndexes, [0])
  assert.equal(reviewed.debitSats, sellSats + 600n)
})

test('modified outputs and excessive fees are refused', () => {
  assert.throws(() => reviewBuild(build({ routerFee: 990n }), intent), /BCH leaves to an address/)
  assert.throws(() => reviewBuild(build({ minerFee: 5_000n }), intent), /miner fee is excessive/)
  assert.throws(() => reviewBuild(build({ minerFee: 10n }), intent), /too low/)
  assert.throws(
    () =>
      reviewBuild(
        build({
          mutate: tx => {
            // Redirect the BCH change to someone else.
            tx.outputs[2].lockingBytecode = hexToBin(otherBinding.lockingBytecode)
          }
        }),
        intent
      ),
    /BCH leaves to an address|More BCH/
  )
})

test('wrong category, NFTs, burns and low output are refused', () => {
  assert.throws(() => reviewBuild(build({ tokenCategory: OTHER_TOKEN }), intent), /different token category|burned/)
  assert.throws(() => reviewBuild(build({ pusdOut: 4_000n }), intent), /less PUSD/)
  assert.throws(
    () =>
      reviewBuild(
        build({
          mutate: tx => {
            tx.outputs[0].token.amount -= 1n // pool keeps 1 less: burned
          }
        }),
        intent
      ),
    /burned/
  )
  assert.throws(
    () =>
      reviewBuild(
        build({
          mutate: tx => {
            tx.outputs[1].token.nft = { capability: 'none', commitment: new Uint8Array() }
          }
        }),
        intent
      ),
    /NFT|burned/
  )
})

test('unrelated wallet inputs, spent or altered funding and a wrong signing set are refused', () => {
  assert.throws(() => reviewBuild(build({ extraInputs: [{ txid: 'dd'.repeat(32), vout: 3, value: '50000' }] }), intent), /not approved/)
  assert.throws(() => reviewBuild(build(), { ...intent, funding: [{ ...funding[0], value: '1000001' }] }), /does not match/)
  assert.throws(() => reviewBuild(build(), { ...intent, funding: [...funding, { txid: 'ee'.repeat(32), vout: 0, value: '1' }] }), /Not every/)
  const b = build()
  assert.throws(() => reviewBuild({ ...b, inputs_to_sign: [0, 1] }, intent), /inputs to sign/)
  assert.throws(() => reviewBuild({ ...b, inputs_to_sign: [] }, intent), /inputs to sign/)
  assert.throws(() => reviewBuild({ ...b, source_outputs: b.source_outputs.slice(1) }, intent), /line up/)
})

// --- Signed transaction checks -----------------------------------------------------------------

const reviewedAndSigned = (key, mutateSigned) => {
  const reviewed = reviewBuild(build(), intent)
  const unsigned = decodeTransaction(hexToBin(reviewed.unsignedHex))
  let signed = signBuild(unsigned, sourcesOf(reviewed), reviewed.ownIndexes, key)
  if (mutateSigned) {
    const tx = decodeTransaction(hexToBin(signed))
    mutateSigned(tx)
    signed = binToHex(encodeTransaction(tx))
  }
  return { reviewed, signed }
}

test('a correctly signed transaction verifies and yields its txid', () => {
  const { reviewed, signed } = reviewedAndSigned()
  assert.equal(checkSigned(reviewed.unsignedHex, signed, reviewed.ownIndexes, sourcesOf(reviewed), binding.pubkey), txidOf(signed))
})

test('signatures by another key, changed outputs or changed pool inputs are refused', () => {
  const other = reviewedAndSigned(otherKey)
  assert.throws(() => checkSigned(other.reviewed.unsignedHex, other.signed, other.reviewed.ownIndexes, sourcesOf(other.reviewed), binding.pubkey), /different key/)

  const changedOutput = reviewedAndSigned(undefined, tx => {
    tx.outputs[2].valueSatoshis -= 1n
  })
  assert.throws(() => checkSigned(changedOutput.reviewed.unsignedHex, changedOutput.signed, changedOutput.reviewed.ownIndexes, sourcesOf(changedOutput.reviewed), binding.pubkey), /outputs/)

  const changedPool = reviewedAndSigned(undefined, tx => {
    tx.inputs[1].unlockingBytecode = Uint8Array.from([0x01, 0x52])
  })
  assert.throws(() => checkSigned(changedPool.reviewed.unsignedHex, changedPool.signed, changedPool.reviewed.ownIndexes, sourcesOf(changedPool.reviewed), binding.pubkey), /pool input/)

  const { reviewed } = reviewedAndSigned()
  assert.throws(() => checkSigned(reviewed.unsignedHex, reviewed.unsignedHex, reviewed.ownIndexes, sourcesOf(reviewed), binding.pubkey), /unsigned/)
  assert.throws(() => checkSigned(reviewed.unsignedHex, 'zz', reviewed.ownIndexes, sourcesOf(reviewed), binding.pubkey), /invalid transaction/)
})

test('a signature that does not commit to the whole transaction is refused', () => {
  const tampered = reviewedAndSigned(undefined, tx => {
    const u = tx.inputs[0].unlockingBytecode
    const sigLength = u[0]
    u[sigLength] = 0xc1 // SIGHASH_ALL | FORKID | ANYONECANPAY
  })
  assert.throws(
    () => checkSigned(tampered.reviewed.unsignedHex, tampered.signed, tampered.reviewed.ownIndexes, sourcesOf(tampered.reviewed), binding.pubkey),
    /whole transaction/
  )
})

test('the binding key hash is what the fixtures pay', () => {
  assert.equal(binToHex(hash160(pubkey)), binding.lockingBytecode.slice(6, 46))
})

test('a binding on the wallet’s DeFi path is accepted; an unknown path is not', () => {
  const defi = bindingFromPubkey(pubkey, 0, 'defi')
  assert.equal(defi.path, 'defi')
  assert.equal(defi.lockingBytecode, binding.lockingBytecode)
  assert.ok(isValidBinding(defi))
  assert.ok(!isValidBinding({ ...binding, path: 'change' }))
  assert.ok(!isValidBinding({ ...binding, path: '__proto__' }))
})

test('every pool input must accept the trade under its own covenant', () => {
  const reviewed = reviewBuild(build(), intent)
  // The stand-in pool (P2SH32 of OP_1) accepts the trade, unsigned as it is.
  checkPoolCovenants(reviewed)
  // A pool whose script fails (OP_RETURN) blocks the build before anything is signed.
  const refusing = {
    ...reviewed,
    sourceOutputs: reviewed.sourceOutputs.map((s, i) => (reviewed.ownIndexes.includes(i) ? s : { ...s, lockingBytecode: '6a' }))
  }
  assert.throws(() => checkPoolCovenants(refusing), /does not accept/)
})

// --- Local Cauldron trade (@cashlab/cauldron) --------------------------------------------------

// A Cauldron pool with the real PoolV0 covenant, near the live price of ~3,600 sats per PUSD unit.
const cauldronPool = (sats, tokens, txByte = 'dd') => {
  const withdrawPkh = new Uint8Array(20).fill(7)
  return {
    version: '0',
    parameters: { withdraw_pubkey_hash: withdrawPkh },
    outpoint: { txhash: hexToBin(txByte.repeat(32)), index: 1 },
    output: { locking_bytecode: poolLockingBytecode(withdrawPkh), token: { amount: tokens, token_id: PUSD }, amount: sats }
  }
}
const localFunding = [{ txid: 'ee'.repeat(32), vout: 0, value: '1010000' }]
const localTrade = () => {
  const trade = bestTrade([cauldronPool(108_000_000n, 30_000n)], 1_000_000n)
  const localIntent = {
    funding: localFunding,
    lockingBytecode: binding.lockingBytecode,
    tokenAddress: binding.tokenAddress,
    cashAddress: binding.cashAddress,
    sellSats: trade.summary.supply,
    minOutput: minOutputFor(trade.summary.demand)
  }
  return { trade, localIntent, build: tradeTransaction(trade, localIntent) }
}

test('a local trade passes the review, the real pool covenant and the signature checks', () => {
  const { trade, localIntent, build: local } = localTrade()
  assert.ok(trade.summary.supply > 0n && trade.summary.supply <= 1_000_000n)
  // ~1,000,000 sats at ~3,600 sats per unit, less the 0.3% pool fee and price impact.
  assert.ok(trade.summary.demand > 260n && trade.summary.demand < 280n, `got ${trade.summary.demand}`)
  const reviewed = reviewBuild(local, localIntent)
  assert.equal(reviewed.pusdOut, trade.summary.demand)
  assert.deepEqual(reviewed.ownIndexes, [1])
  assert.equal(reviewed.routerFeeSats, 0n)
  assert.equal(decodeTransaction(hexToBin(reviewed.unsignedHex)).inputs[1].unlockingBytecode.length, 0, 'the throwaway signature is removed')
  checkPoolCovenants(reviewed)
  const signed = signBuild(decodeTransaction(hexToBin(reviewed.unsignedHex)), sourcesOf(reviewed), reviewed.ownIndexes)
  assert.equal(checkSigned(reviewed.unsignedHex, signed, reviewed.ownIndexes, sourcesOf(reviewed), binding.pubkey), txidOf(signed))
})

test('the pool covenant refuses a trade that takes more PUSD than the pool pays', () => {
  const { localIntent, build: local } = localTrade()
  const tx = decodeTransaction(hexToBin(local.unsigned_tx_hex))
  // One more PUSD unit out of the pool and into the wallet: tokens are still conserved.
  tx.outputs[0].token.amount -= 1n
  tx.outputs.find(o => o.token && o !== tx.outputs[0]).token.amount += 1n
  const reviewed = reviewBuild({ ...local, unsigned_tx_hex: binToHex(encodeTransaction(tx)) }, localIntent)
  assert.throws(() => checkPoolCovenants(reviewed), /does not accept/)
})

test('a sale the funding cannot cover is reported as insufficient funds', () => {
  const { trade, localIntent } = localTrade()
  assert.throws(() => tradeTransaction(trade, { ...localIntent, funding: [{ ...localFunding[0], value: '500000' }] }), e => e.code === 'insufficient_funds')
})
