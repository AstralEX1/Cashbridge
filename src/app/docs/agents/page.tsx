import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsDemoMcp } from '@/components/docs/docs-demo-mcp'
import { AppConfig } from '@/config'
import { Callout, DocsArticle, Step, Steps } from '@/components/docs/docs-ui'
import { REQUEST_LIMIT, WRITE_LIMIT } from '@/server/agent/mcp'
import { TOOLS } from '@/server/agent/tools'

export const metadata: Metadata = {
  title: 'AI agents (MCP)',
  alternates: { canonical: '/docs/agents' }
}

const endpoint = `${AppConfig.baseUrl}/mcp`
const desktopConfig = JSON.stringify({ mcpServers: { 'cash-bridge': { type: 'http', url: endpoint } } }, null, 2)
const curlExample = `curl -s ${endpoint} \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_bridge_quote","arguments":{"from_asset":"BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913","to_asset":"PUSD","amount":"25"}}}'`

export default function Page() {
  return (
    <DocsArticle
      href="/docs/agents"
      title="Use Cash Bridge from an AI agent"
      lead="Cash Bridge runs an MCP server so an assistant can quote a transfer, prepare an unsigned deposit for the user to sign, and follow status. The server holds no keys."
    >
      <DocsDemoMcp />

      <h2 id="connect">Connect</h2>
      <p>
        The server is at <code>{endpoint}</code>. It speaks MCP over Streamable HTTP, answers with one JSON response per request, and needs no account or API key.
      </p>
      <p>In Claude Code:</p>
      <pre>
        <code>{`claude mcp add --transport http cash-bridge ${endpoint}`}</code>
      </pre>
      <p>In Claude Desktop, Cursor and other clients that read an <code>mcpServers</code> file:</p>
      <pre>
        <code>{desktopConfig}</code>
      </pre>

      <h2 id="tools">Tools</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map(tool => (
            <tr key={tool.name}>
              <td>
                <code>{tool.name}</code>
              </td>
              <td>{tool.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Assets use THORChain-style names (<code>ETH.ETH</code>, <code>BASE.USDC-0X8335…</code>). The Bitcoin Cash side is <code>BCH.BCH</code>, a ticker such as <code>PUSD</code>, or a category id. Amounts are decimal strings in the asset&apos;s units.
      </p>

      <h2 id="flow">A transfer, step by step</h2>
      <Steps>
        <Step title="Quote">
          <code>get_bridge_quote</code> returns what the user would receive. To or from plain BCH it compares THORChain, NEAR Intents and ShapeShift when available. Into a CashToken it prices Router settlement (THORChain and NEAR when admitted). Any-network free pairs compare THORChain with ShapeShift. CashToken sales are priced too.
        </Step>
        <Step title="Ask the user">Show amounts, route and destination; continue only when the user agrees.</Step>
        <Step title="Prepare">
          <code>prepare_bridge</code> returns unsigned EVM transactions (approval + deposit) or deposit instructions (THORChain vault + memo, NEAR Intents or ShapeShift deposit address). For a CashToken purchase or sale it opens a Cashbridge Router order and returns id + order token. It never signs or broadcasts.
        </Step>
        <Step title="Sign and send">The user signs in their own wallet.</Step>
        <Step title="Track">
          <code>report_source_transaction</code> attaches the source hash; <code>get_bridge_status</code> follows the transfer.
        </Step>
      </Steps>

      <h2 id="safety">Who signs, and what is checked</h2>
      <Callout kind="note" title="The server holds no keys">
        Whatever it prepares still has to be signed by the user. Do not ask the agent for seeds or private keys.
      </Callout>
      <ul>
        <li>EVM deposits are built from current THORChain router / vault / memo data. Stale vaults or memos that do not pay the destination get no transaction.</li>
        <li>With a Router order, the memo must pay the order contract, and the server checks that contract matches the order terms — the same rebuild the site does.</li>
        <li>A Router order can only buy at least its minimum for the recipient, or send BCH back. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.</li>
        <li>The order token is the capability for that order; keep it with the transfer.</li>
        <li>Quotes and deposit addresses expire within minutes. After <code>expires_at</code>, prepare again.</li>
      </ul>

      <h2 id="limits">Limits</h2>
      <ul>
        <li>
          {REQUEST_LIMIT} requests per 10 minutes per client IP, and {WRITE_LIMIT} Router order writes among them. Past that: HTTP 429 with <code>Retry-After</code>.
        </li>
        <li>One JSON-RPC message per request; batches are not accepted.</li>
        <li>
          <strong>CashToken sales</strong> prepare through the Cashbridge Router when it admits sale orders (<code>route: thorchain</code>). The response may include an unsigned BCH token-send when UTXOs are visible, otherwise deposit instructions.
        </li>
        <li>
          <strong>NEAR → CashToken:</strong> use <code>route: near_intents</code> when the Router admits NEAR orders; 1Click still pays the order address in plain BCH, then the Router buys the token. Otherwise use <code>route: thorchain</code>.
        </li>
        <li>
          <strong>ShapeShift</strong> is available on plain BCH pairs when both assets map, and on Any-network free pairs beside THORChain. Track with <code>shapeshift_quote_id</code>.
        </li>
        <li>
          Cash Bridge charges no fee of its own. Networks, THORChain, NEAR Intents, ShapeShift and Cauldron still charge — <Link href="/docs/fees">Fees and limits</Link>.
        </li>
      </ul>

      <h2 id="without-mcp">Without an MCP client</h2>
      <p>Plain JSON-RPC over HTTP:</p>
      <pre>
        <code>{curlExample}</code>
      </pre>

      <h2 id="discovery">For language models</h2>
      <ul>
        <li>
          <a href="/llms.txt">/llms.txt</a> — short site + tools summary.
        </li>
        <li>
          <a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a> — MCP registry card.
        </li>
      </ul>
    </DocsArticle>
  )
}
