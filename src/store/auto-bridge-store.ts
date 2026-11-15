import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { OrderIntent, PublicOrder } from '@/lib/auto-bridge-contract'

export interface SavedAutoOrder {
  id: string
  capability: string
  createdAt?: number
  intent?: OrderIntent
  sourceAttempted?: boolean
  sourceHash?: string
  order?: PublicOrder
  estimatedSeconds?: number
}
interface AutoBridgeStore {
  orders: SavedAutoOrder[]
  save: (reference: SavedAutoOrder) => void
  patch: (id: string, patch: Partial<Omit<SavedAutoOrder, 'id' | 'capability' | 'intent'>>) => void
}
// Per-order records keep a stale tab's history write from deleting another tab's order.
// Read the original B array as well, so existing browser references migrate without a reset.
const orderStorage = (): StateStorage => {
  const previous = new Map<string, string>()
  const prefix = 'cashbridge-auto-order-'
  return {
    getItem(name) {
      const legacy = JSON.parse(localStorage.getItem(name) ?? '{}')
      const orders = new Map<string, SavedAutoOrder>((legacy.state?.orders ?? []).map((ref: SavedAutoOrder) => [ref.id, ref]))
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(prefix)) {
          const ref = JSON.parse(localStorage.getItem(key)!) as SavedAutoOrder
          orders.set(ref.id, ref)
        }
      }
      for (const ref of orders.values()) {
        if (localStorage.getItem(`cashbridge-auto-source-${ref.id}`) === 'attempted') ref.sourceAttempted = true
        previous.set(ref.id, JSON.stringify(ref))
        if (!localStorage.getItem(prefix + ref.id)) localStorage.setItem(prefix + ref.id, JSON.stringify(ref))
      }
      return JSON.stringify({ state: { orders: [...orders.values()] }, version: 0 })
    },
    setItem(_name, value) {
      const refs = JSON.parse(value).state.orders as SavedAutoOrder[]
      for (const ref of refs) {
        const serialized = JSON.stringify(ref)
        if (previous.get(ref.id) === serialized) continue
        const old = JSON.parse(localStorage.getItem(prefix + ref.id) ?? 'null') as SavedAutoOrder | null
        const merged = old ? { ...old, ...ref, intent: old.intent ?? ref.intent,
          order: old.order && (!ref.order || old.order.updatedAt > ref.order.updatedAt) ? old.order : ref.order } : ref
        localStorage.setItem(prefix + ref.id, JSON.stringify(merged))
        previous.set(ref.id, serialized)
      }
    },
    removeItem(name) { localStorage.removeItem(name) }
  }
}
export const autoBridgeStore = create<AutoBridgeStore>()(
  persist(
    set => ({
      orders: [],
      save: reference => set(state => ({ orders: state.orders.some(order => order.id === reference.id) ? state.orders : [...state.orders, reference] })),
      patch: (id, patch) => set(state => ({ orders: state.orders.map(order => order.id === id ? { ...order, ...patch } : order) }))
    }),
    { name: 'cashbridge-auto-orders', storage: createJSONStorage(orderStorage), partialize: state => ({ orders: state.orders }) }
  )
)

interface AutomaticPreference {
  mode: 'manual' | 'automatic'
  recipient: string
  setMode: (mode: 'manual' | 'automatic') => void
  setRecipient: (recipient: string) => void
}
export const automaticPreference = create<AutomaticPreference>()(persist(
  set => ({ mode: 'manual', recipient: '', setMode: mode => set({ mode }), setRecipient: recipient => set({ recipient }) }),
  { name: 'cashbridge-execution', partialize: state => ({ mode: state.mode, recipient: state.recipient }) }
))
