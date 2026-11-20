'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, MessageSquareText, Plug, Puzzle } from 'lucide-react'

// The landing's agent setup: MCP config, a prompt for any assistant, and the same prompt as an installable skill,
// each copied in one click. The texts come from src/server/agent/kit.ts.
export type AgentKitItem = { id: 'mcp' | 'prompt' | 'skill'; label: string; file: string; command?: string; text: string; download?: string }

const ICONS = { mcp: Plug, prompt: MessageSquareText, skill: Puzzle }

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return // No clipboard (an insecure page, a denied permission): the text stays on screen to select.
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button type="button" className="agent-kit-icon" onClick={copy} aria-label={label} data-copied={copied || undefined}>
      <Copy size={16} aria-hidden />
      <Check size={16} aria-hidden />
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

export function AgentKit({ items }: { items: AgentKitItem[] }) {
  const [active, setActive] = useState(items[0].id)
  const item = items.find(i => i.id === active) ?? items[0]
  return (
    <div className="agent-kit">
      <div className="agent-kit-tabs" role="group" aria-label="Setup">
        {items.map(({ id, label }) => {
          const Icon = ICONS[id]
          return (
            <button key={id} type="button" aria-pressed={id === active} onClick={() => setActive(id)}>
              <Icon size={16} aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
      {item.command && (
        <div className="agent-kit-command">
          <span aria-hidden>$</span>
          <code>{item.command}</code>
          <CopyButton key={item.id} text={item.command} label="Copy command" />
        </div>
      )}
      <div className="agent-kit-file">
        <p className="agent-kit-name">{item.file}</p>
        <pre tabIndex={0} aria-label={item.file}>
          <code>{item.text}</code>
        </pre>
        <div className="agent-kit-actions">
          {item.download && (
            <a className="agent-kit-icon" href={item.download} download={item.file} aria-label={`Download ${item.file}`}>
              <Download size={16} aria-hidden />
            </a>
          )}
          <CopyButton key={item.id} text={item.text} label={`Copy ${item.file}`} />
        </div>
      </div>
    </div>
  )
}
