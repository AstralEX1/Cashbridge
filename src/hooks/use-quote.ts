import { RefetchOptions, useQuery } from '@tanstack/react-query'
import { USwapNumber } from '@tcswap/core'
import { ProviderName, USwapError } from '@tcswap/helpers'
import { QuoteResponseRoute } from '@tcswap/helpers/api'
import { AppConfig } from '@/config'
import { useAssetFrom, useAssetTo, useCustomInterval, useCustomQuantity, useSlippage, useSwap } from '@/hooks/use-swap'
import { getQuotes, QuoteTimeoutError } from '@/lib/api'
import { BelowMinimumError, resolveQuoteError } from '@/lib/errors'
import { isHoudiniProvider } from '@/lib/swap-helpers'
import { useIsPrivateSend, useIsPrivateSwap } from '@/store/private-swap-store'
import { useTokenSale } from '@/hooks/use-token-sale'
import { BridgeConfig } from '@/config'
import { useSwapStore } from '@/store/swap-store'
import { useAutomaticBridge } from '@/hooks/use-automatic-bridge'
import { getNearQuote, type NearRoute } from '@/lib/near-intents'

// The two bridges' quotes for the same transfer; either may be missing.
export interface BridgeRoutes {
  thorchain?: QuoteResponseRoute
  near?: NearRoute
}

type UseQuote = {
  isLoading: boolean
  refetch: (options?: RefetchOptions) => void
  // The route the transfer takes: the user's pick when it quotes, else the better one.
  quote?: QuoteResponseRoute
  routes?: BridgeRoutes
  best?: 'thorchain' | 'near'
  // The quote to price the pair by: `quote`, or while it refetches, the previous one for the same pair.
  pricingQuote?: QuoteResponseRoute
  error: Error | null
  // Set when the amount is under THORChain's minimum swap, in the sell asset's units.
  minimum?: string
}

export const useQuote = (): UseQuote => {
  const { valueFrom } = useSwap()
  const slippage = useSlippage()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const customInterval = useCustomInterval()
  const customQuantity = useCustomQuantity()
  const isPrivateSwap = useIsPrivateSwap()
  const isPrivateSend = useIsPrivateSend()
  // Right after a tab/mode switch the pair lags a render behind (Swap fixes it in an effect); don't quote it.
  const pairMatchesMode = isPrivateSend === (!!assetFrom && assetFrom.identifier === assetTo?.identifier)

  // The reverse bridge sells BCH into `assetFrom` (the other chain's asset). From a token, the BCH
  // quoted is what the Cauldron sale of the typed amount is expected to leave for THORChain.
  const reverse = useSwapStore(state => state.reverse)
  const bchToken = useSwapStore(state => state.bchToken)
  const sale = useTokenSale(reverse ? bchToken : null, valueFrom.toSignificant())
  const sellAsset = reverse ? BridgeConfig.buyAsset : assetFrom?.identifier
  const buyAsset = reverse ? assetFrom?.identifier : assetTo?.identifier
  const sellAmount = reverse && bchToken ? sale.bridgeAmount : valueFrom.eqValue(0) ? undefined : valueFrom.toSignificant()
  // NEAR Intents carries manual forward transfers; the Cashbridge Router and transfers back stay on THORChain for now.
  const { automatic } = useAutomaticBridge()
  const nearAllowed = BridgeConfig.nearIntents && !reverse && !automatic && !isPrivateSwap
  const choice = useSwapStore(state => state.routeChoice)

  const queryKey = [
    'quote',
    reverse,
    sellAmount,
    assetFrom?.identifier,
    assetTo?.identifier,
    assetFrom?.chain,
    assetTo?.chain,
    slippage,
    customInterval,
    customQuantity,
    isPrivateSwap,
    nearAllowed
  ]

  const {
    data: routes,
    refetch,
    isLoading,
    isRefetching,
    isPlaceholderData,
    error
  } = useQuery({
    queryKey: queryKey,
    queryFn: async ({ signal }): Promise<BridgeRoutes | undefined> => {
      if (!sellAmount) return
      if (!sellAsset || !buyAsset) return

      // THORChain on the aggregator's own streaming policy, and NEAR Intents' 1Click beside it. Either one
      // quoting is enough; with neither, THORChain's error (a minimum, a halt) is the one shown.
      const near = nearAllowed
        ? getNearQuote({ sellAsset, buyAsset, sellAmount, dry: true, slippageBps: nearSlippageBps(slippage) }, signal).catch(error => {
            console.warn('NEAR Intents quote failed', error)
            return undefined
          })
        : undefined
      const thorchain = getQuotes(
        {
          buyAsset,
          sellAsset,
          sellAmount,
          slippage: slippage ?? 99,
          providers: AppConfig.providers
        },
        createAbortController(signal)
      ).then(quotes => {
        if (quotes.length === 0) throw new Error(reverse ? 'No THORChain route from BCH for this amount' : 'No THORChain route to BCH for this amount')

        if (AppConfig.id === 'thorchain' && !isPrivateSwap) {
          const thorchainQuote =
            quotes.find(q => q.providers[0] === ProviderName.THORCHAIN_STREAMING) || quotes.find(q => q.providers[0] === ProviderName.THORCHAIN)

          if (thorchainQuote) {
            return thorchainQuote
          }
        }

        return quotes.reduce((best, current) =>
          new USwapNumber(current.expectedBuyAmount).gt(new USwapNumber(best.expectedBuyAmount)) ? current : best
        )
      })
      const [thor, nearRoute] = await Promise.allSettled([thorchain, near])
      const result = { thorchain: thor.status === 'fulfilled' ? thor.value : undefined, near: nearRoute.status === 'fulfilled' ? nearRoute.value : undefined }
      if (!result.thorchain && !result.near) throw thor.status === 'rejected' ? thor.reason : new Error('No route for this amount')
      return result
    },
    placeholderData: previous => {
      const sample = previous?.thorchain ?? previous?.near
      return sample && isQuoteFor(sample, sellAsset, buyAsset) && isHoudiniProvider(sample.providers[0]) === isPrivateSwap ? previous : undefined
    },
    enabled: !!(sellAmount && sellAsset && buyAsset && (reverse || (assetTo?.identifier && pairMatchesMode))),
    // A THORChain timeout is transient: asked again a few seconds later, quietly.
    retry: (count, error) => error instanceof QuoteTimeoutError && count < 2,
    retryDelay: 3_000,
    refetchOnMount: false
  })

  const newError = error instanceof USwapError ? resolveQuoteError(error) : error

  const saleError = reverse && bchToken ? sale.error : null
  const best = bestRoute(routes)
  const quote = routes && (choice === 'near' ? (routes.near ?? routes.thorchain) : choice === 'thorchain' ? (routes.thorchain ?? routes.near) : best && routes[best])
  return {
    isLoading: isLoading || isRefetching || (reverse && !!bchToken && sale.isLoading),
    refetch,
    quote: isLoading || isRefetching || isPlaceholderData || error ? undefined : quote,
    routes: isLoading || isRefetching || isPlaceholderData || error ? undefined : routes,
    best,
    pricingQuote: error ? undefined : quote,
    error: saleError ?? newError,
    minimum: error instanceof BelowMinimumError ? error.minimum : undefined
  }
}

// The route paying more of the bought asset; THORChain on a tie.
export const bestRoute = (routes?: BridgeRoutes): 'thorchain' | 'near' | undefined => {
  if (!routes?.near) return routes?.thorchain ? 'thorchain' : undefined
  if (!routes.thorchain) return 'near'
  return new USwapNumber(routes.near.expectedBuyAmount).gt(new USwapNumber(routes.thorchain.expectedBuyAmount)) ? 'near' : 'thorchain'
}

// The form's slippage is a percentage; 1Click takes basis points.
export const nearSlippageBps = (slippage?: number) => Math.round((slippage ?? 1) * 100)

export const isQuoteFor = (quote: QuoteResponseRoute, sellAsset?: string, buyAsset?: string) =>
  quote.sellAsset.toLowerCase() === sellAsset?.toLowerCase() && quote.buyAsset.toLowerCase() === buyAsset?.toLowerCase()

function createAbortController(signal: AbortSignal) {
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort()
  } else {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return controller
}
