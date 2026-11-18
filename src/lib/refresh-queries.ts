import type { QueryClient } from '@tanstack/react-query'

// What the refresh button reloads: the quotes (THORChain and the Cauldron leg), the USD prices and the
// wallet balances the form shows. Queries that build or track a transaction are left alone.
const REFRESHED = new Set(['quote', 'token-estimate', 'token-sale', 'thorchain-pool-prices', 'balance', 'bch-side-balance', 'bch-deposit-fee-rate', 'wallet-all-balances'])

export const refreshBridgeQueries = (client: QueryClient) => {
  // UTXO and Cosmos balances are read through ensureQueryData, which keeps a cached answer however stale.
  client.removeQueries({ queryKey: ['account-balance'] })
  return client.invalidateQueries({ predicate: query => REFRESHED.has(query.queryKey[0] as string) })
}
