// The keyless UTXO explorers behind /api/blockchair: each explorer dialect is read from recorded-shape
// fixtures, a failing explorer hands over to the next, and the answers keep the Blockchair shape the UTXO
// toolbox and the payout/status checks read. Run: npm run test:bridge
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { address, networks, Transaction } from 'bitcoinjs-lib'
import { NextRequest } from 'next/server.js'
import { BLOCKCHAIR_CHAINS } from '../src/lib/blockchair.ts'
import { utxoPayout } from '../src/lib/payout-check.ts'
import { outputScriptHex, UTXO_CHAINS } from '../src/lib/utxo-api.ts'

const route = await import('../src/app/api/blockchair/[...path]/route.ts')
const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))

const hex = bytes => Buffer.from(bytes).toString('hex')
const doge = address.toBase58Check(Buffer.alloc(20, 7), 0x1e)
const dogeScript = `76a914${'07'.repeat(20)}88ac`
const ltcBech = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9'
const btc = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const btcScript = '0014e8df018c7e326cc253faac7e46cdc51e68542c42'
const hashA = 'aa'.repeat(32)
const hashB = 'bb'.repeat(32)
const deposit = 'ab'.repeat(32)
const memoScript = `6a${(`OUT:${deposit.toUpperCase()}`.length).toString(16)}${hex(Buffer.from(`OUT:${deposit.toUpperCase()}`))}`

const MEMPOOL = 'https://mempool.space/api'
const BLOCKSTREAM = 'https://blockstream.info/api'
const DOGE1 = 'https://doge1.trezor.io/api/v2'

// Upstreams by exact URL: a Response, a function of the request, or an Error for an unreachable host.
const calls = []
function upstreams(table) {
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
    const reply = table[String(url)]
    if (reply === undefined) throw new TypeError(`unexpected upstream ${url}`)
    const answer = typeof reply === 'function' ? reply(init) : reply
    if (answer instanceof Error) throw answer
    return answer.clone()
  }
}
const json = (value, status = 200) => Response.json(value, { status })
const text = (value, status = 200) => new Response(value, { status })
const down = () => new TypeError('fetch failed')

async function call(path, { method = 'GET', body, query = '', headers } = {}) {
  const req = new NextRequest(`http://localhost:3000/api/blockchair/${path.join('/')}${query}`, {
    method,
    headers: { 'sec-fetch-site': 'same-origin', ...headers },
    body
  })
  const res = await route[method](req, { params: Promise.resolve({ path }) })
  return { status: res.status, body: await res.json() }
}

const esploraAddress = { chain_stats: { funded_txo_sum: 500_000, spent_txo_sum: 100_000, tx_count: 3 }, mempool_stats: { funded_txo_sum: 20_000, spent_txo_sum: 0, tx_count: 1 } }
const esploraCoins = [
  { txid: hashA, vout: 0, value: 50_000, status: { confirmed: true, block_height: 900_000 } },
  { txid: hashB, vout: 1, value: 370_000, status: { confirmed: true, block_height: 900_001 } },
  { txid: 'cc'.repeat(32), vout: 2, value: 20_000, status: { confirmed: false } }
]

test('every slug the toolbox derives is configured, and only the chains with a network look up addresses', () => {
  for (const slug of Object.values(BLOCKCHAIR_CHAINS)) assert.ok(UTXO_CHAINS[slug]?.explorers.length, slug)
  assert.deepEqual(
    Object.keys(UTXO_CHAINS).filter(slug => UTXO_CHAINS[slug].network),
    ['bitcoin', 'litecoin', 'dogecoin']
  )
})

test('output scripts are derived for the address kinds a wallet holds', () => {
  assert.equal(outputScriptHex(btc, networks.bitcoin), btcScript)
  assert.equal(outputScriptHex('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', networks.bitcoin), `76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac`)
  assert.equal(outputScriptHex('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', networks.bitcoin)?.slice(0, 4), '5120')
  assert.equal(outputScriptHex(doge, UTXO_CHAINS.dogecoin.network), dogeScript)
  assert.equal(outputScriptHex(ltcBech, UTXO_CHAINS.litecoin.network)?.slice(0, 4), '0014')
  assert.equal(outputScriptHex(btc, UTXO_CHAINS.litecoin.network), undefined, 'a Bitcoin address is not a Litecoin one')
})

test('an Esplora address dashboard carries the balance and the UTXOs in Blockchair’s shape', async () => {
  upstreams({ [`${MEMPOOL}/address/${btc}`]: json(esploraAddress), [`${MEMPOOL}/address/${btc}/utxo`]: json(esploraCoins) })
  const { status, body } = await call(['bitcoin', 'dashboards', 'address', btc], { query: '?transaction_details=true&key=sto' })
  assert.equal(status, 200)
  assert.equal(body.context.code, 200)
  assert.deepEqual(body.data[btc].address, { balance: 420_000, transaction_count: 4 })
  assert.deepEqual(body.data[btc].utxo[2], { block_id: -1, index: 2, transaction_hash: 'cc'.repeat(32), value: 20_000 })
  assert.equal(body.data[btc].utxo[0].block_id, 900_000)
})

test('outputs list the unspent coins largest first with their scripts, one page at a time', async () => {
  upstreams({ [`${MEMPOOL}/address/${btc}/utxo`]: json(esploraCoins) })
  const q = `?q=recipient(${btc}),is_spent(false),value(..2000000000000000)&s=value(desc)&limit=2&offset=0`
  const first = await call(['bitcoin', 'outputs'], { query: q })
  assert.deepEqual(first.body.data.map(o => o.value), [370_000, 50_000])
  assert.deepEqual(first.body.data[0], { is_spent: false, transaction_hash: hashB, index: 1, value: 370_000, script_hex: btcScript, block_id: 900_001, spending_signature_hex: null })
  const second = await call(['bitcoin', 'outputs'], { query: q.replace('offset=0', 'offset=2') })
  assert.deepEqual(second.body.data.map(o => o.block_id), [-1], 'the mempool coin is last and unconfirmed')
})

test('Blockbook (Dogecoin) is read for the address, its coins and a transaction with a memo', async () => {
  const tx = {
    txid: hashA,
    blockHeight: -1,
    hex: 'deadbeef',
    vout: [
      { value: '150000', n: 0, hex: dogeScript, addresses: [doge], isAddress: true },
      { value: '0', n: 1, hex: memoScript, addresses: ['OP_RETURN (OUT:AB)'], isAddress: false }
    ]
  }
  upstreams({
    [`${DOGE1}/address/${doge}?details=basic`]: json({ balance: '1000', unconfirmedBalance: '-100', txs: 5, unconfirmedTxs: 1 }),
    [`${DOGE1}/utxo/${doge}`]: json([{ txid: hashA, vout: 1, value: '900', height: 5_000_000, confirmations: 4 }, { txid: hashB, vout: 0, value: '5', confirmations: 0 }]),
    [`${DOGE1}/tx/${hashA}`]: json(tx)
  })
  const dashboard = await call(['dogecoin', 'dashboards', 'address', doge])
  assert.deepEqual(dashboard.body.data[doge].address, { balance: 900, transaction_count: 6 })
  assert.deepEqual(dashboard.body.data[doge].utxo.map(u => u.block_id), [5_000_000, -1])

  const outputs = await call(['dogecoin', 'outputs'], { query: `?q=recipient(${doge}),is_spent(false)&limit=30&offset=0` })
  assert.deepEqual(outputs.body.data.map(o => [o.value, o.script_hex]), [[900, dogeScript], [5, dogeScript]])

  const raw = await call(['dogecoin', 'raw', 'transaction', hashA])
  assert.deepEqual(raw.body.data, { [hashA]: { raw_transaction: 'deadbeef' } })

  // The payout check reads exactly this: a mempool transaction paying the destination with the deposit's memo.
  const transaction = await call(['dogecoin', 'dashboards', 'transaction', hashA])
  assert.equal(transaction.body.data[hashA].transaction.block_id, -1)
  assert.deepEqual(utxoPayout(transaction.body, hashA, { destination: doge, depositTxid: deposit, buyAsset: 'DOGE.DOGE' }), { hash: hashA, amount: '150000' })
})

test('an Esplora transaction is confirmed by its block height', async () => {
  upstreams({
    [`${MEMPOOL}/tx/${hashA}`]: json({ txid: hashA, status: { confirmed: true, block_height: 912_345 }, vout: [{ scriptpubkey: btcScript, scriptpubkey_address: btc, value: 7 }] })
  })
  const { body } = await call(['bitcoin', 'dashboards', 'transaction', hashA])
  assert.deepEqual(body.data[hashA], { transaction: { hash: hashA, block_id: 912_345 }, outputs: [{ recipient: btc, value: 7, script_hex: btcScript }] })
})

test('an explorer that is down, rate-limited or failing hands the call to the next one', async () => {
  upstreams({
    [`${MEMPOOL}/address/${btc}`]: text('slow down', 429),
    [`${MEMPOOL}/address/${btc}/utxo`]: json(esploraCoins),
    [`${BLOCKSTREAM}/address/${btc}`]: text('bad gateway', 502),
    [`${BLOCKSTREAM}/address/${btc}/utxo`]: json(esploraCoins),
    [`https://btc1.trezor.io/api/v2/address/${btc}?details=basic`]: json({ balance: '12', txs: 1 }),
    [`https://btc1.trezor.io/api/v2/utxo/${btc}`]: json([])
  })
  const { status, body } = await call(['bitcoin', 'dashboards', 'address', btc])
  assert.equal(status, 200)
  assert.equal(body.data[btc].address.balance, 12, 'the third explorer answered')
})

test('a CDN block page is the explorer turning us away, so the next explorer is asked', async () => {
  const blocked = () => new Response('<!DOCTYPE html>\n<html class="no-js" lang="en-US"><title>Attention Required! | Cloudflare</title></html>', { status: 403, headers: { 'content-type': 'text/html' } })
  upstreams({
    [`${DOGE1}/tx/${hashA}`]: blocked(),
    [`https://doge2.trezor.io/api/v2/tx/${hashA}`]: json({ txid: hashA, blockHeight: 5_000_001, vout: [] })
  })
  const { status, body } = await call(['dogecoin', 'dashboards', 'transaction', hashA])
  assert.equal(status, 200)
  assert.equal(body.data[hashA].transaction.block_id, 5_000_001)

  upstreams(Object.fromEntries(['doge1', 'doge2', 'doge3'].map(h => [`https://${h}.trezor.io/api/v2/tx/${hashA}`, blocked()])))
  const failed = await call(['dogecoin', 'dashboards', 'transaction', hashA])
  assert.equal(failed.status, 502, 'every explorer blocking us is an outage, not a bad request')
  assert.doesNotMatch(JSON.stringify(failed.body), /DOCTYPE/)
})

test('every explorer failing is a 502 and a refused request is a 400 that stops at the first explorer', async () => {
  upstreams({ ...Object.fromEntries(['doge1', 'doge2', 'doge3'].flatMap(h => [[`https://${h}.trezor.io/api/v2/address/${doge}?details=basic`, down()], [`https://${h}.trezor.io/api/v2/utxo/${doge}`, down()]])) })
  const failed = await call(['dogecoin', 'dashboards', 'address', doge])
  assert.equal(failed.status, 502)
  assert.equal(failed.body.code, 'upstream_unreachable')

  upstreams({ [`${MEMPOOL}/tx`]: text('sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met"}', 400) })
  const refused = await call(['bitcoin', 'push', 'transaction'], { method: 'POST', body: JSON.stringify({ data: '0200' }) })
  assert.equal(refused.status, 400)
  assert.match(refused.body.error, /min relay fee not met/)
  assert.equal(calls.length, 1, 'no other explorer is asked to relay a transaction the node refused')
})

test('an unknown transaction is an empty dashboard once every explorer has said so', async () => {
  const notFound = Object.fromEntries(['doge1', 'doge2', 'doge3'].map(h => [`https://${h}.trezor.io/api/v2/tx/${hashA}`, json({ error: `Transaction '${hashA}' not found` }, 400)]))
  upstreams(notFound)
  assert.deepEqual((await call(['dogecoin', 'dashboards', 'transaction', hashA])).body.data, {})
  assert.deepEqual((await call(['dogecoin', 'raw', 'transaction', hashA])).body.data, {})

  upstreams({ [`${MEMPOOL}/tx/${hashA}`]: text('Transaction not found', 404), [`${BLOCKSTREAM}/tx/${hashA}`]: down(), [`https://btc1.trezor.io/api/v2/tx/${hashA}`]: text('x', 500) })
  assert.equal((await call(['bitcoin', 'dashboards', 'transaction', hashA])).body.data[hashA], undefined, 'one explorer not knowing it, the rest failing')
})

test('broadcasting returns the transaction hash from either dialect', async () => {
  upstreams({ [`${MEMPOOL}/tx`]: init => text(init.body === '0200' ? hashA : 'wrong') })
  const esplora = await call(['bitcoin', 'push', 'transaction'], { method: 'POST', body: JSON.stringify({ data: '0200' }) })
  assert.deepEqual(esplora.body, { data: { transaction_hash: hashA }, context: { code: 200 } })

  upstreams({ 'https://doge1.trezor.io/api/v2/sendtx/': init => json({ result: hashB.toUpperCase() }) })
  const blockbook = await call(['dogecoin', 'push', 'transaction'], { method: 'POST', body: JSON.stringify({ data: '0200' }) })
  assert.equal(blockbook.body.data.transaction_hash, hashB)
  assert.equal(calls[0].body, '0200')
})

test('the route serves only the toolbox endpoints, for configured chains, with checked input', async () => {
  upstreams({})
  const refused = [
    [['bitcoin', 'stats']],
    [['__proto__', 'dashboards', 'address', btc]],
    [['constructor', 'outputs']],
    [['bitcoin', 'dashboards', 'transaction', `${hashA},${hashB}`], { status: 400 }],
    [['bitcoin', 'dashboards', 'address', 'bc1q/../x']],
    [['bitcoin', 'dashboards', 'address', '..', 'x']],
    [['bitcoin', 'dashboards', 'address', 'short'], { status: 400 }],
    [['bitcoin', 'outputs'], { status: 400, query: '?q=is_spent(false)' }],
    [['bitcoin-cash', 'dashboards', 'address', btc]],
    [['dash', 'outputs'], { query: `?q=recipient(${btc})` }],
    [['bitcoin', 'push', 'transaction'], { status: 400, method: 'POST', body: '{"data":"not hex"}' }],
    [['bitcoin', 'dashboards', 'address', btc], { method: 'POST', body: '{}' }]
  ]
  for (const [path, { status = 404, ...options } = {}] of refused) assert.equal((await call(path, options)).status, status, `${path.join('/')} ${options.query ?? ''}`)
  assert.equal(calls.length, 0, 'nothing reached an explorer')
  assert.equal((await call(['bitcoin', 'dashboards', 'address', btc], { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
})

test('transaction lookups work on the chains that cannot look up addresses', async () => {
  upstreams({ [`https://zec1.trezor.io/api/v2/tx/${hashA}`]: json({ txid: hashA, blockHeight: 3_000_000, vout: [] }) })
  assert.equal((await call(['zcash', 'dashboards', 'transaction', hashA])).body.data[hashA].transaction.block_id, 3_000_000)
})

// The toolbox itself, pointed at the route the way src/lib/wallets.ts points it, builds spendable
// transactions from the explorers' answers: fee estimate, maximum amount, UTXOs with scripts and raw transactions.
test('the UTXO toolbox builds Dogecoin and Bitcoin transactions through the route', async () => {
  const require = createRequire(import.meta.url)
  const { USwapConfig, Chain, AssetValue } = require('@tcswap/helpers')
  // The package's ESM entry cannot be imported by Node (a directory import); its CommonJS entry is the same code.
  const { getToolbox } = require(fileURLToPath(new URL('../node_modules/@tcswap/toolboxes/dist/index.cjs', import.meta.url)))
  USwapConfig.setEnv('blockchairApiUrl', 'http://localhost:3000/api/blockchair')

  const funding = new Transaction()
  funding.addInput(Buffer.alloc(32, 1), 0)
  funding.addOutput(Buffer.from(dogeScript, 'hex'), 1_000_000_000n)
  upstreams({
    [`${DOGE1}/address/${doge}?details=basic`]: json({ balance: '1000000000', txs: 1 }),
    [`${DOGE1}/utxo/${doge}`]: json([{ txid: funding.getId(), vout: 0, value: '1000000000', height: 5_000_000 }]),
    [`${DOGE1}/tx/${funding.getId()}`]: json({ txid: funding.getId(), hex: funding.toHex(), blockHeight: 5_000_000, vout: [] }),
    'https://app.bitgo.com/api/v2/doge/tx/fee': json({ feePerKb: 100_000_000 }),
    'https://app.bitgo.com/api/v2/btc/tx/fee': json({ feePerKb: 2_000 }),
    [`${MEMPOOL}/address/${btc}`]: json(esploraAddress),
    [`${MEMPOOL}/address/${btc}/utxo`]: json([esploraCoins[1]])
  })
  const facade = globalThis.fetch
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('http://localhost:3000/api/blockchair/')) return facade(url, init)
    const path = new URL(url).pathname.replace('/api/blockchair/', '').split('/')
    const req = new NextRequest(url, { method: init?.method ?? 'GET', headers: { 'sec-fetch-site': 'same-origin' }, body: init?.body })
    return route[init?.method ?? 'GET'](req, { params: Promise.resolve({ path }) })
  }

  const dogeToolbox = await getToolbox(Chain.Dogecoin)
  const max = await dogeToolbox.estimateMaxSendableAmount({ from: doge, feeOptionKey: 'fast' })
  // The toolbox reports satoshis in the value field here; what matters is balance less a fee.
  assert.ok(Number(max.getValue('string')) > 0 && Number(max.getValue('string')) < 1_000_000_000, 'the maximum is the balance less a fee')
  const sent = await dogeToolbox.createTransaction({ assetValue: AssetValue.from({ chain: Chain.Dogecoin, value: 1 }), recipient: doge, sender: doge, memo: 'hello', feeRate: 1000 })
  assert.deepEqual(sent.inputs.map(i => [i.hash, i.index]), [[funding.getId(), 0]])

  const btcToolbox = await getToolbox(Chain.Bitcoin)
  const utxos = await btcToolbox.getInputsOutputsFee({ assetValue: AssetValue.from({ chain: Chain.Bitcoin, value: 0.0001 }), recipient: btc, sender: btc, feeRate: 2 })
  assert.equal(utxos.inputs[0].value, 370_000)
  assert.equal(calls.some(c => c.url.startsWith(MEMPOOL)), true)
})
