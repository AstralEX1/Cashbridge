import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Chain } from '@tcswap/core'
import { register } from 'node:module'
import { Psbt } from 'bitcoinjs-lib'

// The SDK's UTXO toolbox only loads in a bundler; this stand-in hands back the signer it was built with.
const toolbox = 'export const getUtxoToolbox = async (chain, { signer }) => ({ toolboxChain: chain, signer })'
const loader = `export async function resolve(specifier, context, next) {
  if (specifier === '@tcswap/toolboxes/utxo') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(toolbox)}), shortCircuit: true }
  return next(specifier, context)
}`
register(`data:text/javascript,${encodeURIComponent(loader)}`)

// UniSat and Leather as their docs describe them, on a fake window: no extension or network call starts here.
let reloads = 0
globalThis.window = Object.assign(new EventTarget(), { location: { origin: 'http://localhost', reload: () => reloads++ } })
const { leatherWallet, LEATHER, unisatWallet, UNISAT } = await import('../src/lib/bitcoin-wallets.ts')
let added
const connectUnisat = unisatWallet.connectUnisat.connectWallet({
  addChain: wallet => {
    added = wallet
  }
})
const connectLeather = leatherWallet.connectLeather.connectWallet({
  addChain: wallet => {
    added = wallet
  }
})

const P2WPKH = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const P2TR = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'

const unisat = { calls: [], accounts: [P2WPKH], granted: false, chain: 'BITCOIN_MAINNET', listeners: new Set() }
Object.assign(unisat, {
  requestAccounts: async () => (unisat.calls.push('requestAccounts'), unisat.accounts),
  getAccounts: async () => (unisat.calls.push('getAccounts'), unisat.granted ? unisat.accounts : []),
  getChain: async () => ({ enum: unisat.chain }),
  switchChain: async chain => (unisat.calls.push(`switchChain:${chain}`), (unisat.chain = chain)),
  signPsbt: async (hex, options) => (unisat.calls.push(`signPsbt:${JSON.stringify(options)}`), hex),
  on: (_event, listener) => unisat.listeners.add(listener),
  removeListener: (_event, listener) => unisat.listeners.delete(listener)
})
const leather = {
  calls: [],
  addresses: [
    { symbol: 'BTC', type: 'p2wpkh', address: P2WPKH },
    { symbol: 'BTC', type: 'p2tr', address: P2TR },
    { symbol: 'STX', address: 'SP000000000000000000002Q6VF78' }
  ],
  request: async (method, params) => {
    leather.calls.push([method, params])
    if (method === 'getAddresses') return { result: { addresses: leather.addresses } }
    if (method === 'signPsbt') return { result: { hex: params.hex } }
    throw new Error(`unexpected ${method}`)
  }
}
window.unisat = unisat
window.LeatherProvider = leather

// One P2WPKH input and one output: what the toolbox hands a signer.
const psbt = () =>
  new Psbt()
    .addInput({ hash: '00'.repeat(32), index: 0, witnessUtxo: { script: Buffer.from(`0014${'11'.repeat(20)}`, 'hex'), value: 10_000n } })
    .addInput({ hash: '22'.repeat(32), index: 1, witnessUtxo: { script: Buffer.from(`0014${'11'.repeat(20)}`, 'hex'), value: 5_000n } })
    .addOutput({ script: Buffer.from(`0014${'33'.repeat(20)}`, 'hex'), value: 9_000n })

beforeEach(() => {
  added = undefined
  reloads = 0
  unisat.calls = []
  unisat.accounts = [P2WPKH]
  unisat.granted = false
  unisat.chain = 'BITCOIN_MAINNET'
  unisat.listeners.clear()
  leather.calls = []
})

test('UniSat connects its Bitcoin mainnet account and follows account switches', async () => {
  assert.equal(await connectUnisat([Chain.Bitcoin]), true)
  assert.deepEqual(unisat.calls, ['requestAccounts'])
  assert.equal(added.address, P2WPKH)
  assert.equal(added.walletType, UNISAT)
  assert.equal(added.chain, Chain.Bitcoin)
  for (const listener of unisat.listeners) listener([P2TR])
  assert.equal(reloads, 1)
  added.disconnect()
  assert.equal(unisat.listeners.size, 0)
})

test('UniSat on another network is switched to Bitcoin mainnet on connect, and only checked on a restore', async () => {
  unisat.chain = 'FRACTAL_BITCOIN_MAINNET'
  assert.equal(await connectUnisat([Chain.Bitcoin]), true)
  assert.deepEqual(unisat.calls, ['requestAccounts', 'switchChain:BITCOIN_MAINNET'])

  unisat.calls = []
  unisat.chain = 'BITCOIN_TESTNET'
  unisat.granted = true
  await assert.rejects(connectUnisat([Chain.Bitcoin], { restoreOnly: true }), /not on Bitcoin mainnet/)
  assert.deepEqual(unisat.calls, ['getAccounts'])
})

test('a UniSat restore never prompts; Taproot is accepted, nested SegWit is refused with what to do', async () => {
  await assert.rejects(connectUnisat([Chain.Bitcoin], { restoreOnly: true }), /not connected this site/)
  unisat.granted = true
  unisat.accounts = [P2TR]
  assert.equal(await connectUnisat([Chain.Bitcoin], { restoreOnly: true }), true)
  assert.deepEqual(unisat.calls, ['getAccounts', 'getAccounts'])
  unisat.accounts = [P2SH]
  await assert.rejects(connectUnisat([Chain.Bitcoin]), /Native SegWit \(bc1q\) or Taproot/)
})

test('UniSat signs the toolbox PSBT without finalizing it', async () => {
  await connectUnisat([Chain.Bitcoin])
  assert.equal(added.toolboxChain, Chain.Bitcoin)
  assert.equal(await added.signer.getAddress(), P2WPKH)
  const unsigned = psbt()
  const signed = await added.signer.signTransaction(unsigned)
  assert.equal(signed.toHex(), unsigned.toHex())
  assert.deepEqual(unisat.calls, ['requestAccounts', 'signPsbt:{"autoFinalized":false}'])
})

test('Leather connects its Native SegWit payment address and signs every input on mainnet without broadcasting', async () => {
  assert.equal(await connectLeather([Chain.Bitcoin]), true)
  assert.equal(added.address, P2WPKH)
  assert.equal(added.walletType, LEATHER)

  const unsigned = psbt()
  const signed = await added.signer.signTransaction(unsigned)
  assert.equal(signed.toHex(), unsigned.toHex())
  assert.deepEqual(leather.calls.at(-1), ['signPsbt', { hex: unsigned.toHex(), network: 'mainnet', broadcast: false, signAtIndex: [0, 1] }])
})

test('Leather never prompts on a restore and needs a Native SegWit address', async () => {
  await assert.rejects(connectLeather([Chain.Bitcoin], { restoreOnly: true }), /only on request/)
  assert.deepEqual(leather.calls, [])
  const saved = leather.addresses
  leather.addresses = saved.filter(a => a.type !== 'p2wpkh')
  await assert.rejects(connectLeather([Chain.Bitcoin]), /no Native SegWit/)
  leather.addresses = saved
})
