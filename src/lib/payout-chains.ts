import { Chain, type EVMChain, EVMChains } from '@tcswap/core'
import { getProvider } from '@tcswap/toolboxes/evm'

// Chains a reverse bridge may pay out on: those whose payout this app confirms on the chain itself.
// EVM through the router's TransferOut event, the others through their own nodes (payout-check.ts).
export const NON_EVM_PAYOUT_CHAINS: Chain[] = [
  Chain.Bitcoin,
  Chain.Litecoin,
  Chain.Dogecoin,
  Chain.Zcash,
  Chain.Ripple,
  Chain.Solana,
  Chain.Tron,
  Chain.Cosmos,
  Chain.THORChain
]

export const isEvmChain = (chain: string) => EVMChains.includes(chain as EVMChain)

export const destinationChainOf = (buyAsset: string) => buyAsset.split('.')[0].toUpperCase()

// Where the payout search starts on an EVM chain; other chains are looked up by THORNode's outbound hash.
export const blockHeight = async (chain: string) => (isEvmChain(chain) ? (await getProvider(chain as EVMChain)).getBlockNumber() : undefined)

export const isPayoutChain = (chain: string) => isEvmChain(chain) || NON_EVM_PAYOUT_CHAINS.includes(chain as Chain)

// Hex and bech32 addresses compare case-insensitively (bech32 is written in one case); base58
// (Solana, TRON, legacy UTXO) and XRP's classic addresses are case-sensitive.
const oneCase = (s: string) => s === s.toLowerCase() || s === s.toUpperCase()
export const sameAddress = (a: string, b: string) =>
  a === b || (a.toLowerCase() === b.toLowerCase() && (a.toLowerCase().startsWith('0x') || (oneCase(a) && oneCase(b))))
