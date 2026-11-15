import { NextRequest } from 'next/server'
import { apiError } from '@/lib/api-error'

// Catch-all for unknown /api/* paths so callers always get a JSON error
// instead of the HTML 404 page.
function handler(req: NextRequest) {
  return apiError(
    404,
    'not_found',
    `No API endpoint at ${req.nextUrl.pathname}`,
    'This site only serves the API routes its own bridge pages call.'
  )
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD
}
