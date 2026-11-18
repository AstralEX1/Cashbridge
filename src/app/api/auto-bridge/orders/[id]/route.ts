import type { NextRequest } from 'next/server'
import { forwardOrder } from '@/server/auto-bridge/proxy'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Above the proxy's 12 s upstream deadline, so Vercel never cuts the request off with an HTML error page first.
export const maxDuration = 20
type Context = { params: Promise<{ id: string }> }
export async function GET(req: NextRequest, context: Context) {
  return forwardOrder(req, (await context.params).id)
}
export async function POST(req: NextRequest, context: Context) {
  return forwardOrder(req, (await context.params).id)
}
