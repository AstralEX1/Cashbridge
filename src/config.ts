import { ProviderName } from '@tcswap/helpers'

export const AppConfig = {
  id: 'thorchain',
  appName: 'THORChain Swap',
  title: 'THORChain Swap | Cross-Chain BTC, ETH & Crypto Swaps',
  description:
    'Swap Bitcoin to Ethereum and other cryptocurrencies instantly with THORChain. Native BTC swaps with no bridges, wrapping, or centralized exchanges.',
  baseUrl: 'https://swap.thorchain.org',
  // The bridge's first leg is THORChain alone (see BridgeConfig).
  providers: [ProviderName.THORCHAIN],
  // The PRIVATE tab quotes this provider alone; its assets are listed only there.
  privateProvider: ProviderName.HOUDINI,
  favicon: '/favicon.ico',
  logo: '/logo.svg',
  logoLink: 'https://www.thorchain.org',
  gtag: 'G-VZ0FQ1WC7G',
  pixelId: 'qki4a',
  pixelEvent: 'tw-qki4a-qop3i',
  affiliateLink: 'https://affiliate.thorchain.org',
  telegramLink: 'https://t.me/thorchain_org',
  privacyPolicyLink: 'https://www.thorchain.org/privacy-policy',
  tosLink: 'https://www.thorchain.org/terms-of-use',
  supportEmail: 'contact@thorchain.org'
}

// The aggregator API key stays on the server, so the SDK and src/lib/api.ts talk to our own
// proxy (src/app/api/thorchain) instead of api.thorchain.org. Absolute: the SDK's request
// client builds a `new URL(...)` from it.
export function aggregatorApiUrl() {
  const origin = typeof window === 'undefined' ? AppConfig.baseUrl : window.location.origin
  return `${origin}/api/thorchain/v1`
}

export const PRIMARY_HOST = 'swap.thorchain.org'

export const SUBDOMAIN_ROUTES = [
  { path: '/tcy', host: 'tcy.thorchain.org' },
  { path: '/bond', host: 'bond.thorchain.org' },
  { path: '/memo', host: 'memo.thorchain.org' },
  { path: '/pool', host: 'pool.thorchain.org' },
  { path: '/thorname', host: 'thorname.thorchain.org' },
  { path: '/affiliate', host: 'affiliate.thorchain.org' }
] as const

// THORChain -> BCH -> PUSD bridge. The first leg always buys native BCH through THORChain; PUSD is
// only ever bought in a second, separately authorized Cauldron transaction. Never discover PUSD by
// ticker: the category id is the token's identity (checked against paryonusd.com and its BCMR).
export const BridgeConfig = {
  buyAsset: 'BCH.BCH',
  providers: [ProviderName.THORCHAIN, ProviderName.THORCHAIN_STREAMING] as ProviderName[],
  pusd: {
    category: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
    decimals: 2,
    ticker: 'PUSD'
  },
  // BCH confirmations on the THORChain outbound before its outputs fund the second leg. 0: the owner
  // chose to swap as soon as the verified outbound is in the mempool; BCH has no
  // replace-by-fee, and Cauldron accepts unconfirmed inputs.
  minConfirmations: 0,
  // Second-leg price tolerance applied to the fresh Cauldron quote, in basis points.
  pusdSlippageBps: 100,
  cauldronBroadcastUrl: process.env.NEXT_PUBLIC_CAULDRON_BROADCAST_URL || 'https://broadcast.cauldron.quest/broadcast',
  // Cauldron's public pool indexer: the PUSD pools the second leg trades against. Each pool a trade
  // picks is checked unspent on a Fulcrum server first, since the list can lag the chain.
  cauldronIndexerUrl: process.env.NEXT_PUBLIC_CAULDRON_INDEXER_URL || 'https://indexer.cauldron.quest',
  // Fulcrum (Electrum protocol) servers used to verify BCH transactions and unspent outputs.
  electrumUrls: (process.env.NEXT_PUBLIC_BCH_ELECTRUM_URLS || 'wss://bch.imaginary.cash:50004').split(',').map(u => u.trim()).filter(Boolean)
}
