import { loadConfig, readCredential } from '@/server/auto-bridge/config'
import { OrderStore } from '@/server/auto-bridge/store'

export async function runWorker() {
  const [{ WorkerWallet }, { BchGateway }, { processOrder, reasonOf }] = await Promise.all([
    import('@/server/auto-bridge/wallet'),
    import('@/server/auto-bridge/gateway'),
    import('@/server/auto-bridge/worker')
  ])
  const config = loadConfig()
  const wallet = new WorkerWallet(readCredential(process.env.AUTO_BRIDGE_KEY_FILE, true))
  if (wallet.xpub !== config.xpub) throw new Error('Worker key does not match the deposit wallet')
  const orders = new OrderStore(config.database, config.xpub, config.limits, config.maxWaitMs, config.guardFile, config.contractOrders),
    gateway = new BchGateway()
  const { startOrderServer } = await import('@/server/auto-bridge/http')
  const { quoteToken } = await import('@/lib/cauldron')
  const server = await startOrderServer(orders, async (amount, category) => {
    await gateway.assertReady()
    return quoteToken({ category, side: 'buy', amount })
  })
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  console.info('Automatic bridge worker started')
  try {
    while (!stopping) {
      if (orders.recoveryRequired) {
        console.warn('Order database recovery verification is required; admission and signing remain paused')
        await new Promise<void>(resolve => setTimeout(resolve, config.pollMs))
        continue
      }
      try {
        await gateway.assertReady()
      } catch {
        console.warn('BCH node is not ready; delaying order processing')
        await new Promise<void>(resolve => setTimeout(resolve, config.pollMs))
        continue
      }
      for (const order of orders.nextWork()) {
        if (stopping) break
        try {
          await processOrder(orders, gateway, wallet, order, config)
        } catch (error) {
          console.warn('Order observation unavailable; retrying on the next pass')
          console.warn(`Order ${order.id.slice(0, 8)} observation failed: ${reasonOf(error)}`)
        }
      }
      if (!stopping) await new Promise<void>(resolve => setTimeout(resolve, config.pollMs))
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    orders.close()
  }
}
