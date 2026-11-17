import { NextRequest, NextResponse } from 'next/server'
import { apiError, methodNotAllowed } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOrigin } from '@/lib/same-origin'
import { readRequestBody } from '@/lib/request-body'
import { addressDashboard, broadcast, rawTransaction, Rejected, transactionDashboard, UTXO_CHAINS, unspentOutputs } from '@/lib/utxo-api'

// The UTXO toolbox speaks Blockchair's URL dialect (`envs.blockchairApiUrl`, see src/lib/wallets.ts) and so
// does this app's own transaction lookup. This route keeps that dialect but answers it from keyless public
// explorers (src/lib/utxo-api.ts), so there is no API key and no paid plan behind it. Only the endpoints the
// toolbox and the status checks use are served: address, transaction and raw transaction dashboards,
// unspent outputs and broadcast.
const ADDRESS = /^[A-Za-z0-9]{20,100}$/
const HASH = /^[0-9a-fA-F]{64}$/
const HEX = /^(?:[0-9a-fA-F]{2})+$/

function badPath() {
  return apiError(
    404,
    'not_found',
    'Unsupported UTXO path',
    'This proxy only serves the address, transaction, raw transaction, outputs and push endpoints for the supported UTXO chains.'
  )
}

function badRequest(message: string) {
  return apiError(400, 'bad_request', message, 'Check the address, transaction hash or hex and try again.')
}

const answer = (data: unknown) => NextResponse.json({ data, context: { code: 200 } }, { headers: { 'Cache-Control': 'no-store' } })

async function serve(req: NextRequest, path: string[], method: 'GET' | 'POST') {
  if (!isSameOrigin(req)) {
    return apiError(403, 'forbidden', 'Cross-origin requests are not allowed', 'This proxy only serves the Cash Bridge frontend.')
  }

  const retryAfter = rateLimit(req, 'blockchair', 300)
  if (retryAfter !== null) {
    return apiError(429, 'rate_limited', 'Too many requests', `Retry after ${retryAfter} seconds (see the Retry-After header).`, {
      'Retry-After': String(retryAfter)
    })
  }

  // Next hands catch-all segments over decoded, so `%2f` arrives as a literal slash: no segment may carry one.
  const [chain, ...rest] = path
  if (!Object.hasOwn(UTXO_CHAINS, chain) || rest.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('/'))) return badPath()
  const { network } = UTXO_CHAINS[chain]
  const [a, b, target] = rest

  try {
    if (method === 'POST') {
      if (rest.join('/') !== 'push/transaction') return badPath()
      const body = await readRequestBody(req, 2 * 1024 * 1024)
      if (typeof body !== 'string') return body
      let hex: unknown
      try {
        hex = JSON.parse(body).data
      } catch {}
      if (typeof hex !== 'string' || !HEX.test(hex)) return badRequest('Send {"data": "<raw transaction hex>"}')
      return answer(await broadcast(chain, hex))
    }

    if (rest.length === 3 && a === 'dashboards' && b === 'transaction') return HASH.test(target) ? answer(await transactionDashboard(chain, target)) : badRequest('Invalid transaction hash')
    if (rest.length === 3 && a === 'raw' && b === 'transaction') return HASH.test(target) ? answer(await rawTransaction(chain, target)) : badRequest('Invalid transaction hash')

    // Addresses need a script derivation, which only the chains with a network have.
    if (!network) return badPath()
    if (rest.length === 3 && a === 'dashboards' && b === 'address') return ADDRESS.test(target) ? answer(await addressDashboard(chain, target)) : badRequest('Invalid address')
    if (rest.length === 1 && a === 'outputs') {
      const params = req.nextUrl.searchParams
      const recipient = /recipient\((\w{20,100})\)/.exec(params.get('q') ?? '')?.[1]
      if (!recipient || !ADDRESS.test(recipient)) return badRequest('Query q must name one recipient(address)')
      const limit = Math.min(Math.max(Math.floor(Number(params.get('limit'))) || 30, 1), 100)
      const offset = Math.max(Math.floor(Number(params.get('offset'))) || 0, 0)
      return answer(await unspentOutputs(chain, recipient, limit, offset))
    }
    return badPath()
  } catch (error) {
    if (error instanceof Rejected) return badRequest(error.message)
    console.warn('[utxo]', chain, rest.join('/'), error instanceof Error ? error.message : error)
    return apiError(502, 'upstream_unreachable', 'The UTXO explorers are unreachable', 'None of the public explorers answered. Retry in a moment.')
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return serve(req, path, 'GET')
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return serve(req, path, 'POST')
}

export const PUT = methodNotAllowed(['GET', 'POST'])
export const PATCH = methodNotAllowed(['GET', 'POST'])
export const DELETE = methodNotAllowed(['GET', 'POST'])
