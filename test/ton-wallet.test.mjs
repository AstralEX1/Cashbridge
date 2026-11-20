import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'
import { Chain } from '@tcswap/core'

// Only the wallet UI is replaced: no wallet, bridge connection or transaction starts in these tests.
const ui = {}
globalThis.tonWalletTestUI = ui
registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@tonconnect/ui' ? { url: 'ton-wallet-test:ui', shortCircuit: true } : next(specifier, context)
  },
  load(url, context, next) {
    return url === 'ton-wallet-test:ui'
      ? { format: 'module', source: 'export class TonConnectUI { constructor() { return globalThis.tonWalletTestUI } }', shortCircuit: true }
      : next(url, context)
  }
})
globalThis.window = { location: { origin: 'https://cashbridge.example', reload() {} } }
const { tonconnectWallet, TONCONNECT, isTonConnectDismissed } = await import('../src/lib/ton-wallet.ts')
let added
const connect = tonconnectWallet.connectTonConnect.connectWallet({ addChain: wallet => { added = wallet }, walletType: TONCONNECT })
const subscribe = listeners => listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const flush = () => new Promise(resolve => setImmediate(resolve))

beforeEach(() => {
  added = undefined
  Object.assign(ui, {
    account: null,
    connectionRestored: Promise.resolve(true),
    status: new Set(), modal: new Set(), single: new Set(), opened: [],
    openModal: async () => { ui.opened.push('all') },
    openSingleWalletModal: async wallet => { ui.opened.push(wallet) }
  })
  ui.onStatusChange = (listener, onError) => { ui.onError = onError; return subscribe(ui.status)(listener) }
  ui.onModalStateChange = subscribe(ui.modal)
  ui.onSingleWalletModalStateChange = subscribe(ui.single)
})

test('Tonkeeper opens directly and adds its mainnet account only after approval', async () => {
  const pending = connect([Chain.Ton], { tonWallet: 'tonkeeper' })
  await flush()
  assert.deepEqual(ui.opened, ['tonkeeper'])
  assert.equal(added, undefined)
  ui.account = { address: `0:${'1'.repeat(64)}`, chain: '-239' }
  for (const listener of [...ui.status]) listener({ account: ui.account })
  assert.equal(await pending, true)
  assert.equal(added.chain, Chain.Ton)
  assert.equal(added.walletType, TONCONNECT)
  assert.match(added.address, /^UQ/)
  assert.equal(ui.modal.size + ui.single.size, 0)
})

for (const tonWallet of [undefined, 'tonkeeper']) {
  test(`closing ${tonWallet ?? 'the picker'} cancels and removes all temporary listeners`, async () => {
    const pending = connect([Chain.Ton], { tonWallet })
    const rejected = assert.rejects(pending, isTonConnectDismissed)
    await flush()
    assert.deepEqual(ui.opened, [tonWallet ?? 'all'])
    for (const listener of tonWallet ? ui.single : ui.modal) listener({ status: 'closed', closeReason: 'action-cancelled' })
    await rejected
    assert.equal(ui.status.size + ui.modal.size + ui.single.size, 0)
    assert.equal(added, undefined)
  })
}

test('selecting a wallet in the picker keeps waiting; closing its QR cancels', async () => {
  const pending = connect([Chain.Ton])
  const rejected = assert.rejects(pending, isTonConnectDismissed)
  await flush()
  for (const listener of ui.modal) listener({ status: 'closed', closeReason: 'wallet-selected' })
  assert.equal(ui.status.size, 1)
  for (const listener of ui.single) listener({ status: 'closed', closeReason: 'action-cancelled' })
  await rejected
  assert.equal(ui.status.size + ui.modal.size + ui.single.size, 0)
})

test('a failed modal open rejects the connection and removes its listeners', async () => {
  ui.openSingleWalletModal = async () => { throw new Error('Wallet list unavailable') }
  await assert.rejects(connect([Chain.Ton], { tonWallet: 'tonkeeper' }), /Wallet list unavailable/)
  assert.equal(ui.status.size + ui.modal.size + ui.single.size, 0)
})

test('restoration never opens a wallet prompt; other chains are refused', async () => {
  await assert.rejects(connect([Chain.Ton], { restoreOnly: true, tonWallet: 'tonkeeper' }), /No TON Connect session/)
  await assert.rejects(connect([Chain.Ethereum], { tonWallet: 'tonkeeper' }), /only supports TON/)
  assert.deepEqual(ui.opened, [])
})


test('the manifest matches the site origin, including www and preview deployments', async () => {
  const { GET } = await import('../src/app/tonconnect-manifest.json/route.ts')
  for (const origin of ['https://www.cashbridge.space', 'https://cashbridge.space', 'https://cashbridge-preview.vercel.app']) {
    const response = GET(new Request(`${origin}/tonconnect-manifest.json`))
    const manifest = await response.json()
    assert.equal(manifest.url, origin)
    assert.equal(manifest.iconUrl, `${origin}/tonconnect-icon.png`)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  }
})
