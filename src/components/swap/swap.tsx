'use client'

import { useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { AssetValue } from '@tcswap/core'
import { BridgeConfig } from '@/config'
import { Asset } from '@/components/swap/asset'
import { SwapAddressFrom } from '@/components/swap/swap-address-from'
import { SwapButton } from '@/components/swap/swap-button'
import { BchWalletStatus, BridgeOperationPanel, PusdEstimate } from '@/components/swap/pusd-swap'
import { SwapDetails } from '@/components/swap/swap-details'
import { SwapHaltBanner } from '@/components/swap/swap-halt-banner'
import { SwapInputFrom } from '@/components/swap/swap-input-from'
import { SwapInputTo } from '@/components/swap/swap-input-to'
import { SwapSettings } from '@/components/swap/swap-settings'
import { isAssetInMode, useAssets } from '@/hooks/use-assets'
import { useQuote } from '@/hooks/use-quote'
import { useSwapRates } from '@/hooks/use-rates'
import { useResolveSource } from '@/hooks/use-resolve-source'
import { useSetAssetFrom, useSetAssetTo } from '@/hooks/use-swap'
import { useTradingHalt } from '@/hooks/use-trading-halt'
import { urlBuyAsset, useUrlParams } from '@/hooks/use-url-params'
import { resolvePriceImpact } from '@/lib/swap-helpers'
import { useIsPrivateSend } from '@/store/limit-swap-store'
import { useSwapStore } from '@/store/swap-store'

const DEFAULT_SELL = 'BTC.BTC'
const DEFAULT_BUY = BridgeConfig.buyAsset

export const Swap = () => {
  const t = useTranslations('swap')
  const setAssetFrom = useSetAssetFrom()
  const setAssetTo = useSetAssetTo()
  const isPrivateSend = useIsPrivateSend()
  const pairKey = useSwapStore(state => `${state.assetFrom?.identifier}|${state.assetTo?.identifier}`)
  const { assets } = useAssets()
  const { quote } = useQuote()
  const { rateFrom, rateTo } = useSwapRates()
  const { isHalted, chains: haltedChains } = useTradingHalt()

  const isPrivateTab = useUrlParams()
  useResolveSource()

  useEffect(() => {
    AssetValue.loadStaticAssets()
  }, [])

  // Each tab has its own asset list (the native protocols' or Houdini's). Switching tabs keeps a
  // selection both list and replaces one only the other does, so the form never quotes an asset
  // the current provider does not know. Leaving a private send restores the URL's buy asset.
  useEffect(() => {
    if (!assets?.length) return

    // Read the pair from the store, not the render closure: on a first visit useUrlParams sets
    // the pair from the URL in this same commit, and the closure still holds the empty pair.
    const { assetFrom, assetTo } = useSwapStore.getState()

    const inMode = (asset?: Asset) => !!asset && isAssetInMode(asset, isPrivateTab)
    // Defaults before "any asset", so a fallback clashing with `other` doesn't land on the list's first entry.
    const replacement = (fallback: string, other?: Asset) => {
      const usable = (a: Asset) => inMode(a) && a.identifier !== other?.identifier
      for (const id of [fallback, DEFAULT_BUY, DEFAULT_SELL]) {
        const match = assets.find(a => a.identifier === id && usable(a))
        if (match) return match
      }
      return assets.find(usable)
    }

    const nextFrom = inMode(assetFrom) ? assetFrom : replacement(DEFAULT_SELL, isPrivateSend ? undefined : assetTo)
    const keepTo = inMode(assetTo) && assetTo?.identifier !== nextFrom?.identifier
    const nextTo = isPrivateSend ? nextFrom : keepTo ? assetTo : replacement(urlBuyAsset(assets)?.identifier ?? DEFAULT_BUY, nextFrom)

    if (nextFrom && nextFrom !== assetFrom) setAssetFrom(nextFrom)
    if (nextTo && nextTo !== assetTo) setAssetTo(nextTo)
    // Also reruns on pair changes: a saved same-asset pair rehydrates after the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrivateTab, isPrivateSend, assets, pairKey])

  const priceImpact = useMemo(() => {
    return resolvePriceImpact(quote, rateFrom, rateTo)
  }, [quote, rateFrom, rateTo])

  return (
    <div className="flex flex-col items-center justify-center px-4 pt-4 pb-4 md:pb-20">
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-txt-contrast-1-default text-2xl font-medium">{t('tab.bridge')}</div>
          <div className="flex items-center gap-4">
            <SwapAddressFrom />
            <SwapSettings />
          </div>
        </div>

        {/* THORChain swap to native BCH, then a separately signed Cauldron swap to PUSD. No limit,
            private, reverse or memoless entry points. */}
        <div className="bg-modal rounded-20 relative space-y-1.25 border p-2.5">
          <SwapInputFrom />
          <SwapInputTo priceImpact={priceImpact} />
          <PusdEstimate />
          <BchWalletStatus />
          <SwapButton instantSwapSupported={false} instantSwapAvailable={false} />
        </div>

        <BridgeOperationPanel />

        {isHalted && !isPrivateTab && (
          <div className="pt-2">
            <SwapHaltBanner chains={haltedChains} />
          </div>
        )}

        <SwapDetails />
      </div>
    </div>
  )
}
