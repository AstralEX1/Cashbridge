import { NextResponse } from 'next/server'
import { CORS_HEADERS, serverCard } from '@/server/agent/mcp'

export const GET = () => NextResponse.json(serverCard(), { headers: CORS_HEADERS })
