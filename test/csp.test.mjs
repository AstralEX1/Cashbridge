// The site's Content Security Policy: only nonced scripts (and what they load) run in production.
// Run: npm run test:bridge (or node --test this file with the TS alias register).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { contentSecurityPolicy } from '../src/lib/csp.ts'

const directives = policy => Object.fromEntries(policy.split('; ').map(part => { const [name, ...values] = part.split(' '); return [name, values] }))

test('production scripts need the request nonce; nothing may eval, embed the site or load plugins', () => {
  const policy = directives(contentSecurityPolicy('abc123=='))
  assert.deepEqual(policy['script-src'].slice(0, 4), ["'self'", "'nonce-abc123=='", "'strict-dynamic'", "'wasm-unsafe-eval'"])
  assert.ok(!policy['script-src'].includes("'unsafe-eval'"))
  assert.deepEqual(policy['object-src'], ["'none'"])
  assert.deepEqual(policy['frame-ancestors'], ["'none'"])
  assert.deepEqual(policy['base-uri'], ["'self'"])
  assert.ok(directives(contentSecurityPolicy('n', true))['script-src'].includes("'unsafe-eval'"))
})

test('every page gets a fresh nonce, and the inline scripts the app adds itself carry it', async () => {
  const { proxy, config } = await import('../src/proxy.ts')
  const nonceOf = response => response.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1]
  const request = () => new Request('https://www.cashbridge.space/bridge')
  const [a, b] = [proxy(request()), proxy(request())]
  assert.notEqual(nonceOf(a), nonceOf(b))
  assert.ok(nonceOf(a).length >= 24)
  const source = new RegExp(config.matcher[0].source.replace(/^\//, '^/') + '$')
  for (const path of ['/', '/bridge', '/scanner', '/docs/mainnet', '/sell-PUSD-buy-BASE.USDC']) assert.ok(source.test(path), path)
  for (const path of ['/api/auto-bridge/orders', '/mcp', '/_next/static/chunks/a.js', '/landing/cashbridge-promo.mp4', '/llms.txt']) assert.ok(!source.test(path), path)
  assert.match(readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8'), /<ThemeProvider[^>]*nonce=\{nonce\}/)
  assert.match(readFileSync(new URL('../src/lib/near-connect-wallet.ts', import.meta.url), 'utf8'), /cspNonce: pageNonce\(\)/)
})
