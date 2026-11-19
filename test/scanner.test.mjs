import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RUNS } from '../src/lib/mainnet-runs.ts'
import { explorerIcon, hashLookups, matchesQuery, rowFromOrder, rowFromRun, scanRows } from '../src/lib/scanner.ts'
import { FEATURED_TOKENS } from '../src/lib/cauldron-tokens.ts'

const PUSD = FEATURED_TOKENS[0]
const order = {
  ref: 'a1b2c3d4e5f6',
  kind: 'forward',
  state: 'completed',
  createdAt: 1000,
  updatedAt: 2000,
  contract: false,
  category: PUSD.category,
  expectedBchSats: '1000000',
  source: { chain: 'BASE', asset: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', amount: '5' },
  sourceHash: 'ab'.repeat(32),
  bchReceipts: [{ txid: 'cd'.repeat(32), amountSats: '1000000' }],
  settlement: { kind: 'swap', txid: 'ef'.repeat(32), tokenAmount: '339', bchAmount: '0' }
}

test('every verified mainnet run becomes a completed scanner row with both ends and explorer links', () => {
  for (const run of RUNS) {
    const row = rowFromRun(run)
    assert.equal(row.status, 'completed')
    assert.equal(row.verified, true)
    assert.ok(row.from.amount && row.from.ticker && row.to.amount && row.to.ticker, run.amounts)
    assert.equal(row.legs.length, run.links.length)
    for (const leg of row.legs) assert.match(leg.url, /^https:\/\//)
  }
})

test('a Router order shows source, THORChain, BCH and payout legs with chain-specific links', () => {
  const row = rowFromOrder(order)
  assert.deepEqual(
    row.legs.map(leg => leg.label),
    ['Base deposit', 'THORChain swap', 'BCH to order', 'PUSD payout']
  )
  assert.match(row.legs[0].url, new RegExp(`0x${'ab'.repeat(32)}$`), 'an EVM deposit hash links with its 0x prefix')
  assert.equal(row.legs[1].url, `https://thorchain.net/tx/${'ab'.repeat(32)}`)
  assert.deepEqual([row.from.ticker, row.from.chain, row.to.ticker, row.to.amount], ['USDC', 'BASE', 'PUSD', '3.39'])
  assert.equal(row.router, true)

  const refunded = rowFromOrder({ ...order, state: 'refunded', settlement: { kind: 'refund', txid: 'ef'.repeat(32), tokenAmount: '0', bchAmount: '99000' } })
  assert.equal(refunded.status, 'refunded')
  assert.deepEqual([refunded.to.ticker, refunded.to.amount, refunded.legs.at(-1).label], ['BCH', '0.00099', 'BCH refund'])
})

test('a Router order whose first leg went through NEAR Intents links no THORChain record', () => {
  const row = rowFromOrder({ ...order, near: true })
  assert.deepEqual(
    row.legs.map(leg => leg.label),
    ['Base deposit', 'BCH to order', 'PUSD payout']
  )
})

test('each end shows its coin with the chain mark only where the coin does not name the chain, and each step its explorer chain', () => {
  const row = rowFromOrder(order)
  assert.deepEqual([row.from.icon, row.from.badge], ['/tokens/usdc.svg', '/networks/base.svg'])
  assert.deepEqual([row.to.icon, row.to.badge], [PUSD.icon, '/networks/bch.svg'])
  assert.deepEqual(
    row.legs.map(leg => leg.icon),
    ['/networks/base.svg', '/networks/thor.svg', '/networks/bch.svg', '/networks/bch.svg']
  )
  const bnb = rowFromRun(RUNS.find(run => run.amounts.startsWith('0.0062 BNB')))
  assert.deepEqual([bnb.from.icon, bnb.from.badge], ['/networks/bsc.svg', undefined], 'a native coin carries no extra chain mark')
  assert.equal(explorerIcon('https://optimistic.etherscan.io/tx/0x1'), '/networks/op.svg')
  assert.equal(explorerIcon('https://etherscan.io/tx/0x1'), '/networks/eth.svg')
  assert.equal(explorerIcon('https://example.com/tx/1'), undefined)
})

test('scanner lists Router orders first and drops a verified run the feed already has', () => {
  const run = RUNS.find(r => r.router)
  const hash = run.links[0][1].split('/').pop().replace(/^0x/i, '')
  const rows = scanRows([{ ...order, sourceHash: hash }], RUNS)
  assert.equal(rows[0].key, order.ref)
  assert.equal(rows.length, RUNS.length)
  assert.ok(matchesQuery(rows[0], hash.toUpperCase()))
  assert.ok(matchesQuery(rows[0], 'base'))
  assert.equal(matchesQuery(rows[0], 'doge'), false)
})

test('a full hash not in the list gets explorer lookups', () => {
  assert.equal(hashLookups('abc').length, 0)
  assert.equal(hashLookups('ab'.repeat(32)).length, 2)
  assert.equal(hashLookups(`0x${'ab'.repeat(32)}`).length, 1)
})
