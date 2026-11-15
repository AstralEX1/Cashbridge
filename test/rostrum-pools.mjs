// Read-only live check of the Rostrum pool feed against the indexer and the chain: how many PUSD pools each
// lists, how many of them are still unspent on a Fulcrum server, and whether the feed pushes updates.
// Nothing is signed or broadcast. Usage (from the repo root, on a machine that can reach the servers):
//   node --no-warnings --import ./test/register-ts-alias.mjs test/rostrum-pools.mjs [seconds to listen, default 30]
import { BridgeConfig } from '@/config'
import { checkOutpointsLive } from '@/lib/bch'
import { poolFeed } from '@/lib/cauldron-rostrum'

const category = BridgeConfig.pusd.category
const seconds = Number(process.argv[2] ?? 30)

const unspent = async pools => {
  const checked = await checkOutpointsLive(pools.map(p => ({ txid: p.txid, vout: p.vout, value: BigInt(p.sats), token: { category, amount: BigInt(p.tokens) } })))
  return checked.filter(c => c.live).length
}

console.log('Rostrum servers:', BridgeConfig.rostrumUrls.join(', '))
const started = Date.now()
const feed = await poolFeed.pools(category)
console.log(`feed: ${feed.length} pools in ${Date.now() - started} ms, ${await unspent(feed)} unspent on chain`)

const response = await fetch(`${BridgeConfig.cauldronIndexerUrl}/cauldron/pool/active?token=${category}`)
const body = await response.json()
const indexed = (body.active ?? []).map(p => ({ txid: p.txid, vout: p.tx_pos, sats: p.sats, tokens: p.tokens }))
console.log(`indexer: ${indexed.length} pools, ${await unspent(indexed)} unspent on chain`)

const feedKeys = new Set(feed.map(p => `${p.txid}:${p.vout}`))
const indexedKeys = new Set(indexed.map(p => `${p.txid}:${p.vout}`))
console.log(`only in feed: ${[...feedKeys].filter(k => !indexedKeys.has(k)).length}, only in indexer: ${[...indexedKeys].filter(k => !feedKeys.has(k)).length}`)

console.log(`listening for updates for ${seconds} s...`)
let last = feed.length
for (let i = 0; i < seconds; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000))
  const now = (await poolFeed.pools(category)).length
  if (now !== last) console.log(`  t+${i + 1}s: pool count ${last} -> ${now}`)
  last = now
}
poolFeed.close()
