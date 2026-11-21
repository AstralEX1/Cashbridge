// The networks the landing page and the docs draw: source chains, the bridges and the services Cash Bridge builds on.

// The second cross-chain route, for manual transfers both ways. Set to false to take it off the page.
export const NEAR_INTENTS = true

// Source chains: THORChain's, plus the ones only NEAR Intents reaches (THORChain decides what is open at a given moment).
export const CHAINS: [string, string, boolean?][] = [
  ['btc', 'Bitcoin'],
  ['eth', 'Ethereum'],
  ['base', 'Base'],
  ['sol', 'Solana'],
  ['bsc', 'BNB Chain'],
  ['arb', 'Arbitrum', true],
  ['avax', 'Avalanche'],
  ['xrp', 'XRP Ledger'],
  ['tron', 'TRON'],
  ['op', 'Optimism', true],
  ['ltc', 'Litecoin'],
  ['doge', 'Dogecoin'],
  ['pol', 'Polygon', true],
  ['zec', 'Zcash'],
  ['gaia', 'Cosmos'],
  ['thor', 'THORChain'],
  ['near', 'NEAR', true],
  ['gno', 'Gnosis', true],
  ['bera', 'Berachain', true],
  ['dash', 'Dash', true],
  ['monad', 'Monad', true],
  ['xlayer', 'X Layer', true],
  ['sui', 'Sui', true],
  ['ton', 'TON', true],
  ['ada', 'Cardano', true]
].filter(([, , nearOnly]) => NEAR_INTENTS || !nearOnly) as [string, string, boolean?][]

export const ROUTES = [
  { name: 'THORChain', icon: '/providers/thorchain.svg' },
  ...(NEAR_INTENTS ? [{ name: 'NEAR Intents', icon: '/providers/near.svg' }] : []),
  { name: 'ShapeShift', icon: '/providers/shapeshift.svg' }
]

export const INTEGRATIONS: { name: string; logo?: string; href: string; show?: boolean }[] = [
  { name: 'THORChain', logo: '/providers/thorchain.svg', href: 'https://thorchain.org' },
  { name: 'NEAR Intents', logo: '/providers/near.svg', href: 'https://near-intents.org', show: NEAR_INTENTS },
  { name: 'ShapeShift', logo: '/providers/shapeshift.svg', href: 'https://shapeshift.com' },
  { name: 'Cauldron', logo: '/providers/cauldron.png', href: 'https://cauldron.quest' },
  { name: 'WalletConnect', logo: '/wallets/walletconnect.svg', href: 'https://walletconnect.network' },
  { name: 'WizardConnect', logo: '/integrations/wizardconnect.png', href: 'https://docs.riftenlabs.com/wizardconnect/dapp' },
  { name: 'Fulcrum', logo: '/integrations/fulcrum.svg', href: 'https://github.com/cculianu/Fulcrum' },
  { name: 'Rostrum', logo: '/integrations/rostrum.png', href: 'https://gitlab.com/bitcoinunlimited/rostrum' },
  { name: 'BCMR', logo: '/integrations/bcmr.png', href: 'https://cashtokens.org/docs/bcmr/chip' }
]
