// Run: node --no-warnings --import ./test/register-ts-alias.mjs --test test/wallets.test.mjs
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { register } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Chain, USwapNumber, WalletOption } from '@tcswap/core'
import { controls } from './fixtures/wallet-mocks.mjs'

register('./fixtures/wallet-test-loader.mjs', import.meta.url)

const local = new Map()
const tab = new Map()
const cookies = new Map()
const storageFor = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) })
globalThis.window = { localStorage: storageFor(local), sessionStorage: storageFor(tab), location: { hostname: 'localhost', protocol: 'http:' }, addEventListener() {} }
globalThis.localStorage = window.localStorage
globalThis.document = {
  addEventListener() {},
  get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
  set cookie(value) {
    const [entry] = value.split(';')
    const separator = entry.indexOf('=')
    const key = entry.slice(0, separator)
    if (value.includes('Max-Age=0')) cookies.delete(key)
    else cookies.set(key, entry.slice(separator + 1))
  }
}

const { useWalletStore, connectedAccount, accountForChain } = await import('../src/store/wallets-store.ts')
const { SESSION_KEY, clearBchSession, migrateLegacyBchSession } = await import('../src/components/bch-wallet.tsx')
const { BridgeWalletBadge } = await import('../src/components/swap/bridge-wallet-badge.tsx')
const { BridgeCompletion } = await import('../src/components/swap/bridge-completion.tsx')
const { PUSD_TOKEN } = await import('../src/lib/cauldron-tokens.ts')
const { SwapBalance } = await import('../src/components/swap/swap-balance.tsx')
const { useBalance } = await import('../src/hooks/use-balance.ts')
const { ConnectWallet } = await import('../src/components/connect-wallet/connect-wallet.tsx')
const account = (address = '0x1111111111111111111111111111111111111111', network = Chain.Ethereum, provider = WalletOption.METAMASK) => ({ address, network, provider })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const render = (Component, props) => {
  let tree
  const html = renderToStaticMarkup(createElement(() => {
    tree = Component(props)
    return tree
  }))
  return { tree, html }
}
const findElement = (node, predicate) => {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map(child => findElement(child, predicate)).find(Boolean)
  return predicate(node) ? node : findElement(node.props?.children, predicate)
}

beforeEach(() => {
  local.clear(); tab.clear(); cookies.clear()
  controls.getAccounts = async () => []
  controls.hasAuthorizedAccount = async () => undefined
  controls.wallets.clear()
  controls.disconnected = []
  controls.errors = []
  controls.account = undefined
  controls.bch = { state: 'idle', connect() {}, pairAgain() {}, disconnect() {} }
  controls.balance = null
  controls.loading = false
  controls.amount = undefined
  controls.dialogs = []
  controls.walletState = undefined
  controls.queryData = undefined
  useWalletStore.setState({ accounts: [], selected: undefined, connectedWallets: [], hasHydrated: true, externalWalletMode: false })
})

test('free-pair source and destination resolve independently from connected accounts', () => {
  const source = account('0xsource', Chain.Ethereum)
  const destination = account('0xdestination', Chain.Base)
  const state = { accounts: [source, destination], selected: source }
  assert.equal((accountForChain ?? connectedAccount)(state, Chain.Base), destination)
  assert.equal((accountForChain ?? connectedAccount)(state, Chain.Ethereum), source)
  assert.equal(connectedAccount(state), source, 'bridge mode still uses the selected wallet')
})

test('the completion receipt links each transaction and puts the live Earn button under Received', () => {
  let closed = 0
  controls.queryData = 8.597885945977747
  const txs = [
    { key: 'send', kind: 'bridgeFrom', chain: Chain.Base, hash: `0x${'a'.repeat(64)}` },
    { key: 'receive', kind: 'receiveOn', chain: Chain.BitcoinCash, hash: 'b'.repeat(64) },
    { key: 'swap', kind: 'swapOnCauldron', chain: Chain.BitcoinCash, hash: 'c'.repeat(64) }
  ]
  const { tree, html } = render(BridgeCompletion, {
    received: { amount: '1.01', ticker: 'PUSD', icon: createElement('img', { src: '/tokens/pusd.svg', alt: '' }) },
    transactions: txs, liquidityCategory: PUSD_TOKEN.category, onClose: () => { closed++ }
  })
  assert.match(html, /Received/)
  assert.match(html, /1\.01 PUSD/)
  assert.match(html, /Earn 8\.60% APY/)
  assert.ok(html.indexOf('Earn 8.60% APY') < html.indexOf('Transaction history'))
  assert.match(html, /Bridge from Base/)
  assert.match(html, /Receive on Bitcoin Cash/)
  assert.match(html, /Swap on Cauldron/)
  for (const tx of txs) {
    assert.ok(html.includes(`title="${tx.hash}"`))
    assert.ok(!html.includes(`>${tx.hash}<`), 'hashes are available on hover, not repeated in rows')
  }
  assert.ok(html.includes(`https://app.cauldron.quest/add/${PUSD_TOKEN.category}`))
  assert.doesNotMatch(html, /Completed|View all transfers|Sent to wallet|Put your/)
  findElement(tree, node => node.props?.children === 'New transfer').props.onClick()
  assert.equal(closed, 1)
})

test('Earn falls back without a rate, uses the category over the ticker, and is absent for EVM receipts', () => {
  const category = 'a'.repeat(64)
  const props = { received: { amount: '0.000001', ticker: 'ETH', icon: null }, transactions: [], onClose() {} }
  assert.doesNotMatch(render(BridgeCompletion, props).html, /Provide liquidity|Earn|app\.cauldron/)
  const fallback = render(BridgeCompletion, { ...props, liquidityCategory: category }).html
  assert.match(fallback, /Provide liquidity/)
  assert.ok(fallback.includes(`/add/${category}`))
  assert.doesNotMatch(fallback, /n%|NaN|Earn/)
  controls.queryData = 0
  assert.match(render(BridgeCompletion, { ...props, liquidityCategory: category }).html, /Earn 0\.00% APY/)
})

test('a rejected or empty connection rejects the caller instead of reporting success', async () => {
  let succeeded = false
  controls.getAccounts = async () => { throw new Error('User rejected connection') }
  await assert.rejects(useWalletStore.getState().connect(WalletOption.METAMASK, [Chain.Ethereum]).then(() => { succeeded = true }), /User rejected/)
  assert.equal(succeeded, false)
  controls.getAccounts = async () => []
  await assert.rejects(useWalletStore.getState().connect(WalletOption.METAMASK, [Chain.Ethereum]), /Failed to get addresses/)
  assert.equal(connectedAccount(useWalletStore.getState()), undefined)
})

test('a successful connection immediately selects its account and a replacement updates the address', async () => {
  useWalletStore.setState({ externalWalletMode: true })
  const first = account()
  controls.getAccounts = async () => [first]
  await useWalletStore.getState().connect(first.provider, [first.network])
  assert.deepEqual(connectedAccount(useWalletStore.getState()), first)
  assert.equal(useWalletStore.getState().externalWalletMode, false)
  const replacement = account('0x2222222222222222222222222222222222222222')
  controls.getAccounts = async () => [replacement]
  await useWalletStore.getState().connect(first.provider, [first.network])
  assert.deepEqual(connectedAccount(useWalletStore.getState()), replacement)
  assert.equal(useWalletStore.getState().accounts.length, 1)
})

test('selecting an already connected Rabby account exits legacy no-wallet mode without reconnecting', () => {
  const base = account('0x2222222222222222222222222222222222222222', Chain.Base, WalletOption.RABBY)
  useWalletStore.setState({ accounts: [base], selected: base, externalWalletMode: true })
  controls.walletState = useWalletStore.getState()
  let reconnected = false
  controls.getAccounts = async () => { reconnected = true; return [] }
  let closed = false
  const { tree, html } = render(ConnectWallet, { isOpen: true, chain: Chain.Base, onOpenChange: open => { closed = !open } })
  assert.match(html, /Rabby Wallet<\/span><span class="connect-wallet-status connect-wallet-connected">connected</)
  const row = findElement(tree, element => element.type === 'button' && element.props?.className?.includes('connect-wallet-row'))
  assert.equal(row.props['aria-busy'], false)
  row.props.onClick()
  assert.equal(closed, true)
  assert.equal(reconnected, false)
  assert.equal(useWalletStore.getState().externalWalletMode, false)
  assert.deepEqual(connectedAccount(useWalletStore.getState()), base)
})

test('Rabby connected on Base is not reported as connected on Bitcoin', () => {
  controls.walletState = { accounts: [account(undefined, Chain.Base, WalletOption.RABBY)], select() {} }
  // Rabby has no Bitcoin account, so the Bitcoin dialog neither offers it nor shows anything connected.
  const bitcoin = render(ConnectWallet, { isOpen: true, chain: Chain.Bitcoin, onOpenChange() {} }).html
  assert.doesNotMatch(bitcoin, /connect-wallet-connected/)
  assert.doesNotMatch(bitcoin, /Rabby Wallet/)
  // On another chain it does support, the Base account does not count either: it is only detected.
  const ethereum = render(ConnectWallet, { isOpen: true, chain: Chain.Ethereum, onOpenChange() {} }).html
  assert.doesNotMatch(ethereum, /connect-wallet-connected/)
  assert.match(ethereum, /Rabby Wallet<\/span><span class="connect-wallet-status">.*detected</)
})

test('disconnect clears the selected address and ignores an older in-flight connection', async () => {
  const pending = deferred()
  controls.getAccounts = () => pending.promise
  const connect = useWalletStore.getState().connect(WalletOption.METAMASK, [Chain.Ethereum])
  useWalletStore.getState().disconnect(WalletOption.METAMASK)
  pending.resolve([account()])
  await connect
  assert.equal(connectedAccount(useWalletStore.getState()), undefined)
  assert.deepEqual(useWalletStore.getState().accounts, [])
})

test('a newer connection wins when async replies arrive out of order', async () => {
  const older = deferred()
  controls.getAccounts = () => older.promise
  const first = useWalletStore.getState().connect(WalletOption.METAMASK, [Chain.Ethereum])
  const latest = account('0x2222222222222222222222222222222222222222')
  controls.getAccounts = async () => [latest]
  await useWalletStore.getState().connect(WalletOption.METAMASK, [Chain.Ethereum])
  older.resolve([account()])
  await first
  assert.deepEqual(connectedAccount(useWalletStore.getState()), latest)
})

test('restoring a session preserves the selected account and never revives an explicitly disconnected wallet', async () => {
  useWalletStore.setState({ hasHydrated: false })
  const restored = account()
  local.set('tc-wallet-store', JSON.stringify({ state: { selected: restored }, version: 1 }))
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify([{ provider: restored.provider, chains: [restored.network] }])))
  controls.getAccounts = async () => [restored]
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(connectedAccount(useWalletStore.getState()), restored)

  const pending = deferred()
  controls.getAccounts = () => pending.promise
  await useWalletStore.persist.rehydrate()
  useWalletStore.getState().disconnect(restored.provider)
  pending.resolve([restored])
  await flush()
  assert.equal(useWalletStore.getState().selected, undefined)
  assert.deepEqual(useWalletStore.getState().accounts, [])
})

test('a failed session restore finishes hydration without claiming the saved address is connected', async () => {
  useWalletStore.setState({ hasHydrated: false })
  local.set('tc-wallet-store', JSON.stringify({ state: { selected: account() }, version: 1 }))
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify([{ provider: WalletOption.METAMASK, chains: [Chain.Ethereum] }])))
  controls.getAccounts = async () => { throw new Error('Wallet unavailable') }
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.equal(useWalletStore.getState().hasHydrated, true)
  assert.equal(connectedAccount(useWalletStore.getState()), undefined)
})

const savedLink = () => JSON.parse(decodeURIComponent(cookies.get('tc-wallet-link') ?? '%5B%5D'))

test('a failed restore keeps the saved wallet until it is explicitly disconnected', async () => {
  useWalletStore.setState({ hasHydrated: false })
  const link = [{ provider: WalletOption.METAMASK, chains: [Chain.Ethereum, Chain.Base] }]
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify(link)))
  controls.getAccounts = async () => { throw new Error('Wallet unavailable') }
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.equal(useWalletStore.getState().hasHydrated, true)
  assert.deepEqual(savedLink(), link)

  useWalletStore.getState().disconnect(WalletOption.METAMASK)
  assert.equal(cookies.has('tc-wallet-link'), false)
})

test('a partial restore keeps the chains that did not come back, and a newer connect replaces the entry', async () => {
  useWalletStore.setState({ hasHydrated: false })
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify([{ provider: WalletOption.METAMASK, chains: [Chain.Ethereum, Chain.Base] }])))
  const ethereum = account()
  controls.getAccounts = async () => [ethereum]
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [ethereum])
  assert.deepEqual(savedLink(), [{ provider: WalletOption.METAMASK, chains: [Chain.Ethereum, Chain.Base] }])

  await useWalletStore.getState().connect(WalletOption.METAMASK, [Chain.Ethereum])
  assert.deepEqual(savedLink(), [{ provider: WalletOption.METAMASK, chains: [Chain.Ethereum] }])
})

test('a saved WalletConnect wallet restores from its stored session only, and is forgotten once none is left', async () => {
  useWalletStore.setState({ hasHydrated: false })
  const link = [{ provider: WalletOption.WALLETCONNECT, chains: [Chain.Base] }]
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify(link)))
  const restored = account('0x4444444444444444444444444444444444444444', Chain.Base, WalletOption.WALLETCONNECT)
  controls.wallets.set(`${WalletOption.WALLETCONNECT}:${Chain.Base}`, { chain: Chain.Base, walletType: WalletOption.WALLETCONNECT })
  const configs = []
  controls.getAccounts = async (_provider, _chains, config) => { configs.push(config); return [restored] }
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(configs, [{ restoreOnly: true }])
  assert.deepEqual(useWalletStore.getState().accounts, [restored])
  assert.deepEqual(savedLink(), link)

  // The phone ended the session while the page was closed: no QR code on load, and no retry on every visit.
  useWalletStore.setState({ accounts: [], hasHydrated: false })
  controls.getAccounts = async () => { throw new Error('wallet_walletconnect_connection_not_established') }
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [])
  assert.deepEqual(savedLink(), [])
})

test('the phone ending a WalletConnect session drops its accounts and leaves the other wallets connected', () => {
  const metamask = account()
  const phone = account('0x4444444444444444444444444444444444444444', Chain.Base, WalletOption.WALLETCONNECT)
  controls.wallets.set(`${WalletOption.METAMASK}:${Chain.Ethereum}`, { chain: Chain.Ethereum, walletType: WalletOption.METAMASK })
  controls.wallets.set(`${WalletOption.WALLETCONNECT}:${Chain.Base}`, { chain: Chain.Base, walletType: WalletOption.WALLETCONNECT })
  useWalletStore.setState({ accounts: [metamask, phone], selected: phone, connectedWallets: [WalletOption.METAMASK, WalletOption.WALLETCONNECT] })

  controls.walletconnectDisconnect([Chain.Base])
  const state = useWalletStore.getState()
  assert.deepEqual(state.accounts, [metamask])
  assert.deepEqual(state.connectedWallets, [WalletOption.METAMASK])
  assert.equal(state.selected, undefined)
  assert.deepEqual(savedLink(), [{ provider: WalletOption.METAMASK, chains: [Chain.Ethereum] }])
})

test('closing the WalletConnect QR window is a cancel, and its SDK errors reach the user in words', async () => {
  controls.getAccounts = async () => { throw new Error('wallet_walletconnect_modal_closed') }
  await assert.rejects(useWalletStore.getState().connect(WalletOption.WALLETCONNECT, [Chain.Base]))
  assert.deepEqual(controls.errors, [])

  controls.getAccounts = async () => { throw new Error('wallet_walletconnect_chain_not_supported') }
  const describeError = error => (error.message.startsWith('wallet_walletconnect_chain_not_supported') ? 'No chains approved' : undefined)
  await assert.rejects(useWalletStore.getState().connect(WalletOption.WALLETCONNECT, [Chain.Base], undefined, { describeError }))
  assert.deepEqual(controls.errors, ['No chains approved'])
})

test('a locked or unauthorized wallet (empty eth_accounts) is not reconnected on load and stays saved', async () => {
  useWalletStore.setState({ hasHydrated: false })
  const link = [{ provider: WalletOption.RABBY, chains: [Chain.Base] }]
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify(link)))
  const checked = []
  controls.hasAuthorizedAccount = async (provider, chains) => { checked.push([provider, chains]); return false }
  let connectCalls = 0
  controls.getAccounts = async () => { connectCalls++; return [] }
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(checked, [[WalletOption.RABBY, [Chain.Base]]])
  assert.equal(connectCalls, 0)
  assert.equal(useWalletStore.getState().hasHydrated, true)
  assert.deepEqual(useWalletStore.getState().accounts, [])
  assert.deepEqual(savedLink(), link)
})

test('an authorized wallet (eth_accounts has an account) restores through the normal connect path', async () => {
  useWalletStore.setState({ hasHydrated: false })
  const restored = account('0x3333333333333333333333333333333333333333', Chain.Base, WalletOption.RABBY)
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify([{ provider: WalletOption.RABBY, chains: [Chain.Base] }])))
  controls.hasAuthorizedAccount = async () => true
  controls.getAccounts = async () => [restored]
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [restored])
  assert.deepEqual(savedLink(), [{ provider: WalletOption.RABBY, chains: [Chain.Base] }])
})

test('a saved browser wallet follows the extension: unlock restores it, a switch moves to the new account, a lock parks it', async () => {
  useWalletStore.setState({ hasHydrated: false })
  const link = [{ provider: WalletOption.RABBY, chains: [Chain.Base] }]
  cookies.set('tc-wallet-link', encodeURIComponent(JSON.stringify(link)))
  controls.hasAuthorizedAccount = async () => false
  await useWalletStore.persist.rehydrate()
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [])

  const first = account('0x3333333333333333333333333333333333333333', Chain.Base, WalletOption.RABBY)
  const quietCalls = []
  controls.getAccounts = async (provider, chains) => { quietCalls.push(chains); return [first] }
  controls.evmListeners.get(WalletOption.RABBY)([first.address])
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [first])
  assert.deepEqual(quietCalls, [[Chain.Base]])

  // The same account again (a repeat event) is a no-op.
  controls.evmListeners.get(WalletOption.RABBY)([first.address.toUpperCase().replace('0X', '0x')])
  await flush()
  assert.equal(quietCalls.length, 1)

  const second = account('0x4444444444444444444444444444444444444444', Chain.Base, WalletOption.RABBY)
  controls.getAccounts = async () => [second]
  controls.evmListeners.get(WalletOption.RABBY)([second.address])
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [second])

  controls.evmListeners.get(WalletOption.RABBY)([])
  await flush()
  assert.deepEqual(useWalletStore.getState().accounts, [])
  assert.deepEqual(savedLink(), link)
  assert.ok(controls.evmListeners.has(WalletOption.RABBY), 'a parked wallet stays watched for its unlock')

  useWalletStore.getState().disconnect(WalletOption.RABBY)
  assert.equal(cookies.has('tc-wallet-link'), false)
})

test('the BCH session lives under the WizardConnect default key in localStorage and clears on disconnect', () => {
  assert.equal(SESSION_KEY, 'wizardconnect-session')
  local.set(SESSION_KEY, 'fixture-session')
  clearBchSession()
  assert.equal(local.has(SESSION_KEY), false)
})

test('an old BCH session moves to the default key, from either storage, and every old copy is dropped', () => {
  local.set('tc-bch-wizardconnect', 'old-session')
  local.set('tc-bch-wizardconnect-reconnect', 'ended-session')
  tab.set('tc-bch-wizardconnect', 'old-tab-session')
  migrateLegacyBchSession()
  assert.equal(local.get(SESSION_KEY), 'old-session')
  for (const key of ['tc-bch-wizardconnect', 'tc-bch-wizardconnect-reconnect']) {
    assert.equal(local.has(key), false)
    assert.equal(tab.has(key), false)
  }

  local.delete(SESSION_KEY)
  tab.set('tc-bch-wizardconnect', 'old-tab-session')
  migrateLegacyBchSession()
  assert.equal(local.get(SESSION_KEY), 'old-tab-session')
  assert.equal(tab.has('tc-bch-wizardconnect'), false)
  local.delete(SESSION_KEY)
})

test('a session the wallet ended is not resurrected from the old backup copy', () => {
  local.set('tc-bch-wizardconnect-reconnect', 'ended-session')
  migrateLegacyBchSession()
  assert.equal(local.has(SESSION_KEY), false)
  assert.equal(local.has('tc-bch-wizardconnect-reconnect'), false)
})

test('an existing default session is kept over an old copy', () => {
  local.set(SESSION_KEY, 'current-session')
  local.set('tc-bch-wizardconnect', 'old-session')
  migrateLegacyBchSession()
  assert.equal(local.get(SESSION_KEY), 'current-session')
  assert.equal(local.has('tc-bch-wizardconnect'), false)
  local.delete(SESSION_KEY)
})

test('BCH session migration and clearing do not throw when storage is blocked', () => {
  const saved = window.localStorage
  window.localStorage = { getItem() { throw new Error('Storage blocked') }, setItem() { throw new Error('Storage blocked') }, removeItem() { throw new Error('Storage blocked') } }
  try {
    tab.set('tc-bch-wizardconnect', 'old-tab-session')
    assert.doesNotThrow(() => migrateLegacyBchSession())
    assert.doesNotThrow(() => clearBchSession())
  } finally {
    window.localStorage = saved
    tab.clear()
  }
})

test('the source badge shows a connect action while disconnected and a short address with actions after connection', () => {
  const disconnected = render(BridgeWalletBadge, { kind: 'other' })
  assert.match(disconnected.html, /Connect wallet/)
  disconnected.tree.props.onClick()
  assert.deepEqual(controls.dialogs, [{ chain: Chain.Ethereum }])
  controls.account = account()
  const connected = render(BridgeWalletBadge, { kind: 'other' })
  assert.match(connected.html, /0x1111…1111/)
  assert.match(connected.html, /<img[^>]+src="\/networks\/eth\.svg"/)
  assert.match(connected.html, /Copy|copy/)
  assert.match(connected.html, /etherscan.io/)
  assert.doesNotMatch(connected.html, /Connect wallet/)
})

test('a remembered BCH address is never shown as connected and a stalled reconnect offers a fresh pairing', () => {
  let paired = false
  controls.bch = { state: 'reconnecting', remembered: { cashAddress: 'bitcoincash:qfixture' }, reconnectStalled: true, pairAgain() { paired = true } }
  const { tree, html } = render(BridgeWalletBadge, { kind: 'bch' })
  assert.match(html, /Connect BCH wallet/)
  assert.doesNotMatch(html, /bridge-wallet-dot|qfixture/)
  assert.equal(tree.props.disabled, false)
  tree.props.onClick()
  assert.equal(paired, true)
})

test('the maximum balance button inserts spendable funds rather than the total before gas', () => {
  controls.balance = { total: new USwapNumber('101'), spendable: new USwapNumber('100.61') }
  const { tree, html } = render(SwapBalance)
  assert.match(html, /100\.61/)
  const button = tree.props.children
  button.props.onClick()
  assert.equal(controls.amount, '100.61')
  controls.balance.spendable = new USwapNumber('0.00000001')
  render(SwapBalance).tree.props.children.props.onClick()
  assert.equal(controls.amount, '0.00000001')
  controls.balance.spendable = new USwapNumber(0)
  assert.equal(render(SwapBalance).tree.props.children.props.disabled, true)
})

test('disconnecting one provider keeps another provider on the same chain usable', () => {
  const first = account()
  const other = account('0x2222222222222222222222222222222222222222', Chain.Ethereum, WalletOption.RABBY)
  useWalletStore.setState({ accounts: [first, other], selected: first, connectedWallets: [first.provider, other.provider] })
  controls.wallets.set(`${other.provider}:${other.network}`, { chain: other.network, walletType: other.provider })
  useWalletStore.getState().disconnect(first.provider)
  assert.deepEqual(connectedAccount(useWalletStore.getState()), other)
  assert.deepEqual(controls.disconnected, [])
})

test('the BCH badge shows the connected destination and removes the connect action', () => {
  controls.bch = { state: 'connected', binding: { cashAddress: 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a' } }
  const { html } = render(BridgeWalletBadge, { kind: 'bch' })
  assert.match(html, /<img[^>]+src="\/networks\/bch\.svg"/)
  assert.match(html, /qpm2qs…dx6a/)
  assert.doesNotMatch(html, /Connect BCH wallet/)
})

test('balances are scoped to the account address and cached funds disappear immediately on disconnect', () => {
  const balance = () => {
    let result
    render(() => { result = useBalance(); return null })
    return result
  }
  controls.account = account()
  balance()
  const firstKey = controls.queryOptions.queryKey
  controls.account = account('0x2222222222222222222222222222222222222222')
  balance()
  assert.notDeepEqual(controls.queryOptions.queryKey, firstKey)
  controls.queryData = { total: new USwapNumber('101'), spendable: new USwapNumber('100.61') }
  controls.account = undefined
  assert.equal(balance().balance, null)
  assert.equal(controls.queryOptions.enabled, false)
})

test('EVM calls switch the wallet to the transaction\'s chain first', async () => {
  // The SDK wraps every toolbox call this app makes (approve, call, sendTransaction, ...) with a
  // network switch; this keeps that true across SDK updates.
  const { prepareNetworkSwitch } = await import('@tcswap/helpers')
  let chainId = 1n
  const switched = []
  const provider = {
    getNetwork: async () => ({ chainId }),
    request: async ({ method, params }) => {
      if (method === 'wallet_switchEthereumChain') (switched.push(params[0].chainId), (chainId = BigInt(params[0].chainId)))
      return null
    }
  }
  provider.send = (method, params) => provider.request({ method, params })
  const toolbox = { approve: async () => chainId, sendTransaction: async () => chainId }
  const wallet = prepareNetworkSwitch({ chain: Chain.Base, provider, toolbox, networkParams: { chainId: '0x2105' } })
  assert.equal(await wallet.approve({}), 8453n)
  assert.equal(await wallet.sendTransaction({}), 8453n)
  assert.deepEqual(switched, ['0x2105'])
})

test('on a phone MetaMask opens this page in its app, keeping the path and query', async () => {
  const { isMobileBrowser, metaMaskAppLink } = await import('../src/lib/metamask-link.ts')
  assert.equal(metaMaskAppLink({ host: 'www.cashbridge.space', pathname: '/sell-base.usdc-buy-bch.bch', search: '?amount=5' }), 'https://metamask.app.link/dapp/www.cashbridge.space/sell-base.usdc-buy-bch.bch?amount=5')
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const as = (userAgent, maxTouchPoints = 0) => {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent, maxTouchPoints }, configurable: true })
    return isMobileBrowser()
  }
  try {
    assert.equal(as('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true)
    assert.equal(as('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), true)
    assert.equal(as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true)
    assert.equal(as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), false)
    assert.equal(as('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false)
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real)
    else delete globalThis.navigator
  }
})
