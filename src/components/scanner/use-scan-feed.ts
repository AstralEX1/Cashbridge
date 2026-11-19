'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FeedOrder } from '@/lib/auto-bridge-contract'
import { RUNS } from '@/lib/mainnet-runs'
import { scanRows } from '@/lib/scanner'

const REFRESH_MS = 30_000

// Cashbridge Router orders from /api/scanner, refreshed while the tab is visible, merged with the verified runs.
// `live` is undefined while loading and false when the Router feed cannot be reached.
export function useScanFeed() {
  const [orders, setOrders] = useState<FeedOrder[] | null | undefined>(undefined)
  const [now, setNow] = useState<number>()

  useEffect(() => {
    let live = true
    const load = async () => {
      if (document.hidden) return
      try {
        const res = await fetch('/api/scanner', { cache: 'no-store' })
        const body = res.ok ? await res.json() : null
        if (live) setOrders(Array.isArray(body?.orders) ? body.orders : null)
      } catch {
        if (live) setOrders(null)
      }
      if (live) setNow(Date.now())
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  const rows = useMemo(() => scanRows(orders ?? [], RUNS), [orders])
  return { rows, now, live: orders === undefined ? undefined : orders !== null }
}
