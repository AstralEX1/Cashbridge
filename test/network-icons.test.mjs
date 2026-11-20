// Every chain the picker, wallets and ShapeShift/NEAR maps can show must have a mark under public/networks.
// Run: node --no-warnings --import ./test/register-ts-alias.mjs --test test/network-icons.test.mjs
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ALL_CHAINS } from '../src/components/connect-wallet/config.tsx'
import { PRIVATE_SWAP_CHAINS } from '../src/hooks/use-assets.ts'
import { nearMappedChains } from '../src/lib/near-intents.ts'
import { shapeShiftMappedPrefixes } from '../src/lib/shapeshift.ts'
import { supportedChains } from '../src/lib/wallets.ts'

const networks = join(dirname(fileURLToPath(import.meta.url)), '../public/networks')
const icon = code => join(networks, `${String(code).toLowerCase()}.svg`)

test('NEAR Intents mapped chains each have a network SVG', () => {
  for (const chain of nearMappedChains()) {
    assert.equal(existsSync(icon(chain)), true, `missing /networks/${chain.toLowerCase()}.svg`)
  }
})

test('NEAR Intents source chains each have a wallet that can send the deposit', () => {
  const sendable = new Set(Object.values(supportedChains).flat())
  for (const chain of nearMappedChains()) assert.equal(sendable.has(chain), true, `no wallet can send from ${chain}`)
})

test('ShapeShift mapped prefixes each have a network SVG', () => {
  for (const prefix of shapeShiftMappedPrefixes()) {
    assert.equal(existsSync(icon(prefix)), true, `missing /networks/${prefix.toLowerCase()}.svg`)
  }
})

test('wallet and private-tab chains each have a network SVG', () => {
  for (const chain of [...new Set([...ALL_CHAINS, ...PRIVATE_SWAP_CHAINS])]) {
    assert.equal(existsSync(icon(chain)), true, `missing /networks/${String(chain).toLowerCase()}.svg`)
  }
})
