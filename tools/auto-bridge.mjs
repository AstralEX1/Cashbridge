// Existing wallet and order state are required; this command never initializes a wallet.
try {
  if (process.argv[2] !== 'worker' || process.argv.length !== 3) throw new Error()
  const { runWorker } = await import('../src/server/auto-bridge/runtime.ts')
  await runWorker()
} catch {
  console.error('Automatic bridge worker failed. Check configured files, permissions, node connectivity and policy limits. Credentials were not logged.')
  process.exitCode = 1
}
