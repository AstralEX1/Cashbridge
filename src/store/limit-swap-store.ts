import { create } from 'zustand'

// Handed over by the Modify Limit Order dialog when the expiration changes: THORChain cannot edit
// an open order's expiry, so the order is cancelled and the swap form is pre-filled to place the
// replacement. Consumed once by SwapLimit and then cleared.
export interface PendingLimitOrder {
  pricePerUnit?: string
  expiryBlocks: number
}

interface LimitSwapState {
  isLimitSwap: boolean
  // The PRIVATE tab (a Houdini-routed swap). Limit and Private are modes of the same form and
  // exclusive: turning either on turns the other off, whichever code path flips it - the
  // replacement-order flow sets limit directly, and must not leave a private quote under it.
  isPrivateSwap: boolean
  // The PRIVATE tab's Send mode; kept across tab switches, only read while the tab is on.
  isPrivateSend: boolean
  limitSwapBuyAmount?: string
  limitSwapExpiry: number
  pendingLimitOrder?: PendingLimitOrder

  setIsLimitSwap: (isLimit: boolean) => void
  setIsPrivateSwap: (isPrivate: boolean) => void
  setIsPrivateSend: (isSend: boolean) => void
  setLimitSwapBuyAmount: (amount?: string) => void
  setLimitSwapExpiry: (expiry: number) => void
  setPendingLimitOrder: (order?: PendingLimitOrder) => void
}

export const useLimitSwapStore = create<LimitSwapState>()(set => ({
  isLimitSwap: false,
  isPrivateSwap: false,
  isPrivateSend: false,
  limitSwapBuyAmount: undefined,
  limitSwapExpiry: 0,
  pendingLimitOrder: undefined,

  // The bridge offers market swaps to BCH only: limit orders, the PRIVATE tab and its Send mode
  // stay off whichever code path (URL, replacement order, tab click) asks for them.
  setIsLimitSwap: () => set({ isLimitSwap: false, isPrivateSwap: false }),
  setIsPrivateSwap: () => set({ isPrivateSwap: false, isLimitSwap: false }),
  setIsPrivateSend: () => set({ isPrivateSend: false }),
  setLimitSwapBuyAmount: amount => set({ limitSwapBuyAmount: amount }),
  setLimitSwapExpiry: expiry => set({ limitSwapExpiry: expiry }),
  setPendingLimitOrder: order => set({ pendingLimitOrder: order })
}))

export const useIsLimitSwap = () => useLimitSwapStore(state => state.isLimitSwap)
export const useSetIsLimitSwap = () => useLimitSwapStore(state => state.setIsLimitSwap)

export const useIsPrivateSwap = () => useLimitSwapStore(state => state.isPrivateSwap)
export const useSetIsPrivateSwap = () => useLimitSwapStore(state => state.setIsPrivateSwap)

export const isPrivateSendMode = (state: LimitSwapState) => state.isPrivateSwap && state.isPrivateSend
export const useIsPrivateSend = () => useLimitSwapStore(isPrivateSendMode)
export const useSetIsPrivateSend = () => useLimitSwapStore(state => state.setIsPrivateSend)

export const useLimitSwapBuyAmount = () => useLimitSwapStore(state => state.limitSwapBuyAmount)

export const useLimitSwapExpiry = () => useLimitSwapStore(state => state.limitSwapExpiry)

export const useSetPendingLimitOrder = () => useLimitSwapStore(state => state.setPendingLimitOrder)
