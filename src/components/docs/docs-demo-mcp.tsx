'use client'

import { useId, useState } from 'react'

const TOOLS = [
  {
    name: 'list_supported_assets',
    tag: 'read-only',
    blurb: 'Lists BCH / Cauldron tokens and assets other chains can bridge.',
    example: null
  },
  {
    name: 'get_bridge_quote',
    tag: 'read-only',
    blurb: 'Quotes THORChain and NEAR Intents for plain BCH; CashToken quotes add the Cauldron leg the Router settles.',
    example: `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_bridge_quote",
    "arguments": {
      "from_asset": "BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913",
      "to_asset": "PUSD",
      "amount": "25"
    }
  }
}`
  },
  {
    name: 'prepare_bridge',
    tag: 'unsigned',
    blurb: 'Returns unsigned deposit instructions for the user wallet. Opens a Router order for CashTokens. Does not create live orders unless you call it.',
    example: null
  },
  {
    name: 'report_source_transaction',
    tag: 'tracks',
    blurb: 'Attaches the source tx hash to a Router order or NEAR deposit so matching is faster.',
    example: null
  },
  {
    name: 'get_bridge_status',
    tag: 'read-only',
    blurb: 'Reads Router / NEAR / THORChain status. Read-only; holds no keys.',
    example: null
  }
] as const

export function DocsDemoMcp() {
  const labelId = useId()
  const [open, setOpen] = useState<string | null>('get_bridge_quote')

  return (
    <section className="docs-demo docs-demo-mcp" aria-labelledby={labelId}>
      <header className="docs-demo-head">
        <div>
          <p className="docs-demo-kicker">Interactive demo</p>
          <h3 id={labelId}>MCP agent tools</h3>
          <p>
            Expand a tool for its role. Sample JSON is read-only. Sale prepare and NEAR→CashToken prepare are unsupported on MCP; use the site.
          </p>
        </div>
        <p className="docs-demo-endpoint">
          <span>Endpoint</span>
          <code>https://www.cashbridge.space/mcp</code>
        </p>
      </header>

      <ul className="docs-demo-tools">
        {TOOLS.map(tool => {
          const expanded = open === tool.name
          return (
            <li key={tool.name} data-expanded={expanded ? 'true' : undefined}>
              <button type="button" className="docs-demo-tool" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : tool.name)}>
                <span className="docs-demo-tool-row">
                  <code>{tool.name}</code>
                  <span className={`docs-demo-tool-tag docs-demo-tool-tag-${tool.tag}`}>{tool.tag}</span>
                  <span className="docs-demo-tool-chevron" aria-hidden="true">
                    {expanded ? '−' : '+'}
                  </span>
                </span>
                <span>{tool.blurb}</span>
              </button>
              {expanded && tool.example && (
                <pre className="docs-demo-tool-example">
                  <code>{tool.example}</code>
                </pre>
              )}
              {expanded && !tool.example && (
                <p className="docs-demo-hint">
                  Expand <code>get_bridge_quote</code> for a read-only sample request. <code>prepare_bridge</code> returns unsigned data for the user to sign — it does not broadcast, and this demo never calls it.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
