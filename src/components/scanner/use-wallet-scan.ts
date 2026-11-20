'use client'

import { useEffect, useMemo, useState } from 'react'
import { isFeedOrder, type FeedOrder } from '@/lib/auto-bridge-contract'
import { bchForms, localRows } from '@/lib/local-scan'
import { rowsFromThorchain, walletRows, type ScanRow } from '@/lib/scanner'
import { autoBridgeStore } from '@/store/auto-bridge-store'
import { transactionStore } from '@/store/transaction-store'

// The Midgard the app reads pool prices from (src/lib/api.ts); it answers browsers directly.
const MIDGARD_ACTIONS = 'https://gateway.liquify.com/chain/thorchain_midgard/v2/actions'

// Midgard keeps EVM addresses in lower case and BCH ones without the prefix, in whichever form the swap named.
const midgardAddresses = (address: string) => {
  const bch = bchForms(address)
  return bch.length ? bch : [/^0x[0-9a-f]{40}$/i.test(address) ? address.toLowerCase() : address]
}

const json = (url: string) => fetch(url, { cache: 'no-store' }).then(res => (res.ok ? res.json() : null)).catch(() => null)

// Every transfer tied to one wallet: its Cashbridge Router orders, its THORChain swaps into or out of BCH, and the
// transfers this browser saved. Undefined while the lookups run. A source that fails adds nothing.
export function useWalletScan(address: string | undefined, feed: ScanRow[]) {
  const [found, setFound] = useState<{ address: string; router: FeedOrder[]; thorchain: ScanRow[] }>()

  useEffect(() => {
    if (!address) return
    let live = true
    Promise.all([
      json(`/api/scanner?address=${encodeURIComponent(address)}`).then(body => (Array.isArray(body?.orders) ? body.orders.filter(isFeedOrder) : [])),
      json(`${MIDGARD_ACTIONS}?address=${midgardAddresses(address).map(encodeURIComponent).join(',')}&limit=50`).then(body =>
        Array.isArray(body?.actions) ? rowsFromThorchain(body.actions) : []
      )
    ]).then(([router, thorchain]) => {
      if (live) setFound({ address, router, thorchain })
    })
    return () => {
      live = false
    }
  }, [address])

  const transactions = transactionStore(state => state.transactions)
  const orders = autoBridgeStore(state => state.orders)
  return useMemo(
    () =>
      address && found?.address === address
        ? walletRows({ router: found.router, feed, local: localRows(address, transactions, orders), thorchain: found.thorchain })
        : undefined,
    [address, found, feed, transactions, orders]
  )
}
