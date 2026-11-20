import { NextRequest, NextResponse } from 'next/server'
import { AppConfig } from '@/config'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { readRequestBody } from '@/lib/request-body'
import { TOOLS, ToolError, type ToolContext } from '@/server/agent/tools'

// Cash Bridge's MCP server for AI agents: Streamable HTTP, stateless, one JSON answer per POST, no sessions and no
// SSE stream. Batches are not taken: the versions offered here are the ones that dropped JSON-RPC batching.
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18']
// Per client IP over ten minutes (src/lib/rate-limit.ts): every request, and the order writes among them.
export const REQUEST_LIMIT = 60
export const WRITE_LIMIT = 10
const MAX_BODY_BYTES = 16 * 1024

export const SERVER_INFO = { name: 'cash-bridge', title: 'Cash Bridge', version: '1.0.0', websiteUrl: AppConfig.baseUrl }

const INSTRUCTIONS = `Cash Bridge moves assets from other chains to Bitcoin Cash and its CashTokens (PUSD and other Cauldron tokens), and from BCH back. Routes: THORChain, NEAR Intents and ShapeShift where available, for plain BCH, CashTokens (settled through the Cashbridge Router when it admits the route) and Any-network free pairs (two non-BCH assets). Flow: list_supported_assets, get_bridge_quote, show the quote to the user, prepare_bridge with the chosen route, let the user sign in their own wallet, then report_source_transaction and get_bridge_status. This server holds no keys and never signs or sends; it returns unsigned transactions or deposit instructions. Quotes expire within minutes. Confirm every address with the user. Cash Bridge charges no fee of its own. Docs: ${AppConfig.baseUrl}/docs/agents`

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version',
  'Cache-Control': 'no-store'
}

export const serverCard = () => ({
  protocolVersion: PROTOCOL_VERSIONS[0],
  serverInfo: SERVER_INFO,
  description: 'Quotes and prepares non-custodial transfers to and from Bitcoin Cash and CashTokens (THORChain, NEAR Intents, ShapeShift, Cauldron, Cashbridge Router). Never signs.',
  documentationUrl: `${AppConfig.baseUrl}/docs/agents`,
  transport: { type: 'streamable-http', endpoint: `${AppConfig.baseUrl}/mcp` },
  authentication: { required: false },
  rateLimit: `${REQUEST_LIMIT} requests and ${WRITE_LIMIT} order writes per 10 minutes per client IP`,
  capabilities: { tools: { listChanged: false } },
  tools: TOOLS.map(({ name, title, description }) => ({ name, title, description }))
})

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
const result = (id: unknown, value: unknown) => ({ jsonrpc: '2.0', id, result: value })
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...headers } })

async function handle(message: Message, context: ToolContext) {
  const { id, method, params } = message
  const args = (params && typeof params === 'object' && !Array.isArray(params) ? params : {}) as Record<string, unknown>
  if (method === 'initialize') {
    const asked = args.protocolVersion
    return result(id, {
      protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS
    })
  }
  if (method === 'ping') return result(id, {})
  if (method === 'tools/list') return result(id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) })
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === args.name)
    if (!tool) return failure(id, -32602, `Unknown tool: ${String(args.name)}`)
    const input = args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? (args.arguments as Record<string, unknown>) : {}
    try {
      const data = await tool.run(input, context)
      return result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data })
    } catch (error) {
      // A wrong argument or an upstream refusal is the agent's to read and act on, so it comes back as a tool result.
      const text = error instanceof ToolError ? error.message : 'The tool failed; try again shortly'
      if (!(error instanceof ToolError)) console.error('MCP tool failed', tool.name, error)
      return result(id, { content: [{ type: 'text', text }], isError: true })
    }
  }
  return failure(id, -32601, `Method not found: ${String(method)}`)
}

export async function mcpPost(req: NextRequest) {
  const retryAfter = rateLimit(req, 'mcp', REQUEST_LIMIT)
  if (retryAfter !== null) return reply(failure(null, -32000, 'Rate limit exceeded'), 429, { 'Retry-After': String(retryAfter) })
  const body = await readRequestBody(req, MAX_BODY_BYTES)
  if (typeof body !== 'string') return reply(failure(null, -32600, `Request body over ${MAX_BODY_BYTES} bytes or unreadable`), body.status)
  let message: unknown
  try {
    message = JSON.parse(body)
  } catch {
    return reply(failure(null, -32700, 'Parse error'), 400)
  }
  if (Array.isArray(message)) return reply(failure(null, -32600, 'Batches are not supported; send one JSON-RPC message per request'), 400)
  if (!message || typeof message !== 'object' || (message as Message).jsonrpc !== '2.0' || typeof (message as Message).method !== 'string')
    return reply(failure((message as Message | null)?.id, -32600, 'Invalid JSON-RPC request'), 400)
  // Notifications and responses from the client carry no id and get no answer.
  if ((message as Message).id === undefined || (message as Message).id === null) return new NextResponse(null, { status: 202, headers: CORS_HEADERS })
  const context: ToolContext = { ip: clientIp(req), allowWrite: () => rateLimit(req, 'mcp-write', WRITE_LIMIT) === null }
  return reply(await handle(message as Message, context))
}

// Stateless, so there is no stream to open; any other GET (a browser, a crawler) gets the server card.
export function mcpGet(req: NextRequest) {
  if ((req.headers.get('accept') ?? '').includes('text/event-stream')) return reply({ error: 'This MCP endpoint has no SSE stream; send JSON-RPC by POST.' }, 405, { Allow: 'POST' })
  return reply(serverCard())
}

export const mcpOptions = () => new NextResponse(null, { status: 204, headers: CORS_HEADERS })
