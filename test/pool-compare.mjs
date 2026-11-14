// Read-only check of a second-leg build against the pools: which pools the local trade spends, at
// what price, whether each pool's own covenant accepts the trade (VM evaluation of that input), and
// whether every pool input is still unspent on chain. Nothing is signed or broadcast. Usage (from the repo root):
//   node --no-warnings --import ./test/register-ts-alias.mjs test/pool-compare.mjs <bitcoincash:address>
import { binToHex, createVirtualMachineBch2026 } from '@bitauth/libauth'
import { BridgeConfig } from '@/config'
import { addressToLockingBytecode, decodeTx, scriptHash, WsRpc } from '@/lib/bch'
import { minOutputFor, secondLegSellAmount } from '@/lib/bridge'
import { buildPusdSwap, checkPoolsLive, quotePusd, reviewBuild, sourcesOf } from '@/lib/cauldron'
import { encodeCashAddress, hexToBin } from '@bitauth/libauth'

const address = process.argv[2]
const lockingBytecode = address && addressToLockingBytecode(address)
if (!lockingBytecode?.startsWith('76a914')) throw new Error('Pass a P2PKH bitcoincash: address')
const tokenAddress = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkhWithTokens', payload: hexToBin(lockingBytecode.slice(6, 46)) }).address

const client = new WsRpc(BridgeConfig.electrumUrls[0], { jsonrpc: true })
await client.open()
await client.request('server.version', ['thorchain-bch-bridge-poolcheck', '1.4'])
const list = await client.request('blockchain.scripthash.listunspent', [scriptHash(lockingBytecode), 'include_tokens'])
client.close()
const plain = list.filter(u => !u.token_data)
if (!plain.length) throw new Error('No BCH at this address')
const funding = plain.map(u => ({ txid: u.tx_hash, vout: u.tx_pos, value: String(u.value) }))
const total = plain.reduce((s, u) => s + BigInt(u.value), 0n)

let build, intent
for (let attempt = 0; attempt < 3 && !build; attempt++) {
  const quote = await quotePusd(secondLegSellAmount(total, attempt))
  intent = { funding, lockingBytecode, tokenAddress, cashAddress: address, sellSats: quote.sellSats, minOutput: minOutputFor(quote.output) }
  build = await buildPusdSwap(intent).catch(e => (console.log(`attempt ${attempt}: ${e.message}`), undefined))
}
if (!build) process.exit(1)
const reviewed = reviewBuild(build, intent)
const tx = decodeTx(build.unsigned_tx_hex)
const sources = sourcesOf(reviewed)
const vm = createVirtualMachineBch2026(true)
const category = BridgeConfig.pusd.category

// Each pool input is paired with the output at the same index (Cauldron pools pay themselves back
// at their input's index); the trade is the difference.
const trades = []
tx.inputs.forEach((input, i) => {
  if (reviewed.ownIndexes.includes(i)) return
  const src = sources[i]
  const out = tx.outputs[i]
  const sameScript = out && binToHex(out.lockingBytecode) === binToHex(src.lockingBytecode)
  const state = vm.evaluate({ inputIndex: i, sourceOutputs: sources, transaction: tx })
  const ok = vm.stateSuccess(state)
  trades.push({
    i,
    outpoint: `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`,
    sats: src.valueSatoshis,
    tokens: src.token && binToHex(src.token.category) === category ? src.token.amount : 0n,
    satsIn: sameScript ? out.valueSatoshis - src.valueSatoshis : undefined,
    tokensOut: sameScript && out.token ? src.token.amount - out.token.amount : undefined,
    covenant: ok === true ? 'accepts' : `refuses: ${ok}`
  })
})

const fmt = n => (n === undefined ? '?' : n.toString())
console.log(`Sell ${reviewed.sellSats} sats → PUSD out ${reviewed.pusdOut} units (min ${reviewed.minOutput}); ${trades.length} pool inputs`)
for (const t of trades) {
  const price = t.tokens > 0n ? Number(t.sats) / Number(t.tokens) : NaN
  const fill = t.tokensOut ? Number(t.satsIn) / Number(t.tokensOut) : NaN
  console.log(`  #${t.i} ${t.outpoint} pool ${fmt(t.sats)} sats / ${fmt(t.tokens)} PUSD (spot ${price.toFixed(1)} sats/unit), in ${fmt(t.satsIn)} sats, out ${fmt(t.tokensOut)} PUSD (fill ${fill.toFixed(1)}), covenant ${t.covenant}`)
}

console.log(`Live check: ${await checkPoolsLive(reviewed).then(() => 'every pool input is unspent', e => e.message)}`)
