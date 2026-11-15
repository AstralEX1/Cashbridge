import { BridgeConfig } from '@/config'
import { loadConfig, readCredential } from '@/server/auto-bridge/config'
import { OrderStore } from '@/server/auto-bridge/store'

let store: OrderStore | undefined
export const getOrderStore = () => {
  if (!store) {
    const config = loadConfig()
    store = new OrderStore(config.database, config.xpub, config.limits, config.maxWaitMs, config.guardFile)
  }
  return store
}

export async function runWorker() {
  const [{ WorkerWallet }, { BchGateway }, { processOrder }] = await Promise.all([
    import('@/server/auto-bridge/wallet'),
    import('@/server/auto-bridge/gateway'),
    import('@/server/auto-bridge/worker')
  ])
  const config = loadConfig()
  const wallet = new WorkerWallet(readCredential(process.env.AUTO_BRIDGE_KEY_FILE, true))
  if (wallet.xpub !== config.xpub) throw new Error('Worker key does not match the deposit wallet')
  const orders = getOrderStore(),
    gateway = new BchGateway()
  const { startOrderServer } = await import('@/server/auto-bridge/http')
  const { quoteToken } = await import('@/lib/cauldron')
  const server = await startOrderServer(orders, async amount => {
    await gateway.assertReady()
    return quoteToken({ category: BridgeConfig.pusd.category, side: 'buy', amount })
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
        } catch {
          console.warn('Order observation unavailable; retrying on the next pass')
        }
      }
      if (!stopping) await new Promise<void>(resolve => setTimeout(resolve, config.pollMs))
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    orders.close()
    store = undefined
  }
}
