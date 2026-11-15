import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatBaseUnits, toBaseUnits } from '@/lib/bridge'
import { quoteToken } from '@/lib/cauldron'
import type { CauldronToken } from '@/lib/cauldron-tokens'
import { DEPOSIT_FEE_RESERVE } from '@/lib/thorchain-deposit'

// Step 1 of a reverse bridge from a token: the Cauldron sale of `amount` (in token units) for BCH,
// and the BCH that then goes to THORChain: the sale's proceeds less its own miner fee and room for
// the deposit's fee. Indicative: the deposit is built on the sale's actual outputs.
export const useTokenSale = (token: CauldronToken | null | undefined, amount: string) => {
  const sellUnits = useMemo(() => {
    if (!token || !amount) return undefined
    try {
      return toBaseUnits(amount, token.decimals)
    } catch {
      return undefined
    }
  }, [token, amount])

  const query = useQuery({
    queryKey: ['token-sale', token?.category, sellUnits?.toString()],
    queryFn: () => quoteToken({ category: token!.category, side: 'sell', amount: sellUnits! }),
    enabled: !!token && !!sellUnits && sellUnits > 0n,
    retry: false,
    staleTime: 20_000
  })

  const quote = query.data
  const bridgeSats = quote ? quote.output - (quote.minerFeeSats ?? 0n) - DEPOSIT_FEE_RESERVE : undefined
  return {
    sellUnits,
    quote,
    // BCH (as a decimal string) the THORChain leg is quoted for.
    bridgeAmount: bridgeSats !== undefined && bridgeSats > 0n ? formatBaseUnits(bridgeSats, 8) : undefined,
    bridgeSats,
    isLoading: query.isLoading && query.fetchStatus !== 'idle',
    error: query.error as Error | null
  }
}
