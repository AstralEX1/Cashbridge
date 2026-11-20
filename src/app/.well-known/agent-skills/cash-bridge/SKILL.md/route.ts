import { SKILL_MD } from '@/server/agent/kit'

// The index's digest covers these exact bytes, so the body is the string as built.
export const GET = () =>
  new Response(SKILL_MD, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' }
  })
