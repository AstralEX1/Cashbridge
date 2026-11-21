import type { QuoteResponseRoute } from '@tcswap/helpers/api'

// What a route's deposit costs on the paying EVM chain, the same way for every bridge: from what its quote says the
// wallet will sign. An approval when the quote names a spender for the token, a contract call when the funds pass a
// contract (`targetAddress`) on the way to where they land (`inboundAddress`), as THORChain's router does, else one
// plain transfer to a deposit address (NEAR Intents, ShapeShift).
// Gas used by our own mainnet transactions (their receipts' gasUsed); other tokens and chains land close to these.
export const GAS_UNITS = {
  // USDC approve on Base, 0x74057b1163cf078c7d045e92b4bc8c9605d834f60f8e4926ac35c86da8f65ae8.
  approve: 55_413n,
  // Native: the base cost. Token: USDC to a NEAR Intents deposit address on Base,
  // 0x4e37b7d5d4f2eeeb5230e73a271c1c3c4a2bd95a9b5a6985092512247a6cfca5.
  transfer: { native: 21_000n, token: 40_259n },
  // THORChain router depositWithExpiry: BNB on BNB Chain, 0x592eaa37bc2ca30efff2be5eb75b94bbb4819f1f1c99c4144c707aec7c5d8218;
  // USDC on Base, 0x33b7e852fbf3da2ee6b069add21a1dc594317b69b91afd4bb1531e86bcec4849.
  call: { native: 39_193n, token: 56_204n }
} as const

type GasRoute = Pick<QuoteResponseRoute, 'meta' | 'targetAddress' | 'inboundAddress'>

// `approved`: the wallet already allows the spender this amount, so no approval is signed.
export const routeGasUnits = (route: GasRoute, { token, approved = false }: { token: boolean; approved?: boolean }) => {
  const call = !!route.targetAddress && route.targetAddress.toLowerCase() !== route.inboundAddress?.toLowerCase()
  const approve = token && !!route.meta?.approvalAddress && !approved
  return (approve ? GAS_UNITS.approve : 0n) + GAS_UNITS[call ? 'call' : 'transfer'][token ? 'token' : 'native']
}

// The chain's gas price (wei) on `units`, in USD and in the bought asset; undefined without both prices.
export const gasCost = (units: bigint, gasPriceWei: bigint, nativeUsd?: number, buyUsd?: number) => {
  if (!nativeUsd || !buyUsd) return undefined
  const usd = (Number(units * gasPriceWei) / 1e18) * nativeUsd
  return { usd, buy: usd / buyUsd }
}

export type SourceGas = NonNullable<ReturnType<typeof gasCost>>
