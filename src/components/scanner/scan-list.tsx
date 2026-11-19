import { ArrowRight, BadgeCheck, CircleCheck, LoaderCircle, TriangleAlert, Undo2, Wallet, Zap } from 'lucide-react'
import { chainName, shortHash, type ScanRow, type ScanSide, type ScanStatus } from '@/lib/scanner'
import { statusLabel } from './status-label'
import './scan-list.css'

const STATUS_ICON: Record<ScanStatus, typeof CircleCheck> = {
  completed: CircleCheck,
  pending: LoaderCircle,
  refunded: Undo2,
  review: TriangleAlert
}

const ago = (time: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - time) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

const Img = ({ src, size, className }: { src: string; size: number; className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt="" width={size} height={size} loading="lazy" className={className} />
)

// The coin, with its chain's mark in the corner when the coin alone does not name the chain.
function Side({ side }: { side: ScanSide }) {
  const name = `${side.ticker} · ${chainName(side.chain)}`
  return (
    <span className="scan-side">
      <span className="scan-coin" data-initial={side.ticker.slice(0, 1)} data-tip={name}>
        {side.icon && <Img src={side.icon} size={30} />}
        {side.badge && <Img src={side.badge} size={14} className="scan-badge" />}
      </span>
      <span className="scan-value">
        {side.amount && <strong>{side.amount}</strong>} <span>{side.ticker}</span>
        <span className="sr-only"> on {chainName(side.chain)}</span>
      </span>
    </span>
  )
}

// The transfer list shared by the scanner and the landing page: status, both ends, every step as a link to its
// explorer, mode and age. Icons carry the meaning; each one names itself on hover, on focus and to screen
// readers. `now` keeps relative times stable within a render.
export function ScanList({ rows, now }: { rows: ScanRow[]; now?: number }) {
  return (
    <ol className="scan-list">
      {rows.map((row, i) => {
        const statusText = statusLabel(row.status)
        const StatusIcon = STATUS_ICON[row.status]
        const mode = row.router ? 'Cashbridge Router' : 'Manual'
        return (
          <li key={row.key} className="scan-row" data-status={row.status} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
            <span className="scan-status" role="img" aria-label={statusText} data-tip={statusText}>
              <StatusIcon size={18} aria-hidden />
            </span>
            <Side side={row.from} />
            <span className="scan-arrow" aria-hidden>
              <ArrowRight size={14} />
            </span>
            <Side side={row.to} />
            <ol className="scan-legs" aria-label="Transactions">
              {row.legs.map(leg => (
                <li key={leg.label + leg.hash}>
                  <a
                    href={leg.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${leg.label}, ${shortHash(leg.hash)}`}
                    data-tip={`${leg.label} · ${shortHash(leg.hash)}`}
                  >
                    {leg.icon ? <Img src={leg.icon} size={18} /> : <ArrowRight size={12} aria-hidden />}
                  </a>
                </li>
              ))}
            </ol>
            <span className="scan-meta">
              <span className="scan-mode" role="img" aria-label={mode} data-tip={mode} data-router={row.router || undefined}>
                {row.router ? <Zap size={14} aria-hidden /> : <Wallet size={14} aria-hidden />}
              </span>
              {row.verified && (
                <span className="scan-mode" role="img" aria-label="Verified on explorers" data-tip="Verified on explorers">
                  <BadgeCheck size={14} aria-hidden />
                </span>
              )}
              {row.time !== undefined && now !== undefined ? (
                <time dateTime={new Date(row.time).toISOString()} title={new Date(row.time).toLocaleString()}>
                  {ago(row.time, now)}
                </time>
              ) : (
                row.date && <span>{row.date}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
