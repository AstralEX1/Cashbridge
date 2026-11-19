import type { NextRequest } from 'next/server'
import { mcpGet, mcpOptions, mcpPost } from '@/server/agent/mcp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A Router order is a quote, the order and a second quote; each upstream call has its own deadline under this.
export const maxDuration = 60

export const POST = (req: NextRequest) => mcpPost(req)
export const GET = (req: NextRequest) => mcpGet(req)
export const OPTIONS = mcpOptions
