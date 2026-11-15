import { forwardOrder } from '@/server/auto-bridge/proxy'
import type { NextRequest } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  return forwardOrder(req)
}
