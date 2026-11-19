// The Send dialog's handler, run on its own with a stand-in wallet: the signed amount is the typed one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import { AssetValue } from '@tcswap/core'

// Compiles one `const` from a component file with the given names in scope, without mounting React.
function componentFunction(path, name, scope) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(declaration, `${name} exists in ${path}`)
  const js = ts.transpileModule(`const ${declaration.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return new Function(...Object.keys(scope), `${js}\nreturn ${name}`)(...Object.values(scope))
}

test('Send passes the exact typed amount to the wallet, not its float', async () => {
  for (const amount of ['9007199254740993', '0.123456789012345678']) {
    const sent = []
    const handleSend = componentFunction('../src/components/send/send.tsx', 'handleSend', {
      amount,
      numericAmount: parseFloat(amount),
      recipient: 'synthetic-recipient',
      isValidRecipient: true,
      isPrivate: false,
      selectedToken: { balance: AssetValue.from({ asset: 'ETH.ETH', value: '1' }) },
      selectedAccount: { provider: 'synthetic' },
      setSubmitting() {},
      uSwap: { getWallet: () => ({ transfer: ({ assetValue }) => (sent.push(assetValue.getValue('string')), Promise.resolve('synthetic-hash')) }) },
      FeeOption: { Fast: 'fast' },
      recordTransaction() {},
      onOpenChange() {},
      toast: { promise() {}, error() {} },
      t: key => key
    })
    handleSend()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(sent, [amount])
  }
})
