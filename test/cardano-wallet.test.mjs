import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'
import { Chain } from '@tcswap/core'

// Only Mesh's CIP-30 wrapper is replaced: no extension, transaction or network call starts in these tests.
const mesh = {}
globalThis.cardanoWalletTestMesh = mesh
registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@meshsdk/wallet' ? { url: 'cardano-wallet-test:mesh', shortCircuit: true } : next(specifier, context)
  },
  load(url, context, next) {
    return url === 'cardano-wallet-test:mesh'
      ? { format: 'module', source: 'export const BrowserWallet = { enable: id => globalThis.cardanoWalletTestMesh.enable(id) }', shortCircuit: true }
      : next(url, context)
  }
})
globalThis.window = {}
const { laceWallet, LACE } = await import('../src/lib/cardano-wallet.ts')
let added
const connect = laceWallet.connectLace.connectWallet({ addChain: wallet => { added = wallet }, walletType: LACE })
const ADDRESS = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp'

beforeEach(() => {
  added = undefined
  Object.assign(mesh, { enabled: [], networkId: 1 })
  mesh.enable = async id => {
    mesh.enabled.push(id)
    return { getNetworkId: async () => mesh.networkId, getChangeAddress: async () => ADDRESS }
  }
  window.cardano = { lace: { enable: async () => ({}), isEnabled: async () => mesh.granted ?? false } }
  mesh.granted = false
})

test('a CIP-30 wallet connects on mainnet and adds its change address', async () => {
  assert.equal(await connect([Chain.Cardano]), true)
  assert.deepEqual(mesh.enabled, ['lace'])
  assert.equal(added.chain, Chain.Cardano)
  assert.equal(added.walletType, LACE)
  assert.equal(added.address, ADDRESS)
})

test('a restore asks the extension only once this site was granted, so it never prompts', async () => {
  await assert.rejects(connect([Chain.Cardano], { restoreOnly: true }), /has not authorized this site/)
  assert.deepEqual(mesh.enabled, [])
  mesh.granted = true
  assert.equal(await connect([Chain.Cardano], { restoreOnly: true }), true)
  assert.deepEqual(mesh.enabled, ['lace'])
})

test('a wallet on a test network, a missing extension and other chains are refused', async () => {
  mesh.networkId = 0
  await assert.rejects(connect([Chain.Cardano]), /Switch Lace to Cardano mainnet/)
  assert.equal(added, undefined)
  delete window.cardano.lace
  await assert.rejects(connect([Chain.Cardano]), /Lace is not installed/)
  await assert.rejects(connect([Chain.Ethereum]), /only supports Cardano/)
})
