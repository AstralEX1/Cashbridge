// Free public endpoints, each checked live before it was listed: from a browser on the site's origin (CORS) for the
// lists the page uses, from a server for the ones only our API routes and the Cashbridge Router use. None needs a key.
// The first entry is asked first; src/lib/fallback.ts moves on when one fails, times out or rate-limits.
// Left out on purpose: llamarpc (no CORS), cloudflare-eth.com, polygon-rpc.com (401), blockpi and ankr (keys),
// pokt, meowrpc (429). THORNode, Midgard and 1Click have no working public mirror, so they stay single.

// JSON-RPC per chain, keyed by the SDK's Chain value.
export const EVM_RPC_URLS: Record<string, string[]> = {
  ETH: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://1rpc.io/eth',
    'https://rpc.mevblocker.io',
    'https://gateway.tenderly.co/public/mainnet',
    'https://eth-mainnet.public.blastapi.io',
    'https://eth.rpc.blxrbdn.com'
  ],
  BASE: [
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
    'https://base.drpc.org',
    'https://1rpc.io/base',
    'https://base-mainnet.public.blastapi.io',
    'https://base.gateway.tenderly.co'
  ],
  ARB: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.drpc.org',
    'https://1rpc.io/arb',
    'https://arbitrum-one.public.blastapi.io',
    'https://arbitrum.gateway.tenderly.co'
  ],
  OP: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org', 'https://optimism.gateway.tenderly.co'],
  POL: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic', 'https://polygon.gateway.tenderly.co'],
  BSC: [
    'https://bsc-dataseed.bnbchain.org',
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-dataseed1.ninicoin.io',
    'https://1rpc.io/bnb'
  ],
  AVAX: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org', 'https://1rpc.io/avax/c'],
  GNO: ['https://rpc.gnosischain.com', 'https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org', 'https://1rpc.io/gnosis', 'https://rpc.gnosis.gateway.fm'],
  AURORA: ['https://mainnet.aurora.dev', 'https://1rpc.io/aurora', 'https://aurora.drpc.org'],
  BERA: ['https://rpc.berachain.com', 'https://berachain-rpc.publicnode.com', 'https://berachain.drpc.org'],
  // Monad's and X Layer's nodes refuse a browser's CORS preflight, so the page sends them simple requests (src/lib/fallback.ts).
  MONAD: ['https://rpc.monad.xyz', 'https://rpc1.monad.xyz', 'https://rpc3.monad.xyz', 'https://rpc-mainnet.monadinfra.com', 'https://monad-mainnet.drpc.org'],
  XLAYER: ['https://xlayerrpc.okx.com', 'https://rpc.xlayer.tech', 'https://xlayer.drpc.org']
}

// Other chains the SDK and the transfer lookups reach from the page.
export const OTHER_RPC_URLS: Record<string, string[]> = {
  TRON: ['https://tron-rpc.publicnode.com', 'https://api.trongrid.io', 'https://api.tronstack.io'],
  NEAR: ['https://free.rpc.fastnear.com', 'https://near.drpc.org', 'https://rpc.mainnet.near.org'],
  GAIA: ['https://cosmos-rpc.publicnode.com', 'https://rpc.cosmos.directory/cosmoshub', 'https://cosmos-rpc.polkachu.com']
}

// XRPL JSON-RPC that answers a browser (s1/s2.ripple.com:51234 answer servers only).
export const XRPL_RPC_URLS = ['https://xrplcluster.com/', 'https://xrpl.ws/']

// Behind /api/solana. Only the Solana Foundation's nodes serve getTokenAccountsByOwner keyless; publicnode and Tatum
// refuse it but serve the rest (blockhash, status, send), and a refusal moves the call on.
export const SOLANA_RPC_URLS = ['https://api.mainnet-beta.solana.com', 'https://api.mainnet.solana.com', 'https://solana-rpc.publicnode.com', 'https://solana-mainnet.gateway.tatum.io']

// Fulcrum servers (Electrum protocol over WebSocket) that answer a browser with transactions, history and outputs.
export const FULCRUM_URLS = [
  'wss://bch.imaginary.cash:50004',
  'wss://bch.loping.net:50004',
  'wss://electrum.imaginary.cash:50004',
  'wss://fulcrum.greyh.at:50004',
  'wss://blackie.c3-soft.com:50004',
  'wss://electroncash.dk:50004',
  'wss://bch.soul-dev.com:50004',
  'wss://cashnode.bch.ninja:50004',
  'wss://fulcrum.criptolayer.net:50004',
  'wss://fulcrum.jettscythe.xyz:50004'
]

// IPFS gateways that still serve plain HTTP to a server (ipfs.io, dweb.link and w3s.link answer 429 now).
export const IPFS_GATEWAYS = ['https://ipfs.tapswap.cash/ipfs', 'https://gateway.pinata.cloud/ipfs', 'https://ipfs.filebase.io/ipfs', 'https://4everland.io/ipfs']
