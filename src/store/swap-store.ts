import { EVMChain, EVMChains } from '@tcswap/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Asset } from '@/components/swap/asset'
import { BridgeConfig } from '@/config'
import { type CauldronToken, isCauldronToken, PUSD_TOKEN } from '@/lib/cauldron-tokens'
import { useLimitSwapStore } from '@/store/limit-swap-store'

const INITIAL_AMOUNT_FROM = 1

// The THORChain leg always trades native BCH against one other asset: BCH is never on both sides,
// and nothing else is bought or sold through THORChain on the BCH side.
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

// The reverse bridge pays out on an EVM chain only: its arrival is checked on that chain's own RPC.
export const isReverseTargetAsset = (asset?: Asset) => isBridgeSellAsset(asset) && EVMChains.includes(asset!.chain as EVMChain)

interface SwapState {
  // The BCH side of the bridge: native BCH (null) or a Cauldron token, bought or sold through Cauldron.
  bchToken: CauldronToken | null
  setBchToken: (token: CauldronToken | null) => void
  // false: other chain -> THORChain -> BCH (-> token). true: (token ->) BCH -> THORChain -> EVM chain.
  // `assetFrom` is the other chain's asset in both directions; `amountFrom` is always what is sent.
  reverse: boolean
  setReverse: (reverse: boolean) => void
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
      bchToken: PUSD_TOKEN,
      setBchToken: token => {
        if (token === null || isCauldronToken(token)) set({ bchToken: token })
      },
      reverse: false,
      setReverse: reverse => set({ reverse, amountFrom: '' }),
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

      // Swapping the sides is the bridge's direction toggle, not a swap of the asset pair.
      swapAssets: () => set(state => ({ reverse: !state.reverse, amountFrom: '' })),

      setHasHydrated: (state: boolean) => set({ hasHydrated: state })
    }),
    {
      name: 'tc-swap-store',
      version: 5,
      // Versions before 4 could hold any pair; a restored pair is rechecked against the bridge rules.
      migrate: (persisted, version) => (version === 4 ? persisted : {}) as never,
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<SwapState>) }
        if (!isBridgeSellAsset(state.assetFrom)) state.assetFrom = undefined
        if (!isBridgeBuyAsset(state.assetTo)) state.assetTo = undefined
        // Before version 5 the BCH side was a 'BCH' | 'PUSD' choice.
        const legacy = (persisted as { destinationAsset?: unknown } | undefined)?.destinationAsset
        if (legacy === 'BCH') state.bchToken = null
        else if (state.bchToken !== null && !isCauldronToken(state.bchToken)) state.bchToken = PUSD_TOKEN
        if (typeof state.reverse !== 'boolean') state.reverse = false
        return state
      },
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true)
      },
      partialize: state => ({
        bchToken: state.bchToken,
        reverse: state.reverse,
        slippage: state.slippage,
        feeWarning: state.feeWarning,
        assetFrom: state.assetFrom,
        assetTo: state.assetTo
      })
    }
  )
)
