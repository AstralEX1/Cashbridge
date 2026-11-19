import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The Router runs under tools/register-typescript.mjs, which only strips types: a type imported as a value
// passes the tests' own loader but stops the worker at start.
test('the Router worker modules load under the loader it runs with', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const modules = ['src/server/auto-bridge/runtime.ts', 'src/server/auto-bridge/http.ts', 'src/server/auto-bridge/worker.ts', 'src/server/auto-bridge/gateway.ts', 'src/lib/cauldron.ts', 'src/lib/near-intents.ts']
  const script = `for (const m of ${JSON.stringify(modules)}) await import('./' + m)`
  const run = () => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', './tools/register-typescript.mjs', '--input-type=module', '-e', script], { cwd: root, stdio: 'pipe' })
  assert.doesNotThrow(run)
})
