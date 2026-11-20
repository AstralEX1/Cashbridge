import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { OrderError, positiveAmount, type Limits } from '@/server/auto-bridge/types'

const integer = (name: string, fallback: number, min: number, max: number) => {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new OrderError(503, 'Invalid bridge policy configuration')
  return value
}

export const readCredential = (path: string | undefined, privateFile = false) => {
  try {
    if (!path || !statSync(path).isFile() || (privateFile && (statSync(path).mode & 0o077) !== 0)) throw new Error()
    return readFileSync(path, 'utf8').trim()
  } catch {
    throw new OrderError(503, 'Bridge credential file is missing or has unsafe permissions')
  }
}

export function loadConfig() {
  if (process.env.AUTO_BRIDGE_ENABLED !== 'true') throw new OrderError(503, 'Automatic bridge is not configured')
  const amount = (name: string) => {
    try {
      return BigInt(positiveAmount(process.env[name]))
    } catch {
      throw new OrderError(503, 'Invalid bridge exposure limits')
    }
  }
  const limits: Limits = {
    maxOrderSats: amount('AUTO_BRIDGE_MAX_ORDER_SATS'),
    maxPendingSats: amount('AUTO_BRIDGE_MAX_PENDING_SATS'),
    maxOpenOrders: integer('AUTO_BRIDGE_MAX_OPEN_ORDERS', 500, 1, 10000)
  }
  if (limits.maxPendingSats < limits.maxOrderSats) throw new OrderError(503, 'Invalid bridge exposure limits')
  // Owner policy: swap and pay out at 0-conf, like the manual flow. Override only to require depth.
  const zero = process.env.AUTO_BRIDGE_ZERO_CONF_MAX_SATS ?? limits.maxOrderSats.toString()
  if (!/^\d{1,16}$/.test(zero) || BigInt(zero) > limits.maxOrderSats) throw new OrderError(503, 'Invalid zero-confirmation limit')
  return {
    xpub: readCredential(process.env.AUTO_BRIDGE_XPUB_FILE),
    database: resolve(process.env.AUTO_BRIDGE_DB ?? 'var/auto-bridge/orders.sqlite'),
    guardFile: process.env.AUTO_BRIDGE_RECOVERY_GUARD ? resolve(process.env.AUTO_BRIDGE_RECOVERY_GUARD) : undefined,
    limits,
    minConfirmations: integer('AUTO_BRIDGE_MIN_CONFIRMATIONS', 0, 0, 100),
    zeroConfMaxSats: BigInt(zero),
    maxWaitMs: integer('AUTO_BRIDGE_MAX_WAIT_SECONDS', 1800, 60, 86400) * 1000,
    pollMs: integer('AUTO_BRIDGE_POLL_SECONDS', 5, 1, 60) * 1000,
    // On by default (production worker already sets these true). Set …=false to fall back to legacy P2PKH.
    contractOrders: process.env.AUTO_BRIDGE_CONTRACT_ORDERS !== 'false',
    saleOrders: process.env.AUTO_BRIDGE_SALE_ORDERS !== 'false',
    nearOrders: process.env.AUTO_BRIDGE_NEAR_ORDERS !== 'false',
    // Sales through a NEAR Intents or ShapeShift deposit address (router-sale-exact.cash for ShapeShift's exact amount).
    saleRoutes: process.env.AUTO_BRIDGE_SALE_ROUTES !== 'false'
  }
}
