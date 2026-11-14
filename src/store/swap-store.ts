import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Asset } from '@/components/swap/asset'
import { BridgeConfig } from '@/config'
import { useLimitSwapStore } from '@/store/limit-swap-store'

const INITIAL_AMOUNT_FROM = 1

// The bridge's first leg always buys native BCH: no other buy asset is accepted, and BCH itself
// cannot be sold into it.
export const isBridgeBuyAsset = (asset?: Pick<Asset, 'identifier'>) => asset?.identifier.toUpperCase() === BridgeConfig.buyAsset
export const isBridgeSellAsset = (asset?: Asset) => !!asset && !isBridgeBuyAsset(asset) && asset.chain !== 'BCH'

// On the PRIVATE tab picking the other side's asset switches Send on instead of flipping. Pickers
// only: the URL and tab-switch code pass through momentary same-asset pairs.
export const startPrivateSendOnSamePick = (picked: Asset, side: 'from' | 'to') => {
  const { isPrivateSwap, setIsPrivateSend } = useLimitSwapStore.getState()
  const { assetFrom, assetTo } = useSwapStore.getState()
  const other = side === 'from' ? assetTo : assetFrom
  if (isPrivateSwap && picked.identifier === other?.identifier) setIsPrivateSend(true)
}

export const INITIAL_SLIPPAGE = 1
export const INITIAL_CUSTOM_INTERVAL = 0
export const INITIAL_CUSTOM_QUANTITY = 0

interface SwapState {
  assetFrom?: Asset
  assetTo?: Asset
  amountFrom: string
  slippage?: number
  customInterval: number
  customQuantity: number
  feeWarning: string
  hasHydrated: boolean

  setSlippage: (limit?: number) => void
  setCustomInterval: (interval: number) => void
  setCustomQuantity: (quantity: number) => void
  setAmountFrom: (amount: string) => void
  setAssetFrom: (asset: Asset) => void
  setAssetTo: (asset: Asset) => void
  swapAssets: (amount?: string) => void
  setHasHydrated: (state: boolean) => void
}

export const useSwapStore = create<SwapState>()(
  persist(
    (set, get) => ({
      slippage: INITIAL_SLIPPAGE,
      customInterval: INITIAL_CUSTOM_INTERVAL,
      customQuantity: INITIAL_CUSTOM_QUANTITY,
      amountFrom: INITIAL_AMOUNT_FROM.toString(),
      feeWarning: '500',
      hasHydrated: false,

      setSlippage: slippage => set({ slippage: slippage }),
      setCustomInterval: customInterval => set({ customInterval }),
      setCustomQuantity: customQuantity => set({ customQuantity }),
      setAmountFrom: fromAmount => set({ amountFrom: fromAmount }),

      setAssetFrom: asset => {
        if (!isBridgeSellAsset(asset)) return
        const { assetTo } = get()

        set({ assetFrom: asset, assetTo: isBridgeBuyAsset(assetTo) ? assetTo : undefined })
      },

      setAssetTo: asset => {
        if (!isBridgeBuyAsset(asset)) return
        set({ assetTo: asset })
      },

      // Reversing the pair would sell BCH, which the bridge never does.
      swapAssets: () => {},

      setHasHydrated: (state: boolean) => set({ hasHydrated: state })
    }),
    {
      name: 'tc-swap-store',
      version: 4,
      // Earlier versions could hold any pair; a restored pair is rechecked against the bridge rules.
      migrate: () => ({}),
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<SwapState>) }
        if (!isBridgeSellAsset(state.assetFrom)) state.assetFrom = undefined
        if (!isBridgeBuyAsset(state.assetTo)) state.assetTo = undefined
        return state
      },
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true)
      },
      partialize: state => ({
        slippage: state.slippage,
        feeWarning: state.feeWarning,
        assetFrom: state.assetFrom,
        assetTo: state.assetTo
      })
    }
  )
)
