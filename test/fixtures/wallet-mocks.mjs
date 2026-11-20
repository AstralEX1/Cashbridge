// Offline adapters only: these tests cannot connect a real wallet or send a transaction.
import { createElement } from 'react'
import { Chain, WalletOption } from '@tcswap/core'

export const controls = {
  getAccounts: async () => [],
  hasAuthorizedAccount: async () => undefined,
  wallets: new Map(),
  // accountsChanged listeners the store installed, by provider.
  evmListeners: new Map(),
  disconnected: [],
  errors: [],
  account: undefined,
  asset: { chain: Chain.Ethereum, identifier: 'ETH.ETH', ticker: 'ETH', decimals: 18 },
  // Open-networks buy side; defaults to the same fixture asset until a test overrides it.
  assetTo: { chain: Chain.Base, identifier: 'BASE.USDC', ticker: 'USDC', decimals: 6 },
  bch: { state: 'idle', connect() {}, pairAgain() {}, disconnect() {} },
  balance: null,
  loading: false,
  amount: undefined,
  dialogs: [],
  external: false,
  walletState: undefined,
  queryOptions: undefined,
  queryData: undefined
}

export const getAccounts = (...args) => controls.getAccounts(...args)
export const hasAuthorizedAccount = (...args) => controls.hasAuthorizedAccount(...args)
export const getUSwap = () => ({
  getWallet: (provider, chain) => controls.wallets.get(`${provider}:${chain}`),
  getWalletByChain: chain => [...controls.wallets.values()].find(wallet => wallet.chain === chain),
  disconnectChain: chain => controls.disconnected.push(chain),
  disconnectWallet: (provider, chains) => chains.forEach(chain => controls.wallets.delete(`${provider}:${chain}`))
})
export const supportedChains = { METAMASK: [Chain.Ethereum, Chain.Base], EXODUS: [Chain.Bitcoin] }
export const syncBraveAccountWatch = () => {}
export const preloadWalletConnect = () => {}
export const isWalletconnectDismissed = error => String(error?.message).startsWith('wallet_walletconnect_modal_closed')
export const onWalletconnectDisconnect = listener => { controls.walletconnectDisconnect = listener }
export const RESTORE_CHECKED = new Set([WalletOption.METAMASK, WalletOption.RABBY])
export const watchEvmAccounts = (provider, listener) => {
  controls.evmListeners.set(provider, listener)
  return () => controls.evmListeners.delete(provider)
}
export const useConnectedAccount = () => controls.account
export const useDisconnect = () => () => { controls.account = undefined }
export const useHasHydrated = () => true
export const useSetExternalWalletMode = () => enabled => { controls.external = enabled }
export const useWallets = () => controls.walletState
export const useAssetFrom = () => controls.asset
export const useAssetTo = () => controls.assetTo
export const useSwap = () => ({
  setValueFrom: value => { controls.amount = value.toSignificant() },
  valueFrom: { eqValue: () => false }
})
export const useBalance = () => ({ balance: controls.balance, isLoading: controls.loading })
export const useQuote = () => ({ quote: undefined })
export const useBchWallet = () => controls.bch
export const useDialog = () => ({ openDialog: (_component, options) => controls.dialogs.push(options) })
export const ConnectWallet = () => null
export const BrowserWallet = () => null
export const Ledger = () => null
export const Trezor = () => null
export const WalletIcon = () => null
export const Icon = () => null
export const Credenza = ({ children }) => children
export const CredenzaContent = Credenza
export const CredenzaHeader = Credenza
export const CredenzaTitle = Credenza
export const CredenzaDescription = Credenza
export const ScrollArea = Credenza
export const WalletType = { browser: 'browser', hardware: 'hardware', mobile: 'mobile' }
export const describeWalletconnectError = () => undefined
export const ALL_CHAINS = [Chain.Ethereum, Chain.Base, Chain.Bitcoin]
export const COMING_SOON_CHAINS = []
export const chainLabel = chain => ({ [Chain.Ethereum]: 'Ethereum', [Chain.Base]: 'Base', [Chain.Bitcoin]: 'Bitcoin', [Chain.BitcoinCash]: 'Bitcoin Cash' })[chain] ?? chain
export const isWalletAvailable = () => true
export const WALLETS = [{ key: 'rabby', label: 'Rabby Wallet', option: WalletOption.RABBY, type: 'browser', supportedChains: [Chain.Ethereum, Chain.Base] }]
export default function Image({ src, alt }) { return createElement('img', { src, alt }) }
export const Tooltip = ({ children }) => children
export const toast = { error: message => controls.errors.push(message), success() {} }
export const useWizardConnect = () => { throw new Error('A real relay must never start in offline tests') }
export const WizardConnectQRDialog = () => null
export const useQueryClient = () => ({})
export const useQuery = options => {
  controls.queryOptions = options
  return { data: controls.queryData, refetch() {}, isLoading: false, error: null }
}
const labels = {
  'bridge.completion.received': 'Received',
  'bridge.completion.history': 'Transaction history',
  'bridge.completion.bridgeFrom': 'Bridge from {chain}',
  'bridge.completion.receiveOn': 'Receive on {chain}',
  'bridge.completion.swapOnCauldron': 'Swap on Cauldron',
  'bridge.completion.earn': 'Earn {apy}% APY',
  'bridge.completion.provideLiquidity': 'Provide liquidity',
  'bridge.progress.newTransfer': 'New transfer',
  'bridge.progress.close': 'Close',
  'bridge.wallet.connectSource': 'Connect wallet',
  'bridge.wallet.connectDestination': 'Connect BCH wallet',
  'bridge.wallet.connecting': 'Connecting…',
  'swap.balance.useMax': 'Use maximum available balance',
  'wallet.connectedOn': 'Connected on {chain}'
}
export const useTranslations = namespace => (key, values = {}) => (labels[`${namespace}.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)
