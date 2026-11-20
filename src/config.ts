import { ProviderName } from '@tcswap/helpers'

export const AppConfig = {
  // Internal id: selects the brand palette in globals.css and THORChain-first quote ordering.
  id: 'thorchain',
  appName: 'Cash Bridge',
  title: 'Cash Bridge | Bridge to Bitcoin Cash and PUSD',
  description:
    'Bridge assets to Bitcoin Cash and CashTokens through THORChain and Cauldron. Choose manual execution, or automatic PUSD delivery with temporary service custody of BCH.',
  baseUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://cashbridge.space',
  // The bridge's first leg is THORChain alone (see BridgeConfig).
  providers: [ProviderName.THORCHAIN],
  // The PRIVATE tab quotes this provider alone; its assets are listed only there.
  privateProvider: ProviderName.HOUDINI,
  logo: '/logo.svg',
  repoUrl: 'https://github.com/AstralEX1/Cashbridge',
  // Trezor Connect requires a contact email in its manifest.
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || ''
}

// BCH BLAZE 2026 entry banner at the top of the home page. An empty link hides its item.
export const BlazeConfig = {
  deckUrl: 'https://docs.google.com/presentation/d/1XSNgnP1huDaj9bteZzeZsYN8pXcRH4THqivWplrAinQ/edit?usp=sharing',
  // CashTokens address that receives EMBER2026 community votes.
  emberAddress: ''
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
  // Second-leg price tolerance applied to the fresh Cauldron quote, in basis points (owner: 2% default, 2026-11-18).
  // The router fixes it into an order's minimum when the order is created; existing orders keep theirs.
  pusdSlippageBps: 200,
  // Transfers back from BCH through the Cashbridge Router's sale contract, which the Router admits with
  // AUTO_BRIDGE_SALE_ORDERS. On by default; NEXT_PUBLIC_ROUTER_SALES=false hides the option.
  routerSales: process.env.NEXT_PUBLIC_ROUTER_SALES !== 'false',
  // NEAR Intents (1Click) quoted beside THORChain on manual forward transfers; 'false' leaves THORChain alone.
  nearIntents: process.env.NEXT_PUBLIC_NEAR_INTENTS !== 'false',
  // NEAR Intents for the Cashbridge Router's forward transfers too, which the Router admits with AUTO_BRIDGE_NEAR_ORDERS (a
  // Router that does not falls back to THORChain). On by default; NEXT_PUBLIC_ROUTER_NEAR=false leaves the Router on THORChain.
  routerNear: process.env.NEXT_PUBLIC_ROUTER_NEAR !== 'false',
  // Manual CashToken via SwapOnArrival (browser trade key → P2SH). Off with NEXT_PUBLIC_SWAP_ON_ARRIVAL=false;
  // prepare failure falls back to the wallet address + classic Manual Cauldron.
  swapOnArrival: process.env.NEXT_PUBLIC_SWAP_ON_ARRIVAL !== 'false',
  cauldronBroadcastUrl: process.env.NEXT_PUBLIC_CAULDRON_BROADCAST_URL || 'https://broadcast.cauldron.quest/broadcast',
  // Cauldron's public pool indexer: the PUSD pools the second leg trades against. Each pool a trade
  // picks is checked unspent on a Fulcrum server first, since the list can lag the chain.
  cauldronIndexerUrl: process.env.NEXT_PUBLIC_CAULDRON_INDEXER_URL || 'https://indexer.cauldron.quest',
  // Rostrum servers (Electrum protocol with Cauldron's `cauldron.contract.subscribe`): the live pool feed
  // the second leg trades against. Empty turns the feed off and uses the indexer alone.
  rostrumUrls: (process.env.NEXT_PUBLIC_CAULDRON_ROSTRUM_URLS ?? 'wss://rostrum.riften.net:443,wss://rostrum.cauldron.quest:50004').split(',').map(u => u.trim()).filter(Boolean),
  // Fulcrum (Electrum protocol) servers used to verify BCH transactions and unspent outputs.
  electrumUrls: (process.env.NEXT_PUBLIC_BCH_ELECTRUM_URLS || 'wss://bch.imaginary.cash:50004,wss://bch.loping.net:50004').split(',').map(u => u.trim()).filter(Boolean),
  // WalletConnect (Reown) project ID for BCH wallets that speak WalletConnect v2 (Paytaca, Cashonize).
  // Public by design (it ships in the page); the default is Cash Bridge's own project, which only
  // accepts cashbridge.space origins. An empty env value hides the option, leaving WizardConnect alone.
  walletConnectProjectId: (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'b533fd30a8a2ac9a448cd0388ef0c83d').trim()
}
