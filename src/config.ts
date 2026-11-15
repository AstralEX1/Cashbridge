import { ProviderName } from '@tcswap/helpers'

export const AppConfig = {
  // Internal id: selects the brand palette in globals.css and THORChain-first quote ordering.
  id: 'thorchain',
  appName: 'Cash Bridge',
  title: 'Cash Bridge | Bridge to Bitcoin Cash and PUSD',
  description:
    'Bridge stablecoins and other assets to Bitcoin Cash through THORChain, then swap to PUSD on Cauldron. Self-custodial: every step is signed in your own wallet.',
  baseUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://cashbridge.space',
  // The bridge's first leg is THORChain alone (see BridgeConfig).
  providers: [ProviderName.THORCHAIN],
  // The PRIVATE tab quotes this provider alone; its assets are listed only there.
  privateProvider: ProviderName.HOUDINI,
  logo: '/logo.svg',
  // Trezor Connect requires a contact email in its manifest.
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || ''
}

// The aggregator API key stays on the server, so the SDK and src/lib/api.ts talk to our own
// proxy (src/app/api/thorchain) instead of api.thorchain.org. Absolute: the SDK's request
// client builds a `new URL(...)` from it.
export function aggregatorApiUrl() {
  const origin = typeof window === 'undefined' ? AppConfig.baseUrl : window.location.origin
  return `${origin}/api/thorchain/v1`
}

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
