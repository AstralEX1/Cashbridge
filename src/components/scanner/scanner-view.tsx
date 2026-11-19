'use client'

import { ArrowLeftRight, ArrowUpRight, CircleCheck, Search, SearchX, Wallet, Zap } from 'lucide-react'
import { useState } from 'react'
import { NumberTicker } from '@/components/landing/number-ticker'
import { chainIcon, chainName, hashLookups, matchesQuery } from '@/lib/scanner'
import { LiveDot } from './live-dot'
import { ScanList } from './scan-list'
import { useScanFeed } from './use-scan-feed'

type Filter = 'all' | 'router' | 'manual'
const FILTERS: [Filter, string, React.ReactNode][] = [
  ['all', 'All transfers', 'All'],
  ['router', 'Cashbridge Router', <Zap key="router" size={16} aria-hidden />],
  ['manual', 'Manual', <Wallet key="manual" size={16} aria-hidden />]
]

export function ScannerView() {
  const { rows, now, live } = useScanFeed()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const shown = rows.filter(row => (filter === 'all' || row.router === (filter === 'router')) && matchesQuery(row, query))
  const lookups = shown.length ? [] : hashLookups(query)
  const chains = [...new Set(rows.flatMap(row => [row.from.chain, row.to.chain]))]
  const stats: [string, React.ReactNode, number][] = [
    ['Transfers', <ArrowLeftRight key="all" size={18} aria-hidden />, rows.length],
    ['Router', <Zap key="router" size={18} aria-hidden />, rows.filter(row => row.router).length],
    ['Settled', <CircleCheck key="done" size={18} aria-hidden />, rows.filter(row => row.status === 'completed').length]
  ]

  return (
    <>
      <h1 className="scanner-title">
        Scanner <LiveDot live={live} />
      </h1>

      <dl className="scanner-stats">
        {stats.map(([label, icon, value]) => (
          <div key={label}>
            <dt>
              {icon}
              <span>{label}</span>
            </dt>
            <dd>
              <NumberTicker value={value} />
            </dd>
          </div>
        ))}
        <div>
          <dt>
            <span>Chains</span>
          </dt>
          <dd className="scanner-chains">
            <NumberTicker value={chains.length} />
            <span className="scanner-stack">
              {chains.map(chain => {
                const icon = chainIcon(chain)
                return (
                  icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={chain} src={icon} alt={chainName(chain)} title={chainName(chain)} width={26} height={26} />
                  )
                )
              })}
            </span>
          </dd>
        </div>
      </dl>

      <div className="scanner-tools">
        <label className="scanner-search">
          <Search size={18} aria-hidden />
          <span className="sr-only">Search transfers</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Hash, token or chain"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="scanner-filters" role="group" aria-label="Filter by mode">
          {FILTERS.map(([value, label, content]) => (
            <button key={value} type="button" aria-pressed={filter === value} aria-label={label} title={label} onClick={() => setFilter(value)}>
              {content}
            </button>
          ))}
        </div>
      </div>

      <div className="scanner-table" aria-live="polite">
        {shown.length > 0 ? (
          <ScanList rows={shown} now={now} />
        ) : (
          <div className="scanner-empty">
            <SearchX size={28} aria-hidden />
            <p>No match</p>
            {lookups.map(leg => (
              <a key={leg.label} href={leg.url} target="_blank" rel="noopener noreferrer">
                {leg.label}
                <ArrowUpRight size={14} aria-hidden />
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
