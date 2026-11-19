import { NextResponse } from 'next/server'
import { readOrderFeed } from '@/server/auto-bridge/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

// The Cashbridge Router's newest orders for the scanner page. `orders: null` means the Router could not be read;
// the page still lists the verified runs. The CDN keeps an answer briefly, so page views do not reach the Router.
export async function GET() {
  const orders = (await readOrderFeed()) ?? null
  return NextResponse.json(
    { orders },
    { headers: { 'Cache-Control': orders ? 'public, s-maxage=30, stale-while-revalidate=120' : 'public, s-maxage=10' } }
  )
}
