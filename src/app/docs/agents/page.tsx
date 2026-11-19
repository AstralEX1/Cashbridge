import type { Metadata } from 'next'
import Link from 'next/link'
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
      lead="Cash Bridge runs an MCP server, so an AI assistant or agent can quote a transfer to Bitcoin Cash or a CashToken, prepare it, and follow it to the end. The agent never gets a key: the user signs in their own wallet, as on the site."
    >
      <h2 id="connect">Connect</h2>
      <p>
        The server is at <code>{endpoint}</code>. It speaks MCP over Streamable HTTP, answers every request with one JSON response, and needs no account or API key.
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
        Assets use THORChain&apos;s names, such as <code>ETH.ETH</code> or <code>BASE.USDC-0X8335…</code>. The Bitcoin Cash side is <code>BCH.BCH</code>, a token&apos;s ticker such as <code>PUSD</code>, or its category id. Amounts are decimal strings in the asset&apos;s own units.
      </p>

      <h2 id="flow">A transfer, step by step</h2>
      <Steps>
        <Step title="Quote">
          <code>get_bridge_quote</code> returns what the user would receive. Into plain BCH it compares THORChain with NEAR Intents and names the better one. Into a CashToken it adds the Cauldron leg that the Cashbridge Router takes care of.
        </Step>
        <Step title="Ask the user">The agent shows the amounts, the route and the destination address, and goes on only when the user agrees.</Step>
        <Step title="Prepare">
          <code>prepare_bridge</code> returns, for an EVM chain, the unsigned transactions to sign: the token approval when one is needed, then the deposit. For other chains it returns the deposit address, the amount and the memo. For a CashToken it also opens a Cashbridge Router order and returns its id and order token.
        </Step>
        <Step title="Sign and send">The user signs in their own wallet. The agent never sees a private key or a seed phrase.</Step>
        <Step title="Track">
          With a Router order, <code>report_source_transaction</code> tells the Cashbridge Router which transaction paid it. <code>get_bridge_status</code> then shows where the transfer is until the tokens or the BCH arrive.
        </Step>
      </Steps>

      <h2 id="safety">Who signs, and what is checked</h2>
      <Callout kind="note" title="The server holds no keys">
        It never signs or sends a transaction. Whatever it prepares still has to be signed by the user.
      </Callout>
      <ul>
        <li>Before an EVM transaction is handed out, the server checks it against THORChain itself: it must call the chain&apos;s current THORChain router, pay the current vault, carry the quoted memo and move the quoted asset. A transaction that fails any check is not returned.</li>
        <li>The memo must pay the destination that was asked for. With a Router order, it must pay the order&apos;s contract, and the server checks that contract is built from the order&apos;s own terms, exactly as the site does.</li>
        <li>A Router order can only buy at least its minimum of the token for the recipient, or send the BCH back to them. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.</li>
        <li>The order token is the only key to a Router order. The agent should keep it with the transfer; it is not shown again.</li>
        <li>Quotes and deposit addresses expire within minutes. After <code>expires_at</code>, prepare a new one rather than reuse it.</li>
      </ul>

      <h2 id="limits">Limits</h2>
      <ul>
        <li>
          {REQUEST_LIMIT} requests per 10 minutes for each client IP, and {WRITE_LIMIT} Router order writes among them. Past that, the server answers 429 with a <code>Retry-After</code> header.
        </li>
        <li>One JSON-RPC message per request; batches are not taken.</li>
        <li>Selling a CashToken back from BCH is prepared on the site only for now. The quote tool still prices it.</li>
        <li>
          Cash Bridge charges no fee of its own. The networks, THORChain, NEAR Intents and the Cauldron pools charge theirs, as on <Link href="/docs/fees">Fees and limits</Link>.
        </li>
      </ul>

      <h2 id="without-mcp">Without an MCP client</h2>
      <p>The endpoint is plain JSON-RPC over HTTP, so any script can call a tool:</p>
      <pre>
        <code>{curlExample}</code>
      </pre>

      <h2 id="discovery">For language models</h2>
      <ul>
        <li>
          <a href="/llms.txt">/llms.txt</a> sums up the site and the tools for a language model.
        </li>
        <li>
          <a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a> describes the server for MCP registries.
        </li>
      </ul>
    </DocsArticle>
  )
}
