import { ArrowUpRight, Check, CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react'
import type { CSSProperties } from 'react'
import { chainIcon, chainName, shortHash, type ScanRow, type ScanSide, type ScanStatus } from '@/lib/scanner'
import { statusLabel } from './status-label'
import './scan-list.css'

const STATUS_ICON: Record<ScanStatus, typeof Check> = {
  completed: Check,
  pending: LoaderCircle,
  refunded: RotateCcw,
  review: CircleAlert
}

const ago = (time: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - time) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function Side({ side }: { side: ScanSide }) {
  const chain = chainName(side.chain)
  const network = chainIcon(side.chain)
  return (
    <div className="scan-side">
      <span className="scan-icons">
        <span className="scan-icon" data-initial={side.ticker.slice(0, 1)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {side.icon && <img src={side.icon} alt="" width={28} height={28} loading="lazy" />}
        </span>
        {network && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="scan-chain" src={network} alt="" width={14} height={14} loading="lazy" />
        )}
      </span>
      <span>
        <strong aria-label={`${side.amount ? `${side.amount} ` : ''}${side.ticker} on ${chain}`}>
          {side.amount && <span className="scan-amount">{side.amount} </span>}
          {side.ticker}
        </strong>
      </span>
    </div>
  )
}

function Status({ status, router }: { status: ScanStatus; router: boolean }) {
  const Icon = STATUS_ICON[status]
  return (
    <div className="scan-status-block">
      <span className="scan-status" data-status={status}>
        <Icon size={12} aria-hidden className={status === 'pending' ? 'scan-status-spin' : undefined} />
        {statusLabel(status)}
      </span>
      <span className="scan-mode">{router ? 'Cashbridge Router' : 'Manual'}</span>
    </div>
  )
}

// The transfer list shared by the scanner and the landing page. `now` makes relative times stable within a render.
export function ScanList({ rows, now, compact }: { rows: ScanRow[]; now?: number; compact?: boolean }) {
  return (
    <table className="scan-list" data-compact={compact || undefined}>
      <thead>
        <tr>
          <th scope="col">From</th>
          <th scope="col">To</th>
          <th scope="col">Transactions</th>
          <th scope="col">Status</th>
          {!compact && <th scope="col">Time</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.key} style={{ '--i': index } as CSSProperties}>
            <td data-label="From">
              <Side side={row.from} />
            </td>
            <td data-label="To">
              <Side side={row.to} />
            </td>
            <td data-label="Transactions">
              <ul className="scan-legs">
                {row.legs.map(leg => (
                  <li key={leg.label + leg.hash}>
                    <span>{leg.label}</span>
                    <a href={leg.url} target="_blank" rel="noopener noreferrer" title={leg.hash}>
                      {shortHash(leg.hash)}
                      <ArrowUpRight size={12} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </td>
            <td data-label="Status">
              <Status status={row.status} router={row.router} />
            </td>
            {!compact && (
              <td data-label="Time" className="scan-time">
                {row.time !== undefined && now !== undefined ? (
                  <time dateTime={new Date(row.time).toISOString()} title={new Date(row.time).toLocaleString()}>
                    {ago(row.time, now)}
                  </time>
                ) : (
                  row.date
                )}
                {row.verified && <span className="scan-verified">Verified</span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
