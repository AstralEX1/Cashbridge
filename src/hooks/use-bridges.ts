'use client'

import { useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { activeBridge, type BridgeRecord, transactionStore, unfinishedBridges } from '@/store/transaction-store'

// The store rehydrates from localStorage synchronously on the client, so the server and the first
// client render would disagree about a saved operation. It is read only once hydration is over.
const noSubscribe = () => () => {}
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false)

export const useActiveBridge = () => {
  const active = transactionStore(activeBridge)
  return useHydrated() ? active : undefined
}

export const useUnfinishedBridges = () => {
  const list = transactionStore(useShallow(unfinishedBridges))
  return useHydrated() ? list : NO_BRIDGES
}
const NO_BRIDGES: BridgeRecord[] = []
