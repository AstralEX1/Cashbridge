import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy } from '@/lib/csp'

// Every page gets a fresh nonce; Next.js reads it from the request's policy and puts it on the scripts it renders.
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development')
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

// Pages only: not the APIs, the MCP endpoint, build assets or files in public/, nor link prefetches.
export const config = {
  matcher: [
    {
      // Pair links end in a ticker (/sell-PUSD-buy-BASE.USDC), so only real file extensions are left out.
      source: '/((?!api|mcp|_next/static|_next/image|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|txt|json|xml|webmanifest|woff2?|otf|ttf|css|js|map)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
}
