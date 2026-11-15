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

type UseQuote = {
  isLoading: boolean
  refetch: (options?: RefetchOptions) => void
  quote?: QuoteResponseRoute
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
    isPrivateSwap
  ]

  const {
    data: quote,
    refetch,
    isLoading,
    isRefetching,
    isPlaceholderData,
    error
  } = useQuery({
    queryKey: queryKey,
    queryFn: ({ signal }) => {
      if (!sellAmount) return
      if (!sellAsset || !buyAsset) return

      // The bridge quotes THORChain alone, BCH.BCH on one side, on the aggregator's own streaming policy.
      return getQuotes(
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
    },
    placeholderData: previous =>
      previous && isQuoteFor(previous, sellAsset, buyAsset) && isHoudiniProvider(previous.providers[0]) === isPrivateSwap
        ? previous
        : undefined,
    enabled: !!(sellAmount && sellAsset && buyAsset && (reverse || (assetTo?.identifier && pairMatchesMode))),
    // A THORChain timeout is transient: asked again a few seconds later, quietly.
    retry: (count, error) => error instanceof QuoteTimeoutError && count < 2,
    retryDelay: 3_000,
    refetchOnMount: false
  })

  const newError = error instanceof USwapError ? resolveQuoteError(error) : error

  const saleError = reverse && bchToken ? sale.error : null
  return {
    isLoading: isLoading || isRefetching || (reverse && !!bchToken && sale.isLoading),
    refetch,
    quote: isLoading || isRefetching || isPlaceholderData || error ? undefined : quote,
    pricingQuote: error ? undefined : quote,
    error: saleError ?? newError,
    minimum: error instanceof BelowMinimumError ? error.minimum : undefined
  }
}

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
