'use client'

import { ArrowUpRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FeedOrder } from '@/lib/auto-bridge-contract'
import { RUNS } from '@/lib/mainnet-runs'
import { hashLookups, matchesQuery, scanRows } from '@/lib/scanner'
import { ScanList } from './scan-list'

type Filter = 'all' | 'router' | 'manual'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['router', 'Cashbridge Router'],
  ['manual', 'Manual']
]
const REFRESH_MS = 30_000

export function ScannerView() {
  // undefined while loading, null when the Router feed cannot be reached.
  const [orders, setOrders] = useState<FeedOrder[] | null | undefined>(undefined)
  const [now, setNow] = useState<number>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

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
  const shown = rows.filter(row => (filter === 'all' || row.router === (filter === 'router')) && matchesQuery(row, query))
  const lookups = shown.length ? [] : hashLookups(query)
  const stats: [string, number][] = [
    ['Transfers listed', rows.length],
    ['Cashbridge Router', rows.filter(row => row.router).length],
    ['Completed', rows.filter(row => row.status === 'completed').length],
    ['Chains', new Set(rows.flatMap(row => [row.from.chain, row.to.chain])).size]
  ]

  return (
    <>
      <dl className="scanner-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="scanner-tools">
        <label className="scanner-search">
          <Search size={18} aria-hidden />
          <span className="sr-only">Search transfers</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search by transaction hash, token or chain"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="scanner-filters" role="group" aria-label="Filter by execution mode">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="scanner-feed" aria-live="polite">
        {orders === undefined
          ? 'Loading Cashbridge Router orders…'
          : orders === null
            ? 'Live Cashbridge Router orders are unavailable right now. Showing the transfers verified on mainnet.'
            : 'Cashbridge Router orders update every 30 seconds.'}
      </p>

      <div className="scanner-table">
        {shown.length > 0 ? (
          <ScanList rows={shown} now={now} />
        ) : (
          <div className="scanner-empty">
            <p>No transfer in this list matches “{query.trim()}”.</p>
            {lookups.length > 0 && (
              <p>
                Look it up on{' '}
                {lookups.map((leg, i) => (
                  <span key={leg.label}>
                    {i > 0 && ' or '}
                    <a href={leg.url} target="_blank" rel="noopener noreferrer">
                      the {leg.label}
                      <ArrowUpRight size={13} aria-hidden />
                    </a>
                  </span>
                ))}
                .
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
