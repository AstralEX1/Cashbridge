import { createHash } from 'node:crypto'
import { AppConfig } from '@/config'
import { REQUEST_LIMIT, WRITE_LIMIT } from '@/server/agent/mcp'
import { TOOLS } from '@/server/agent/tools'

// What an AI agent needs to use Cash Bridge, written from the live tool definitions: the MCP config, a prompt for any
// assistant, and the same prompt as an Agent Skill that `npx skills add <site>` installs from the well-known index.
export const MCP_URL = `${AppConfig.baseUrl}/mcp`
export const MCP_CONFIG = JSON.stringify({ mcpServers: { 'cash-bridge': { type: 'http', url: MCP_URL } } }, null, 2)
export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http cash-bridge ${MCP_URL}`
export const SKILL_INSTALL_COMMAND = `npx skills add ${AppConfig.baseUrl}`

export const AGENT_RULES = [
  "This server holds no keys and never signs or sends. prepare_bridge returns unsigned transactions or deposit instructions for the user's wallet.",
  'Show the quote, the destination address and the deposit to the user before they sign.',
  'Quotes and deposits expire within minutes. Never reuse a deposit after its expires_at.',
  'Never ask for a seed phrase or a private key.',
  'A Cashbridge Router order returns an order token. Keep it: it is the only way to read the order later.'
]

const signature = ({ name, inputSchema }: (typeof TOOLS)[number]) => {
  const { properties = {}, required = [] } = inputSchema as { properties?: Record<string, unknown>; required?: string[] }
  return `${name}(${Object.keys(properties)
    .map(key => (required.includes(key) ? key : `${key}?`))
    .join(', ')})`
}

const callExample = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'get_bridge_quote',
    arguments: { from_asset: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', to_asset: 'PUSD', amount: '25' }
  }
})

export const AGENT_PROMPT = `# Cash Bridge

Cash Bridge moves assets from other chains to Bitcoin Cash (BCH) and its CashTokens (PUSD, MUSD and other Cauldron tokens), and from BCH back. Routes: THORChain, NEAR Intents and ShapeShift. For a CashToken the Cashbridge Router buys or sells it on Cauldron. The user signs every transaction in their own wallet. Cash Bridge charges no fee of its own.

## Connect

MCP server: ${MCP_URL} (Streamable HTTP, JSON answers, no API key).
Without an MCP client, POST one JSON-RPC 2.0 message per request to the same URL, for example:
${callExample}

## Tools

${TOOLS.map(tool => `- ${signature(tool)}: ${tool.description}`).join('\n')}

## Steps

1. Find both assets with list_supported_assets. Other chains use THORChain names (ETH.ETH, BASE.USDC-0X8335…). The BCH side is BCH.BCH, a ticker such as PUSD, or a category id. Amounts are decimal strings.
2. get_bridge_quote, then show the user the routes, the expected and minimum output.
3. Ask for the source address (refunds go there) and the destination address. A CashToken needs a token-aware bitcoincash:z… address. Read both back to the user.
4. When the user agrees, call prepare_bridge with the route they chose (thorchain, near_intents or shapeshift).
5. The user signs and sends from their own wallet.
6. report_source_transaction with the transaction hash, then get_bridge_status until the transfer settles.

## Rules

${AGENT_RULES.map(rule => `- ${rule}`).join('\n')}
- Limits: ${REQUEST_LIMIT} requests and ${WRITE_LIMIT} order writes per 10 minutes per IP. On HTTP 429 wait for Retry-After.

Docs: ${AppConfig.baseUrl}/docs/agents
`

export const SKILL_NAME = 'cash-bridge'
export const SKILL_PATH = `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`
// A plain YAML scalar: no ": " and no leading quote, or the frontmatter stops parsing.
const SKILL_DESCRIPTION =
  "Bridge assets between other chains and Bitcoin Cash (BCH) or CashTokens such as PUSD with Cash Bridge. Quotes a transfer, prepares an unsigned deposit for the user's own wallet and tracks it. Use when the user wants to move funds to or from BCH, buy or sell a CashToken from another chain, or check a Cash Bridge transfer."

export const SKILL_MD = `---
name: ${SKILL_NAME}
description: ${SKILL_DESCRIPTION}
---

${AGENT_PROMPT}`

// Agent Skills discovery index (schema 0.2.0), read by `npx skills add` from /.well-known/agent-skills/index.json.
export const SKILL_INDEX = {
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: SKILL_NAME,
      type: 'skill-md',
      description: SKILL_DESCRIPTION,
      url: SKILL_PATH,
      digest: `sha256:${createHash('sha256').update(SKILL_MD).digest('hex')}`
    }
  ]
}
