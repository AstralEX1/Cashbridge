import { forwardOrder } from '@/server/auto-bridge/proxy'
import type { NextRequest } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Above the proxy's 12 s upstream deadline, so Vercel never cuts the request off with an HTML error page first.
export const maxDuration = 20
export async function POST(req: NextRequest) {
  return forwardOrder(req)
}
