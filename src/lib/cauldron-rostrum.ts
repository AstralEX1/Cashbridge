import { BridgeConfig } from '@/config'
import { WsRpc } from '@/lib/bch'

// Live Cauldron pools from a Rostrum server. `cauldron.contract.subscribe` answers with a token's pools
// and then pushes every change to them (a pool traded against, added to or withdrawn), so the list
// follows the chain instead of being fetched anew, and a pool another trade just spent drops out at
// once. This is the same feed Selene keeps for its own trades. The list is still not evidence: the
// trade builder checks each pool it picks against the chain (Fulcrum) before anything is signed,
// and the caller falls back to the indexer when no server answers.

export interface PoolRecord {
  pkh: string
  txid: string
  vout: number
  sats: number
  tokens: number
}

interface ParsedPool {
  // What a later update names to replace or remove this pool (`spent_utxo_hash`).
  key: string
  spentKey?: string
  withdrawn: boolean
  category: string
  pool?: PoolRecord
}

const isHex = (value: unknown, bytes: number): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)
const isCategory = (value: unknown): value is string => isHex(value, 32)

// A satoshi or token amount as a safe integer; the server sends a number or a numeric string.
const amountOf = (value: unknown): number | undefined => {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined
}

// One pool entry of a snapshot or update, or undefined for one that cannot be used. A pool whose
// amounts do not fit a safe integer is left out rather than rounded.
export const parseRostrumPool = (raw: unknown): ParsedPool | undefined => {
  const p = raw as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || !isCategory(p.token_id)) return undefined
  const withdrawn = p.is_withdrawn === true
  const vout = p.new_utxo_n
  const txid = p.new_utxo_txid
  const key = typeof p.new_utxo_hash === 'string' && p.new_utxo_hash ? p.new_utxo_hash : `${String(txid)}:${String(vout)}`
  const spentKey = typeof p.spent_utxo_hash === 'string' && p.spent_utxo_hash ? p.spent_utxo_hash : undefined
  if (withdrawn) return { key, spentKey, withdrawn, category: p.token_id }
  const sats = amountOf(p.sats)
  const tokens = amountOf(p.token_amount)
  if (!isHex(p.pkh, 20) || !isHex(txid, 32) || typeof vout !== 'number' || !Number.isSafeInteger(vout) || vout < 0 || !sats || !tokens) return undefined
  return { key, spentKey, withdrawn, category: p.token_id, pool: { pkh: p.pkh, txid, vout, sats, tokens } }
}

const utxosOf = (value: unknown): unknown[] | undefined => {
  const utxos = (value as { utxos?: unknown } | null)?.utxos
  return Array.isArray(utxos) ? utxos : undefined
}

export interface RpcLike {
  open(): Promise<unknown>
  request<T>(method: string, params: unknown): Promise<T>
  close(): void
}
export interface RpcHooks {
  onNotification(method: string, params: unknown): void
  onClose(): void
}
export type RpcFactory = (url: string, hooks: RpcHooks) => RpcLike

const wsFactory: RpcFactory = (url, hooks) => new WsRpc(url, { jsonrpc: true, timeoutMs: 8_000, ...hooks })

interface Tracked {
  // Keyed by the server's utxo hash; null until the snapshot arrives and again after a disconnect.
  pools: Map<string, PoolRecord> | null
  loading?: Promise<void>
}

export interface PoolFeedOptions {
  // A socket nobody asked for this long is closed; the next request opens a new one.
  idleMs?: number
}

export class PoolFeed {
  private client?: RpcLike
  private connecting?: Promise<RpcLike>
  private readonly tracked = new Map<string, Tracked>()
  private idle?: ReturnType<typeof setTimeout>

  constructor(
    private readonly urls: string[],
    private readonly factory: RpcFactory = wsFactory,
    private readonly options: PoolFeedOptions = {}
  ) {}

  get enabled() {
    return this.urls.length > 0
  }

  // The token's pools as the server currently lists them. Rejects when no server answers.
  async pools(category: string): Promise<PoolRecord[]> {
    if (!isCategory(category)) throw new Error('Not a token category')
    if (!this.enabled) throw new Error('No Rostrum server is configured')
    this.touch()
    const client = await this.connect()
    let state = this.tracked.get(category)
    if (!state) this.tracked.set(category, (state = { pools: null }))
    if (!state.pools) {
      const mine = state
      mine.loading ??= client
        .request<unknown>('cauldron.contract.subscribe', [2, category])
        .then(result => {
          const utxos = utxosOf(result)
          if (!utxos) throw new Error('Rostrum answered the pool subscription without pools')
          const pools = new Map<string, PoolRecord>()
          for (const raw of utxos) {
            const parsed = parseRostrumPool(raw)
            if (parsed?.pool && parsed.category === category) pools.set(parsed.key, parsed.pool)
          }
          mine.pools = pools
        })
        .finally(() => {
          mine.loading = undefined
        })
      await mine.loading
    }
    return [...(state.pools?.values() ?? [])]
  }

  // A pool the chain shows spent although the feed still listed it: drop it from the list so the next
  // trade does not pick it again before the server's own update arrives.
  forget(category: string, txid: string, vout: number) {
    const pools = this.tracked.get(category)?.pools
    if (!pools) return
    for (const [key, pool] of pools) if (pool.txid === txid && pool.vout === vout) pools.delete(key)
  }

  close() {
    clearTimeout(this.idle)
    this.idle = undefined
    const client = this.client
    this.reset()
    client?.close()
  }

  private touch() {
    clearTimeout(this.idle)
    const idleMs = this.options.idleMs ?? 120_000
    this.idle = setTimeout(() => this.close(), idleMs)
    // A timer must not keep a Node process (the worker, a test) alive.
    ;(this.idle as { unref?: () => void }).unref?.()
  }

  // Forgets the connection and every list: after a reconnect each token is subscribed afresh.
  private reset() {
    this.client = undefined
    this.connecting = undefined
    for (const state of this.tracked.values()) state.pools = null
  }

  private connect(): Promise<RpcLike> {
    if (this.client) return Promise.resolve(this.client)
    this.connecting ??= this.openFirst().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  private async openFirst(): Promise<RpcLike> {
    let lastError: unknown
    for (const url of this.urls) {
      const client: RpcLike = this.factory(url, {
        onNotification: (method, params) => this.onNotification(method, params),
        onClose: () => {
          // Only this client's own close resets the feed; an older socket closing later must not.
          if (this.client === client) this.reset()
        }
      })
      try {
        await client.open()
        await client.request('server.version', ['cash-bridge', '1.4.3'])
        this.client = client
        return client
      } catch (error) {
        lastError = error
        client.close()
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No Rostrum server reachable')
  }

  private onNotification(method: string, params: unknown) {
    if (method !== 'cauldron.contract.subscribe') return
    const p = params as { type?: unknown } | null
    const utxos = p && !Array.isArray(p) && p.type === 'update' ? utxosOf(p) : undefined
    if (!utxos) return
    const parsed = utxos.map(parseRostrumPool).filter((entry): entry is ParsedPool => !!entry)
    for (const [category, state] of this.tracked) {
      // A list still waiting for its snapshot takes the snapshot, which already includes these.
      if (!state.pools) continue
      const mine = parsed.filter(entry => entry.category === category)
      // Every new pool goes in before any spent one comes out, since one batch can chain trades.
      for (const entry of mine) if (entry.pool) state.pools.set(entry.key, entry.pool)
      for (const entry of mine) if (entry.spentKey) state.pools.delete(entry.spentKey)
    }
  }
}

export const poolFeed = new PoolFeed(BridgeConfig.rostrumUrls)
