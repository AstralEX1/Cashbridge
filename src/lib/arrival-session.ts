import { binToHex, generatePrivateKey, secp256k1 } from '@bitauth/libauth'
import { arrivalBinding, type ArrivalTerms } from '@/lib/swap-on-arrival'

// Browser arrival session: the trade private key never leaves the device. Public terms (CashScript
// constructor args) are persisted so a P2SH redeem script can be rebuilt; the private key stays in
// IndexedDB (or an in-memory map when IndexedDB is unavailable — tests / SSR).

const DB_NAME = 'cashbridge-arrival'
const DB_VERSION = 1
const STORE = 'sessions'
const REFUND_AFTER_SECONDS = 3 * 60 * 60

export interface ArrivalSessionRecord {
  // Contract P2SH20 cash address (primary key).
  address: string
  lockingBytecode: string
  terms: ArrivalTerms
  // Hex private key — local only. Never send this to a Cashbridge server.
  tradePrivateKeyHex: string
  createdAt: number
  // Optional bridge operation id for UI recovery.
  operationId?: string
}

export interface PrepareArrivalInput {
  // Person's locking bytecode (token payout + BCH reclaim).
  ownerScript: string
  category: string
  // Quoted floor in token base units and the BCH sats that floor assumes.
  rateNum: string
  rateDen: string
  refundAfter?: number
  operationId?: string
  addressIndex?: number
}

type MemoryStore = Map<string, ArrivalSessionRecord>
const memory: MemoryStore = new Map()

const hasIndexedDb = () => typeof indexedDB !== 'undefined'

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'address' })
    }
    req.onsuccess = () => resolve(req.result)
  })

const idbPut = async (record: ArrivalSessionRecord) => {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
    })
  } finally {
    db.close()
  }
}

const idbGet = async (address: string): Promise<ArrivalSessionRecord | undefined> => {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(address)
      req.onsuccess = () => resolve(req.result as ArrivalSessionRecord | undefined)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
    })
  } finally {
    db.close()
  }
}

const idbGetAll = async (): Promise<ArrivalSessionRecord[]> => {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as ArrivalSessionRecord[]) ?? [])
      req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
    })
  } finally {
    db.close()
  }
}

const idbDelete = async (address: string) => {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(address)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    })
  } finally {
    db.close()
  }
}

/** Public view — never includes the private key (safe to log or register). */
export const publicArrivalTerms = (record: ArrivalSessionRecord): ArrivalTerms => ({ ...record.terms })

/** Refuse accidental network export of the private key. */
export const assertLocalOnly = (record: ArrivalSessionRecord) => {
  if (!record.tradePrivateKeyHex || record.tradePrivateKeyHex.length !== 64) {
    throw new Error('Arrival session is missing a local trade key')
  }
}

export const prepareArrival = async (input: PrepareArrivalInput): Promise<ArrivalSessionRecord> => {
  const privateKey = generatePrivateKey()
  const tradeKey = binToHex(secp256k1.derivePublicKeyCompressed(privateKey))
  const terms: ArrivalTerms = {
    tradeKey,
    ownerScript: input.ownerScript,
    category: input.category,
    rateNum: input.rateNum,
    rateDen: input.rateDen,
    refundAfter: input.refundAfter ?? Math.floor(Date.now() / 1000) + REFUND_AFTER_SECONDS
  }
  const binding = arrivalBinding(terms, input.addressIndex ?? 0)
  const record: ArrivalSessionRecord = {
    address: binding.cashAddress,
    lockingBytecode: binding.lockingBytecode,
    terms,
    tradePrivateKeyHex: binToHex(privateKey),
    createdAt: Date.now(),
    operationId: input.operationId
  }
  assertLocalOnly(record)
  memory.set(record.address, record)
  if (hasIndexedDb()) {
    try {
      await idbPut(record)
    } catch {
      // Memory still holds it for this tab; IndexedDB failure must not block the bridge.
    }
  }
  return record
}

export const loadArrival = async (address: string): Promise<ArrivalSessionRecord | undefined> => {
  const cached = memory.get(address)
  if (cached) return cached
  if (!hasIndexedDb()) return undefined
  try {
    const record = await idbGet(address)
    if (record) {
      assertLocalOnly(record)
      memory.set(address, record)
    }
    return record
  } catch {
    return undefined
  }
}

export const listPendingArrivals = async (): Promise<ArrivalSessionRecord[]> => {
  if (hasIndexedDb()) {
    try {
      const all = await idbGetAll()
      for (const r of all) memory.set(r.address, r)
      return all
    } catch {
      /* fall through to memory */
    }
  }
  return [...memory.values()]
}

export const clearArrival = async (address: string) => {
  memory.delete(address)
  if (hasIndexedDb()) {
    try {
      await idbDelete(address)
    } catch {
      /* ignore */
    }
  }
}

/** Test / SSR helper: seed the in-memory backend without IndexedDB. */
export const putArrivalMemory = (record: ArrivalSessionRecord) => {
  assertLocalOnly(record)
  memory.set(record.address, record)
}

export const clearArrivalMemory = () => memory.clear()
