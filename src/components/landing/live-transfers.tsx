'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LiveDot } from '@/components/scanner/live-dot'
import { ScanList } from '@/components/scanner/scan-list'
import { useScanFeed } from '@/components/scanner/use-scan-feed'

// The newest transfers from the scanner feed.
export function LiveTransfers({ count = 4 }: { count?: number }) {
  const { rows, now, live } = useScanFeed()
  return (
    <>
      <div className="landing-section-head">
        <h2 id="scanner-title">
          Live transfers <LiveDot live={live} />
        </h2>
        <Link href="/scanner" className="landing-button landing-button-ghost">
          Scanner <ArrowRight size={18} aria-hidden />
        </Link>
      </div>
      <div className="landing-scan">
        <ScanList rows={rows.slice(0, count)} now={now} />
      </div>
    </>
  )
}
