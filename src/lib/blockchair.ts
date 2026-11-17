import { Chain, UTXOChain } from '@tcswap/core'

// The URL slug per UTXO chain, as the toolbox derives it from its Blockchair dialect. Our route answers that dialect
// from keyless explorers (src/lib/utxo-api.ts), which must list every slug here.
export const BLOCKCHAIR_CHAINS: Partial<Record<UTXOChain, string>> = {
  [Chain.Bitcoin]: 'bitcoin',
  [Chain.BitcoinCash]: 'bitcoin-cash',
  [Chain.Litecoin]: 'litecoin',
  [Chain.Dash]: 'dash',
  [Chain.Dogecoin]: 'dogecoin',
  [Chain.Zcash]: 'zcash'
}
