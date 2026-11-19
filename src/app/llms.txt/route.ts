import { AppConfig } from '@/config'
import { REQUEST_LIMIT, WRITE_LIMIT } from '@/server/agent/mcp'
import { TOOLS } from '@/server/agent/tools'

// The site's summary for language models (llmstxt.org), with the MCP tools read from their definitions.
export const GET = () => {
  const site = AppConfig.baseUrl
  const body = `# Cash Bridge

> Cash Bridge moves assets from other chains to Bitcoin Cash (BCH) and its CashTokens, such as the PUSD stablecoin, and from BCH back. THORChain does the cross-chain swap; for a CashToken the Cashbridge Router buys it on Cauldron. Users sign every transaction in their own wallets. Cash Bridge charges no fee of its own.

## For AI agents

MCP server: ${site}/mcp (Streamable HTTP, stateless JSON, no authentication).
Limits: ${REQUEST_LIMIT} requests and ${WRITE_LIMIT} order writes per 10 minutes per client IP.
Server card: ${site}/.well-known/mcp/server-card.json

Add it to Claude Code: \`claude mcp add --transport http cash-bridge ${site}/mcp\`

Tools:
${TOOLS.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

Rules:
- This server holds no keys and never signs or sends. prepare_bridge returns unsigned transactions or deposit instructions for the user's wallet.
- Show the quote, the destination address and the deposit to the user before they sign.
- Quotes and deposits expire within minutes. Never reuse a deposit after its expires_at.
- Never ask for a seed phrase or a private key.
- A Cashbridge Router order returns an order token. Keep it: it is the only way to read the order later.

## Docs

- [The bridge](${site}/bridge): the web app, for what this server does not prepare
- [Use Cash Bridge from an AI agent](${site}/docs/agents)
- [How it works](${site}/docs/how-it-works)
- [Fees and limits](${site}/docs/fees)
- [Security and custody](${site}/docs/security)
- [Source code](${AppConfig.repoUrl})
`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
