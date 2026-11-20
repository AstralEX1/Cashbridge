import { NextResponse } from 'next/server'
import { SKILL_INDEX } from '@/server/agent/kit'

export const GET = () => NextResponse.json(SKILL_INDEX, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } })
