import { Chain, EVMChain, EVMChains, getEIP6963Provider, getEIP6963Wallets, getMetaMaskProvider, RABBY_RDNS, USwap, WalletOption } from '@tcswap/core'
import { EVMPlugin } from '@tcswap/plugins/evm'
import { HoudiniPlugin } from '@tcswap/plugins/houdini'
import { SolanaPlugin } from '@tcswap/plugins/solana'
import { MayachainPlugin, ThorchainPlugin } from '@tcswap/plugins/thorchain'
import { NearPlugin } from '@tcswap/plugins/near'
import { ShapeShiftPlugin } from '@/lib/shapeshift-plugin'
import { bitgetWallet } from '@tcswap/wallets/bitget'
import { braveWallet, getBraveEVMProvider, getBraveSolanaProvider, watchBraveAccounts } from '@tcswap/wallets/brave'
import { cosmostationWallet } from '@tcswap/wallets/cosmostation'
import { evmWallet } from '@tcswap/wallets/evm-extensions'
import { exodusWallet } from '@tcswap/wallets/exodus'
import { keplrWallet } from '@tcswap/wallets/keplr'
import { ledgerWallet } from '@tcswap/wallets/ledger'
import { okxWallet } from '@tcswap/wallets/okx'
import { onekeyWallet } from '@tcswap/wallets/onekey'
import { phantomWallet } from '@tcswap/wallets/phantom'
import { trezorWallet } from '@tcswap/wallets/trezor'
import { tronlinkWallet } from '@/lib/tronlink'
import { LEATHER, leatherWallet, UNISAT, unisatWallet } from '@/lib/bitcoin-wallets'
import { ETERNL, eternlWallet, LACE, laceWallet, YOROI, yoroiWallet } from '@/lib/cardano-wallet'
import { NEARCONNECT, nearconnectWallet } from '@/lib/near-connect-wallet'
import { BACKPACK, SOLANA_WALLET_NAMES, solanaStandardWallet, SOLFLARE } from '@/lib/solana-wallet'
import { NIGHTLY, SLUSH, SUI_WALLETS, SUIET, suiWallet } from '@/lib/sui-wallet'
import { TONCONNECT, tonconnectWallet } from '@/lib/ton-wallet'
import { vultisigWallet } from '@tcswap/wallets/vultisig'
import { preloadWalletconnect, walletconnectWallet } from '@tcswap/wallets/walletconnect'
export { isWalletconnectDismissed, onWalletconnectDisconnect } from '@tcswap/wallets/walletconnect'
import { AppConfig, aggregatorApiUrl, BridgeConfig } from '@/config'
import { EVM_RPC_URLS, OTHER_RPC_URLS } from '@/lib/endpoints'
import { useWalletStore } from '@/store/wallets-store'
import { BTC_PURPOSE_ADDRESS_TYPE, btcAddressType } from '@/lib/swap-helpers'

const defaultPlugins = {
  ...EVMPlugin,
  ...HoudiniPlugin,
  ...MayachainPlugin,
  ...ThorchainPlugin,
  ...SolanaPlugin,
  // A NEAR Intents route's deposit: a plain transfer to the quote's one-use address (src/lib/near-intents.ts).
  ...NearPlugin,
  ...ShapeShiftPlugin
}

// Sui, TON and Cardano have no browser-wallet connector in the SDK; ours send the NEAR Intents deposit. The SDK's NEAR
// one is built on the deprecated Wallet Selector, so NEAR wallets connect through NEAR Connect. Solana wallets without
// an SDK connector sign through the Wallet Standard (src/lib/solana-wallet.ts).
const defaultWallets = {
  ...bitgetWallet,
  ...braveWallet,
  ...cosmostationWallet,
  ...eternlWallet,
  ...evmWallet,
  ...exodusWallet,
  ...keplrWallet,
  ...laceWallet,
  ...leatherWallet,
  ...ledgerWallet,
  ...nearconnectWallet,
  ...okxWallet,
  ...onekeyWallet,
  ...phantomWallet,
  ...solanaStandardWallet,
  ...suiWallet,
  ...tonconnectWallet,
  ...trezorWallet,
  ...tronlinkWallet,
  ...unisatWallet,
  ...vultisigWallet,
  ...walletconnectWallet,
  ...yoroiWallet
}

function createUSwap(config: Parameters<typeof USwap>[0] = {}) {
  return USwap({
    ...config,
    plugins: defaultPlugins,
    wallets: defaultWallets,
    getActiveWallet: () => useWalletStore.getState().selected?.provider
  })
}

let instance: ReturnType<typeof createUSwap> | undefined = undefined

// The UTXO toolbox talks Blockchair's URL dialect, which our own route (src/app/api/blockchair) answers from
// keyless public explorers, so there is no Blockchair account or key. The SDK's request client builds a
// `new URL(...)`, so this has to be absolute.
export function blockchairProxyUrl() {
  const origin = typeof window === 'undefined' ? AppConfig.baseUrl : window.location.origin
  return `${origin}/api/blockchair`
}

// Solana has no free endpoint a browser can use: api.mainnet-beta.solana.com 403s anything sending
// an `Origin` header, and publicnode blocks the token-account call half of a balance needs. So the
// toolbox talks to our own proxy (src/app/api/solana) instead, the same arrangement the UTXO route has.
function solanaProxyUrl() {
  const origin = typeof window === 'undefined' ? AppConfig.baseUrl : window.location.origin
  return `${origin}/api/solana`
}

// Trezor Connect requires a manifest (contact email + app URL) before it will open its popup.
const trezorManifest = {
  email: AppConfig.supportEmail,
  appUrl: AppConfig.baseUrl,
  appName: AppConfig.appName
}

export function getUSwap() {
  if (instance) return instance

  instance = createUSwap({
    config: {
      apiKeys: {
        blockchair: 'sto', // fake key to just avoid logs like: No Blockchair API key found
        walletConnectProjectId: BridgeConfig.walletConnectProjectId
      },
      // The SDK probes these in order and keeps the first that answers for two minutes (src/lib/endpoints.ts).
      rpcUrls: { ...EVM_RPC_URLS, ...OTHER_RPC_URLS, [Chain.Solana]: [solanaProxyUrl()] },
      integrations: {
        trezor: trezorManifest
      },
      envs: {
        apiUrl: aggregatorApiUrl(),
        blockchairApiUrl: blockchairProxyUrl(),
        memolessApiUrl: process.env.NEXT_PUBLIC_MEMOLESS_API
      }
    }
  })

  return instance
}

const STANDARD_CHAINS = [
  [Chain.Sui, SUI_WALLETS, 'connectSuiWallet'],
  [Chain.Solana, SOLANA_WALLET_NAMES, 'connectSolanaWallet']
] as const

export async function connectWallet(option: WalletOption, chains: Chain[], config?: any): Promise<boolean> {
  const uSwap = getUSwap()

  // Sui, and Solana in wallets the SDK has no Solana connector for, go through the Wallet Standard; a multi-chain
  // wallet's other chains through its own connector. One after the other, so a wallet shows one prompt at a time.
  for (const [chain, names, connect] of STANDARD_CHAINS) {
    if (!chains.includes(chain) || !names[option]) continue
    const others = chains.filter(c => c !== chain)
    const own = uSwap[connect]([chain], { walletType: option, restoreOnly: config?.restoreOnly })
    if (others.length === 0) return own
    const ownConnected = await own.catch(error => (console.warn(`Failed to connect to ${chain}:`, error), false))
    return (await connectWallet(option, others, config)) || ownConnected
  }

  const connectEach = async (connect: (chain: Chain[]) => Promise<boolean>) => {
    let successCount = 0
    for (const chain of chains) {
      try {
        await connect([chain])
        successCount++
      } catch (error) {
        console.warn(`Failed to connect to ${chain}:`, error)
      }
    }

    return successCount > 0
  }

  switch (option) {
    case WalletOption.METAMASK:
      const metamask = getMetaMaskProvider()
      if (!metamask) throw new Error('MetaMask not found. Install or enable the MetaMask extension.')
      return connectEach(c => uSwap.connectEVMWallet(c, WalletOption.METAMASK, metamask))
    case WalletOption.PHANTOM:
      // Not on Bitcoin (see supportedChains), also for a Phantom saved on it before.
      return connectEach(c => (c.includes(Chain.Bitcoin) ? Promise.reject(new Error('Phantom is not offered for Bitcoin')) : uSwap.connectPhantom(c)))
    case WalletOption.TRUSTWALLET_WEB:
      const trust = getEIP6963Wallets().providers.find(p => p.info.name === 'Trust Wallet')
      return connectEach(c => uSwap.connectEVMWallet(c, WalletOption.TRUSTWALLET_WEB, trust?.provider))
    case WalletOption.RABBY:
      return connectEach(c => uSwap.connectEVMWallet(c, WalletOption.RABBY))
    case WalletOption.BRAVE:
      assertBraveAccounts(chains)
      braveConnects++
      try {
        return await connectEach(c => uSwap.connectBrave(c))
      } finally {
        braveConnects--
      }
    case WalletOption.KEPLR:
      return connectEach(c => uSwap.connectKeplr(c))
    case WalletOption.COSMOSTATION:
      return connectEach(c => uSwap.connectCosmostation(c))
    case WalletOption.BITGET:
      return connectEach(c => uSwap.connectBitget(c))
    case WalletOption.ONEKEY:
      return connectEach(c => uSwap.connectOnekeyWallet(c))
    case WalletOption.OKX:
    case WalletOption.OKX_MOBILE:
      return connectEach(c => uSwap.connectOkx(c))
    case WalletOption.VULTISIG:
      return connectEach(c => uSwap.connectVultisig(c))
    case WalletOption.TRONLINK:
      return connectEach(c => uSwap.connectTronLink(c))
    case WalletOption.EXODUS:
      return uSwap.connectExodus(chains)
    case WalletOption.WALLETCONNECT:
      // One session — one QR scan — for every chain; `restoreOnly` reuses a stored one rather than show a QR code.
      return uSwap.connectWalletconnect(chains, { ...walletConnectOptions, restoreOnly: config?.restoreOnly })
    // Seed phrase and keystore-file import is disabled: the bridge never handles private keys.
    case WalletOption.KEYSTORE:
      throw new Error('Keystore and seed phrase import is disabled')
    case WalletOption.LEDGER:
      return connectEach(c => uSwap.connectLedger(c, config?.derivationPath))
    case WalletOption.TREZOR:
      return connectEach(c => uSwap.connectTrezor(c, config?.derivationPath))
    // `restoreOnly`: a restore on page load reconnects a granted session without a prompt or the TON Connect modal.
    case TONCONNECT:
      return uSwap.connectTonConnect(chains, { restoreOnly: config?.restoreOnly, tonWallet: config?.tonWallet })
    case NEARCONNECT:
      return uSwap.connectNearConnect(chains, { restoreOnly: config?.restoreOnly })
    case LACE:
      return uSwap.connectLace(chains, { restoreOnly: config?.restoreOnly })
    case ETERNL:
      return uSwap.connectEternl(chains, { restoreOnly: config?.restoreOnly })
    case YOROI:
      return uSwap.connectYoroi(chains, { restoreOnly: config?.restoreOnly })
    case UNISAT:
      return uSwap.connectUnisat(chains, { restoreOnly: config?.restoreOnly })
    case LEATHER:
      return uSwap.connectLeather(chains, { restoreOnly: config?.restoreOnly })
    default: {
      throw new Error(`Unsupported wallet option: ${option}`)
    }
  }
}

// Brave can hold only one of its two accounts; name the missing one, since `connectEach` swallows the SDK's error.
function assertBraveAccounts(chains: Chain[]) {
  if (chains.includes(Chain.Solana) && !getBraveSolanaProvider()) {
    throw new Error('Brave Wallet has no Solana account available. Create or enable one in Brave Wallet, or deselect Solana.')
  }
  if (chains.some(c => c !== Chain.Solana) && !getBraveEVMProvider()) {
    throw new Error('Brave Wallet has no Ethereum account available. Create or enable one in Brave Wallet, or deselect the EVM chains.')
  }
}

// Brave signs with its current account, not the connected one, so reload on a switch (as TronLink does).
// Watched while a Brave account is connected; events during a connect are the grant itself.
let braveConnects = 0
let unwatchBrave: (() => void) | undefined

export function syncBraveAccountWatch(accounts: { provider: WalletOption }[]) {
  const connected = accounts.some(a => a.provider === WalletOption.BRAVE)

  if (connected && !unwatchBrave) unwatchBrave = watchBraveAccounts(onBraveAccountChange)
  if (!connected && unwatchBrave) {
    unwatchBrave()
    unwatchBrave = undefined
  }
}

// A switch only matters on a side the user connected; `undefined` comes from Solana, EVM addresses are 0x.
function onBraveAccountChange(address: string | undefined) {
  if (braveConnects > 0) return

  const isSolana = !address?.startsWith('0x')
  const connected = useWalletStore.getState().accounts.filter(a => a.provider === WalletOption.BRAVE && (a.network === Chain.Solana) === isSolana)
  if (connected.length === 0) return

  const known = address !== undefined && connected.some(a => a.address.toLowerCase() === address.toLowerCase())
  if (!known) window.location.reload()
}

type AccountsProvider = {
  request: (args: { method: string }) => Promise<unknown>
  on?: (event: 'accountsChanged', listener: (accounts: string[]) => void) => void
  removeListener?: (event: 'accountsChanged', listener: (accounts: string[]) => void) => void
}

// The EVM provider a browser wallet injects, found the way its connector finds it.
function restoreProvider(option: WalletOption): AccountsProvider | undefined {
  const w = window as unknown as Record<string, any>
  switch (option) {
    case WalletOption.METAMASK:
      return getMetaMaskProvider()
    case WalletOption.RABBY:
      return getEIP6963Provider(RABBY_RDNS) ?? (w.ethereum?.isRabby ? w.ethereum : undefined)
    case WalletOption.TRUSTWALLET_WEB:
      return getEIP6963Wallets().providers.find(p => p.info.name === 'Trust Wallet')?.provider ?? w.trustwallet
    case WalletOption.BRAVE:
      return getBraveEVMProvider()
    case WalletOption.OKX:
      return w.okxwallet
    case WalletOption.EXODUS:
      return w.exodus?.ethereum ?? (w.ethereum?.isExodus ? w.ethereum : undefined)
    case WalletOption.BITGET:
      return w.bitkeep?.ethereum
    case WalletOption.ONEKEY:
      return w.$onekey?.ethereum
  }
}

export const RESTORE_CHECKED = new Set<WalletOption>([
  WalletOption.METAMASK,
  WalletOption.RABBY,
  WalletOption.TRUSTWALLET_WEB,
  WalletOption.BRAVE,
  WalletOption.OKX,
  WalletOption.EXODUS,
  WalletOption.BITGET,
  WalletOption.ONEKEY
])
const RESTORE_PROVIDER_WAIT_MS = 1_000

// Like wagmi's reconnect: ask a saved EVM browser wallet for its accounts without a prompt. `undefined`
// means no silent check applies (not an EVM browser wallet), so restore as usual; `false` means the
// wallet is locked, unauthorized or not injected yet, so skip the restore and keep it saved.
export async function hasAuthorizedAccount(option: WalletOption, chains: Chain[]): Promise<boolean | undefined> {
  if (!RESTORE_CHECKED.has(option) || !chains.some(chain => EVMChains.includes(chain as EVMChain))) return undefined

  // Extensions inject or announce shortly after load (Rabby over EIP-6963), so allow a moment.
  let provider = restoreProvider(option)
  for (let waited = 0; !provider && waited < RESTORE_PROVIDER_WAIT_MS; waited += 100) {
    await new Promise(resolve => setTimeout(resolve, 100))
    provider = restoreProvider(option)
  }
  if (!provider) return false

  try {
    const accounts = await provider.request({ method: 'eth_accounts' })
    return Array.isArray(accounts) && accounts.length > 0
  } catch {
    return false
  }
}

// Follows an injected EVM wallet's account changes (a switch, a lock, a revoke, an unlock), as wagmi's
// injected connector does. `undefined` while the wallet is not injected, so the caller can try later.
export function watchEvmAccounts(option: WalletOption, onChange: (addresses: string[]) => void): (() => void) | undefined {
  const provider = restoreProvider(option)
  if (!provider?.on) return undefined
  const listener = (accounts: unknown) => onChange(Array.isArray(accounts) ? accounts.map(String) : [])
  provider.on('accountsChanged', listener)
  return () => provider.removeListener?.('accountsChanged', listener)
}

// Restored from a stored session or an earlier grant only: on page load these never show a QR code or a prompt.
export const RESTORE_ONLY = new Set<WalletOption>([
  WalletOption.WALLETCONNECT,
  SLUSH,
  SUIET,
  NIGHTLY,
  SOLFLARE,
  BACKPACK,
  UNISAT,
  LEATHER,
  TONCONNECT,
  NEARCONNECT,
  LACE,
  ETERNL,
  YOROI
])

export async function getAccounts(
  option: WalletOption,
  chains: Chain[],
  config?: any
): Promise<{ address: string; network: Chain; provider: WalletOption; derivationPath?: number[] }[]> {
  const uSwap = getUSwap()

  const connected = await connectWallet(option, chains, config)
  if (!connected) return []

  return chains
    .map(chain => {
      // Scoped to this provider rather than `getAddress(chain)`, which answers from the chain slot —
      // last connect wins. When one chain of a multi-chain connect fails, that files the wallet
      // already on it under this provider: MetaMask's Ethereum address in an Exodus row, which then
      // reads an empty balance and cannot sign, since every path here resolves the wallet by provider.
      const raw = uSwap.getWallet(option, chain)?.address
      const address = Array.isArray(raw) ? raw[0] : raw
      if (!address) return null
      const mismatch = btcPathMismatch(chain, address, config?.derivationPath)
      if (mismatch) {
        uSwap.disconnectChain(chain)
        throw new Error(mismatch)
      }
      return { address, network: chain, provider: option, ...(config?.derivationPath ? { derivationPath: config.derivationPath } : {}) }
    })
    .filter(acc => acc !== null)
}

// A device asked for a BIP-86 path has to answer with a Taproot (bc1p…) address. Ledger
// firmware that predates Taproot instead derives a Native SegWit address from the Taproot
// key: a valid-looking bc1q… address holding none of the user's coins. Fail loudly rather
// than connect an account whose balance will always read zero.
function btcPathMismatch(chain: Chain, address: string, derivationPath?: number[]): string | null {
  if (chain !== Chain.Bitcoin || !derivationPath) return null

  const expected = BTC_PURPOSE_ADDRESS_TYPE[derivationPath[0]]
  const actual = btcAddressType(address)

  if (!expected || !actual || expected === actual) return null

  return (
    `Your wallet returned a ${BTC_ADDRESS_TYPE_LABEL[actual]} address for the ${BTC_ADDRESS_TYPE_LABEL[expected]} derivation path. ` +
    `Update your device's Bitcoin app to the latest version, or connect using ${BTC_ADDRESS_TYPE_LABEL[actual]} instead.`
  )
}

// The chains the hardware steps (connect-wallet/ledger.tsx, trezor.tsx) carry derivation paths for. No Zcash: the SDK
// signs it for the NU6.1 branch, which the network stopped accepting at NU7.
export const HARDWARE_EVM_CHAINS = [Chain.Ethereum, Chain.Arbitrum, Chain.BinanceSmartChain, Chain.Base, Chain.Avalanche]
export const LEDGER_CHAINS = [
  ...HARDWARE_EVM_CHAINS,
  Chain.Bitcoin,
  Chain.BitcoinCash,
  Chain.Litecoin,
  Chain.Dogecoin,
  Chain.Dash,
  Chain.Ripple,
  Chain.Tron,
  Chain.Cosmos,
  Chain.THORChain
]
export const TREZOR_CHAINS = [...HARDWARE_EVM_CHAINS, Chain.Bitcoin, Chain.BitcoinCash, Chain.Litecoin, Chain.Dogecoin, Chain.Dash]

// What the wallet shows on its approval screen. The storage prefix keeps these sessions apart from the BCH
// WalletConnect client's (src/components/bch-walletconnect.tsx): two clients on one store overwrite each
// other's session list.
const walletConnectOptions = {
  metadata: { name: AppConfig.appName, description: AppConfig.description, icons: [`${AppConfig.baseUrl}/icon.svg`] },
  customStoragePrefix: 'evm'
}

// Starts loading WalletConnect and its relay connection while the user picks a wallet, so its window
// opens as soon as they press connect and the QR code follows quickly.
export function preloadWalletConnect() {
  getUSwap()
  preloadWalletconnect(walletConnectOptions)
}

const BTC_ADDRESS_TYPE_LABEL = {
  taproot: 'Taproot',
  nativeSegwit: 'Native SegWit',
  nestedSegwit: 'Nested SegWit',
  legacy: 'Legacy'
} as const

export const supportedChains = {
  // Bitget's Solana and Cosmos providers answer in shapes its connector does not read (web3.bitget.com/en/docs).
  [WalletOption.BITGET]: bitgetWallet.connectBitget.supportedChains.filter(chain => chain !== Chain.Solana && chain !== Chain.Cosmos),
  [WalletOption.BRAVE]: braveWallet.connectBrave.supportedChains,
  // Its EVM chains go to `window.ethereum`, which is whichever wallet holds it, not Cosmostation.
  [WalletOption.COSMOSTATION]: cosmostationWallet.connectCosmostation.supportedChains.filter(chain => !EVMChains.includes(chain as EVMChain)),
  [WalletOption.COINBASE_WEB]: evmWallet.connectEVMWallet.supportedChains,
  [WalletOption.EIP6963]: evmWallet.connectEVMWallet.supportedChains,
  [WalletOption.EXODUS]: exodusWallet.connectExodus.supportedChains,
  [WalletOption.KEPLR]: keplrWallet.connectKeplr.supportedChains,
  [WalletOption.LEAP]: keplrWallet.connectKeplr.supportedChains,
  [WalletOption.LEDGER]: LEDGER_CHAINS,
  [WalletOption.LEDGER_LIVE]: LEDGER_CHAINS,
  [WalletOption.METAMASK]: evmWallet.connectEVMWallet.supportedChains,
  [WalletOption.RABBY]: evmWallet.connectEVMWallet.supportedChains,
  [WalletOption.OKX]: okxWallet.connectOkx.supportedChains,
  [WalletOption.OKX_MOBILE]: evmWallet.connectEVMWallet.supportedChains,
  // Its Bitcoin path speaks sats-connect and its Solana path reads `$onekey.sol`; OneKey's providers are Unisat-style and `$onekey.solana`.
  [WalletOption.ONEKEY]: [
    ...onekeyWallet.connectOnekeyWallet.supportedChains.filter(chain => chain !== Chain.Bitcoin && chain !== Chain.Solana),
    Chain.Sui
  ],
  // Its Bitcoin connector takes the first account (the ordinals one in Phantom's docs) and has no signer to send with.
  [WalletOption.PHANTOM]: phantomWallet.connectPhantom.supportedChains.filter(chain => chain !== Chain.Bitcoin),
  [WalletOption.TREZOR]: TREZOR_CHAINS,
  [WalletOption.TRONLINK]: tronlinkWallet.connectTronLink.supportedChains,
  [WalletOption.TRUSTWALLET_WEB]: evmWallet.connectEVMWallet.supportedChains,
  [WalletOption.VULTISIG]: vultisigWallet.connectVultisig.supportedChains,
  [WalletOption.WALLETCONNECT]: walletconnectWallet.connectWalletconnect.supportedChains,
  [WalletOption.WALLET_SELECTOR]: [Chain.Near],
  [SLUSH]: suiWallet.connectSuiWallet.supportedChains,
  [SUIET]: suiWallet.connectSuiWallet.supportedChains,
  [NIGHTLY]: [...suiWallet.connectSuiWallet.supportedChains, ...solanaStandardWallet.connectSolanaWallet.supportedChains],
  [SOLFLARE]: solanaStandardWallet.connectSolanaWallet.supportedChains,
  [BACKPACK]: solanaStandardWallet.connectSolanaWallet.supportedChains,
  [TONCONNECT]: tonconnectWallet.connectTonConnect.supportedChains,
  [NEARCONNECT]: nearconnectWallet.connectNearConnect.supportedChains,
  [LACE]: laceWallet.connectLace.supportedChains,
  [ETERNL]: eternlWallet.connectEternl.supportedChains,
  [YOROI]: yoroiWallet.connectYoroi.supportedChains,
  [UNISAT]: unisatWallet.connectUnisat.supportedChains,
  [LEATHER]: leatherWallet.connectLeather.supportedChains
} satisfies Partial<Record<WalletOption, Chain[]>>
