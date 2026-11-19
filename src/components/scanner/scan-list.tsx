import { ArrowUpRight } from 'lucide-react'
import { chainName, shortHash, type ScanRow, type ScanSide, type ScanStatus } from '@/lib/scanner'
import './scan-list.css'

const STATUS_TEXT: Record<ScanStatus, string> = { completed: 'Completed', pending: 'In progress', refunded: 'Refunded', review: 'Under review' }

const ago = (time: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - time) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function Side({ side }: { side: ScanSide }) {
  return (
    <div className="scan-side">
      <span className="scan-icon" data-initial={side.ticker.slice(0, 1)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {side.icon && <img src={side.icon} alt="" width={28} height={28} loading="lazy" />}
      </span>
      <span>
        <strong>
          {side.amount && <span className="scan-amount">{side.amount} </span>}
          {side.ticker}
        </strong>
        <small>{chainName(side.chain)}</small>
      </span>
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
        {rows.map(row => (
          <tr key={row.key}>
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
              <span className="scan-status" data-status={row.status}>
                {STATUS_TEXT[row.status]}
              </span>
              <span className="scan-mode">{row.router ? 'Cashbridge Router' : 'Manual'}</span>
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
                {row.verified && <span className="scan-verified">Verified on explorers</span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
