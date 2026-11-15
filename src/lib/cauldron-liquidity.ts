import { BridgeConfig } from '@/config'

const isCategory = (category: string) => /^[0-9a-f]{64}$/.test(category)

export const cauldronLiquidityUrl = (category: string) => {
  if (!isCategory(category)) throw new Error('Invalid Cauldron token category')
  return `https://app.cauldron.quest/add/${category}`
}

export const parseCauldronApy = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null
  const { apy, pools } = value as { apy?: unknown; pools?: unknown }
  if (typeof pools !== 'number' || !Number.isSafeInteger(pools) || pools <= 0) return null
  if (typeof apy !== 'number' && (typeof apy !== 'string' || !/^\d+(\.\d+)?$/.test(apy))) return null
  const rate = Number(apy)
  return Number.isFinite(rate) && rate >= 0 ? rate : null
}

// Cauldron's liquidity-weighted APY; the endpoint's default window is the last 30 days.
export const getCauldronApy = async (category: string): Promise<number | null> => {
  if (!isCategory(category)) throw new Error('Invalid Cauldron token category')
  const response = await fetch(`${BridgeConfig.cauldronIndexerUrl}/cauldron/pool/aggregated_apy?token=${category}`, {
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error('Could not read the Cauldron pool APY')
  return parseCauldronApy(await response.json())
}
