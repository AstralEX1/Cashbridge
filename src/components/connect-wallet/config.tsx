import { Chain, getEIP6963Provider, getMetaMaskProvider, okxMobileEnabled, RABBY_RDNS, WalletOption } from '@tcswap/core'
import { getChainConfig } from '@tcswap/helpers'
import { getBraveEVMProvider, getBraveSolanaProvider } from '@tcswap/wallets/brave'
// The injected-provider globals (window.vultisig, window.phantom, ...) are declared by this package.
import type {} from '@tcswap/wallet-extensions'
import { BridgeConfig } from '@/config'
import { LEATHER, leatherProvider, UNISAT, unisatProvider } from '@/lib/bitcoin-wallets'
import { CIP30_IDS, cip30Entry, ETERNL, LACE, YOROI } from '@/lib/cardano-wallet'
import { NEARCONNECT } from '@/lib/near-connect-wallet'
import { BACKPACK, findSolanaWallet, SOLFLARE } from '@/lib/solana-wallet'
import { findSuiWallet, NIGHTLY, SLUSH, SUIET } from '@/lib/sui-wallet'
import { TONCONNECT, type TonWallet } from '@/lib/ton-wallet'
import { supportedChains } from '@/lib/wallets'

export enum WalletType {
  browser,
  hardware,
  // Any wallet app paired over WalletConnect: a QR code on desktop, a link on a phone.
  mobile
}

export type WalletParams = {
  key: string
  type: WalletType
  label: string
  option: WalletOption
  link: string
  supportedChains: Chain[]
  tonWallet?: TonWallet
}

export const ALL_CHAINS = [
  Chain.Arbitrum,
  Chain.Aurora,
  Chain.Avalanche,
  Chain.Base,
  Chain.Berachain,
  Chain.BinanceSmartChain,
  Chain.Bitcoin,
  Chain.BitcoinCash,
  Chain.Cardano,
  Chain.Cosmos,
  Chain.Dash,
  Chain.Dogecoin,
  Chain.Ethereum,
  Chain.Gnosis,
  Chain.Litecoin,
  Chain.Maya,
  Chain.Monad,
  Chain.Near,
  Chain.Optimism,
  Chain.Polygon,
  Chain.Ripple,
  Chain.Solana,
  Chain.Sui,
  Chain.THORChain,
  Chain.Ton,
  Chain.Tron,
  Chain.XLayer,
  Chain.Zcash
]

export const COMING_SOON_CHAINS = ['XMR', 'TAO']

export const WALLETS: WalletParams[] = [
  {
    key: 'metamask',
    label: 'MetaMask',
    type: WalletType.browser,
    option: WalletOption.METAMASK,
    link: 'https://metamask.io',
    supportedChains: supportedChains[WalletOption.METAMASK]
  },
  {
    key: 'vultisig',
    type: WalletType.browser,
    label: 'Vultisig',
    option: WalletOption.VULTISIG,
    link: 'https://vultisig.com',
    supportedChains: supportedChains[WalletOption.VULTISIG]
  },
  {
    key: 'phantom',
    type: WalletType.browser,
    label: 'Phantom',
    option: WalletOption.PHANTOM,
    link: 'https://phantom.app',
    supportedChains: supportedChains[WalletOption.PHANTOM]
  },
  {
    key: 'trustwallet',
    type: WalletType.browser,
    label: 'Trust Wallet',
    option: WalletOption.TRUSTWALLET_WEB,
    link: 'https://trustwallet.com',
    supportedChains: supportedChains[WalletOption.TRUSTWALLET_WEB]
  },
  {
    key: 'brave',
    type: WalletType.browser,
    label: 'Brave Wallet',
    option: WalletOption.BRAVE,
    link: 'https://brave.com/wallet',
    supportedChains: supportedChains[WalletOption.BRAVE]
  },
  {
    key: 'rabby',
    type: WalletType.browser,
    label: 'Rabby Wallet',
    option: WalletOption.RABBY,
    link: 'https://rabby.io',
    supportedChains: supportedChains[WalletOption.RABBY]
  },
  {
    key: 'exodus',
    type: WalletType.browser,
    label: 'Exodus',
    option: WalletOption.EXODUS,
    link: 'https://www.exodus.com/browser-extension',
    supportedChains: supportedChains[WalletOption.EXODUS]
  },
  {
    key: 'keplr',
    type: WalletType.browser,
    label: 'Keplr',
    option: WalletOption.KEPLR,
    link: 'https://www.keplr.app',
    supportedChains: supportedChains[WalletOption.KEPLR]
  },
  {
    key: 'okx',
    type: WalletType.browser,
    label: 'OKX',
    option: WalletOption.OKX,
    link: 'https://web3.okx.com',
    supportedChains: supportedChains[WalletOption.OKX]
  },
  {
    key: 'bitget',
    type: WalletType.browser,
    label: 'Bitget Wallet',
    option: WalletOption.BITGET,
    link: 'https://web3.bitget.com',
    supportedChains: supportedChains[WalletOption.BITGET]
  },
  {
    key: 'onekey',
    type: WalletType.browser,
    label: 'OneKey',
    option: WalletOption.ONEKEY,
    link: 'https://onekey.so',
    supportedChains: supportedChains[WalletOption.ONEKEY]
  },
  {
    key: 'cosmostation',
    type: WalletType.browser,
    label: 'Cosmostation',
    option: WalletOption.COSMOSTATION,
    link: 'https://www.cosmostation.io',
    supportedChains: supportedChains[WalletOption.COSMOSTATION]
  },
  {
    key: 'tronlink',
    type: WalletType.browser,
    label: 'TronLink',
    option: WalletOption.TRONLINK,
    link: 'https://www.tronlink.org',
    supportedChains: supportedChains[WalletOption.TRONLINK]
  },
  {
    key: 'slush',
    type: WalletType.browser,
    label: 'Slush',
    option: SLUSH,
    link: 'https://slush.app',
    supportedChains: supportedChains[SLUSH]
  },
  {
    key: 'suiet',
    type: WalletType.browser,
    label: 'Suiet',
    option: SUIET,
    link: 'https://suiet.app',
    supportedChains: supportedChains[SUIET]
  },
  {
    key: 'nightly',
    type: WalletType.browser,
    label: 'Nightly',
    option: NIGHTLY,
    link: 'https://nightly.app',
    supportedChains: supportedChains[NIGHTLY]
  },
  {
    key: 'solflare',
    type: WalletType.browser,
    label: 'Solflare',
    option: SOLFLARE,
    link: 'https://solflare.com',
    supportedChains: supportedChains[SOLFLARE]
  },
  {
    key: 'backpack',
    type: WalletType.browser,
    label: 'Backpack',
    option: BACKPACK,
    link: 'https://backpack.app',
    supportedChains: supportedChains[BACKPACK]
  },
  {
    key: 'unisat',
    type: WalletType.browser,
    label: 'UniSat',
    option: UNISAT,
    link: 'https://unisat.io',
    supportedChains: supportedChains[UNISAT]
  },
  {
    key: 'leather',
    type: WalletType.browser,
    label: 'Leather',
    option: LEATHER,
    link: 'https://leather.io',
    supportedChains: supportedChains[LEATHER]
  },
  {
    key: 'lace',
    type: WalletType.browser,
    label: 'Lace',
    option: LACE,
    link: 'https://www.lace.io',
    supportedChains: supportedChains[LACE]
  },
  {
    key: 'eternl',
    type: WalletType.browser,
    label: 'Eternl',
    option: ETERNL,
    link: 'https://eternl.io',
    supportedChains: supportedChains[ETERNL]
  },
  {
    key: 'yoroi',
    type: WalletType.browser,
    label: 'Yoroi',
    option: YOROI,
    link: 'https://yoroi-wallet.com',
    supportedChains: supportedChains[YOROI]
  },
  // Telegram's own wallet, opened straight from its row: a QR code on a computer, the Telegram app on a phone.
  {
    key: 'telegram',
    type: WalletType.mobile,
    label: 'Telegram Wallet',
    option: TONCONNECT,
    link: 'https://telegram.org',
    supportedChains: supportedChains[TONCONNECT],
    tonWallet: 'telegram'
  },
  {
    key: 'tonkeeper',
    type: WalletType.mobile,
    label: 'Tonkeeper',
    option: TONCONNECT,
    link: 'https://tonkeeper.com',
    supportedChains: supportedChains[TONCONNECT],
    tonWallet: 'tonkeeper'
  },
  // TON Connect's own modal lists every other TON wallet (MyTonWallet, Tonhub, Bitget, OKX, …).
  {
    key: 'tonconnect',
    type: WalletType.mobile,
    label: 'TON Connect',
    option: TONCONNECT,
    link: 'https://docs.ton.org/applications/ton-connect',
    supportedChains: supportedChains[TONCONNECT]
  },
  // NEAR Connect's own picker lists HOT, Meteor, Intear, MyNearWallet and the rest of NEAR's wallet manifest.
  {
    key: 'nearconnect',
    type: WalletType.mobile,
    label: 'NEAR wallets',
    option: NEARCONNECT,
    link: 'https://docs.near.org/tools/near-connect',
    supportedChains: supportedChains[NEARCONNECT]
  },
  // Listed only with a WalletConnect (Reown) project id; the same one the BCH wallets pair with.
  ...(BridgeConfig.walletConnectProjectId
    ? [
        {
          key: 'walletconnect',
          type: WalletType.mobile,
          label: 'WalletConnect',
          option: WalletOption.WALLETCONNECT,
          link: 'https://walletconnect.network',
          supportedChains: supportedChains[WalletOption.WALLETCONNECT]
        }
      ]
    : []),
  {
    key: 'ledger',
    type: WalletType.hardware,
    label: 'Ledger',
    option: WalletOption.LEDGER,
    link: 'https://www.ledger.com',
    supportedChains: supportedChains[WalletOption.LEDGER]
  },
  {
    key: 'trezor',
    type: WalletType.hardware,
    label: 'Trezor',
    option: WalletOption.TREZOR,
    link: 'https://trezor.io',
    supportedChains: supportedChains[WalletOption.TREZOR]
  }
  // No keystore / seed phrase entry: the bridge never imports private keys.
]

type WalletconnectErrorKey = 'walletconnectNoChains' | 'walletconnectNotLoaded' | 'walletconnectNotConnected'

// WalletConnect's errors are SDK keys (wallet_walletconnect_…); the user reads what went wrong instead.
export const describeWalletconnectError = (t: (key: WalletconnectErrorKey) => string, error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  if (message.startsWith('wallet_walletconnect_chain_not_supported')) return t('walletconnectNoChains')
  if (message.includes('did not load')) return t('walletconnectNotLoaded')
  if (message.startsWith('wallet_walletconnect_')) return t('walletconnectNotConnected')
}

export const wallet = (option: WalletOption) => {
  return WALLETS.find(w => w.option === option)
}

export const isWalletAvailable = (option: WalletOption) => {
  // prettier-ignore
  switch (option) {
    case WalletOption.METAMASK: return getMetaMaskProvider()
    case WalletOption.VULTISIG: return window?.vultisig
    case WalletOption.PHANTOM: return window?.phantom
    case WalletOption.KEPLR: return window?.keplr
    case WalletOption.OKX: return window?.okxwallet
    case WalletOption.TRONLINK: return window?.tronLink || window?.tronWeb
    case WalletOption.EXODUS: return window?.exodus || window?.ethereum?.isExodus
    // Rabby's own announcement, since `window.ethereum` is MetaMask's unless Rabby is the default wallet.
    case WalletOption.RABBY: return getEIP6963Provider(RABBY_RDNS) || window?.ethereum?.isRabby
    case WalletOption.LEDGER:
    case WalletOption.TREZOR: return true
    case WalletOption.WALLETCONNECT: return !!BridgeConfig.walletConnectProjectId

    case WalletOption.BRAVE:
      return getBraveSolanaProvider() || getBraveEVMProvider()
    case WalletOption.TRUSTWALLET_WEB:
      return window?.ethereum?.isTrust || window?.trustwallet
    case WalletOption.COINBASE_WEB:
      return ((window?.ethereum?.overrideIsMetaMask && window?.ethereum?.selectedProvider?.isCoinbaseWallet) || window?.coinbaseWalletExtension)
    case WalletOption.OKX_MOBILE:
      return okxMobileEnabled()
    case WalletOption.BITGET:
      return window?.bitkeep
    case WalletOption.ONEKEY:
      return window?.$onekey
    case WalletOption.COSMOSTATION:
      return window?.cosmostation
    case SLUSH:
    case SUIET:
      return findSuiWallet(option)
    case NIGHTLY:
      return findSuiWallet(option) || findSolanaWallet(option)
    // Solflare's extension sets `window.solflare` (its in-app browser `SolflareApp`) and registers once we ask it to.
    case SOLFLARE:
      return solflareInjected() || findSolanaWallet(option)
    case BACKPACK:
      return findSolanaWallet(option)
    case UNISAT:
      return unisatProvider()
    case LEATHER:
      return leatherProvider()
    case TONCONNECT:
    case NEARCONNECT:
      return true
    case LACE:
    case ETERNL:
    case YOROI:
      return cip30Entry(CIP30_IDS[option]!)

    default:
      return false
  }
}

const solflareInjected = () => {
  const w = window as unknown as { solflare?: { isSolflare?: boolean }; SolflareApp?: unknown }
  return !!(w.solflare?.isSolflare || w.SolflareApp)
}

export const chainLabel = (c: Chain | string): string => {
  switch (c) {
    case Chain.BinanceSmartChain:
      return 'BNB Smart Chain'
    case Chain.BitcoinCash:
      return 'Bitcoin Cash'
    case Chain.Tron:
      return 'TRON'
    case Chain.Ripple:
      return 'XRP Ledger'
    case Chain.Maya:
      return 'Maya Protocol'
    case 'XMR':
      return 'Monero'
    case 'TAO':
      return 'Bittensor'
    default:
      return getChainConfig(c as Chain).name
  }
}
