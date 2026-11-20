import { AppConfig } from '@/config'
import { AGENT_RULES, CLAUDE_CODE_COMMAND, SKILL_INSTALL_COMMAND } from '@/server/agent/kit'
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

Add it to Claude Code: \`${CLAUDE_CODE_COMMAND}\`
Install it as an Agent Skill (Claude Code, Codex, Cursor and more): \`${SKILL_INSTALL_COMMAND}\`

Tools:
${TOOLS.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

Rules:
${AGENT_RULES.map(rule => `- ${rule}`).join('\n')}

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
