import {
  base58AddressToLockingBytecode,
  binToHex,
  binsAreEqual,
  cashAddressToLockingBytecode,
  decodeTransaction,
  encodeCashAddress,
  hash160,
  hashTransaction,
  hexToBin,
  sha256,
  type Transaction,
  utf8ToBin
} from '@bitauth/libauth'
import { BridgeConfig } from '@/config'

// BCH-side lookups and checks for the bridge. Nothing here trusts a server's decoding: raw
// transactions are fetched, decoded and hashed locally, and outputs are matched by locking script.

export const BCH_PREFIX = 'bitcoincash'

const isHex = (value: unknown, bytes?: number): value is string =>
  typeof value === 'string' && value.length % 2 === 0 && /^[0-9a-f]*$/i.test(value) && (bytes === undefined || value.length === bytes * 2)

export const isTxid = (value: unknown): value is string => isHex(value, 32)

// THORNode and wallets disagree on case and on a 0x prefix; transaction ids are compared bare and lower-case.
export const normalizeTxid = (hash: string) => (hash.startsWith('0x') || hash.startsWith('0X') ? hash.slice(2) : hash).toLowerCase()

// --- Addresses ---------------------------------------------------------------------------------

// WizardConnect hdwalletv1 path names (child 0 and child 7 of the wallet's account). A wallet may
// share only its DeFi path with dapps, so either is accepted; signing names the same path.
export const BINDING_PATHS = { receive: 0, defi: 7 } as const
export type BindingPath = keyof typeof BINDING_PATHS

export interface BchBinding {
  // Compressed public key the wallet derived at `path`/`addressIndex` (hex).
  pubkey: string
  path: BindingPath
  addressIndex: number
  // P2PKH locking script shared by both address forms below (hex).
  lockingBytecode: string
  // Plain CashAddr, given to THORChain as the first leg's destination.
  cashAddress: string
  // Token-aware CashAddr of the same script, given to Cauldron for the PUSD output.
  tokenAddress: string
}

export const bindingFromPubkey = (pubkey: Uint8Array, addressIndex: number, path: BindingPath = 'receive'): BchBinding => {
  if (pubkey.length !== 33 || (pubkey[0] !== 2 && pubkey[0] !== 3)) throw new Error('Wallet returned an invalid public key')
  const payload = hash160(pubkey)
  const lockingBytecode = binToHex(Uint8Array.from([0x76, 0xa9, 0x14, ...payload, 0x88, 0xac]))
  return {
    pubkey: binToHex(pubkey),
    path,
    addressIndex,
    lockingBytecode,
    cashAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2pkh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2pkhWithTokens', payload }).address
  }
}

// The locking script an address pays, in any representation THORNode or a wallet may print:
// CashAddr with or without prefix, token-aware or not, or legacy base58.
export const addressToLockingBytecode = (address: string): string | undefined => {
  const trimmed = address.trim()
  if (!trimmed) return undefined
  const candidates = trimmed.includes(':') ? [trimmed.toLowerCase()] : [`${BCH_PREFIX}:${trimmed.toLowerCase()}`]
  for (const candidate of candidates) {
    const decoded = cashAddressToLockingBytecode(candidate)
    if (typeof decoded !== 'string') return decoded.prefix === BCH_PREFIX ? binToHex(decoded.bytecode) : undefined
  }
  const legacy = base58AddressToLockingBytecode(trimmed)
  if (typeof legacy !== 'string' && legacy.version === 0) return binToHex(legacy.bytecode)
  return undefined
}

export const addressPaysScript = (address: string | undefined, lockingBytecode: string) =>
  !!address && addressToLockingBytecode(address) === lockingBytecode.toLowerCase()

// A restored binding is only used again if every field still derives from its public key.
export const isValidBinding = (binding: unknown): binding is BchBinding => {
  const b = binding as BchBinding
  if (!b || typeof b !== 'object' || !isHex(b.pubkey, 33) || !Object.hasOwn(BINDING_PATHS, b.path) || !Number.isSafeInteger(b.addressIndex) || b.addressIndex < 0) return false
  try {
    const fresh = bindingFromPubkey(hexToBin(b.pubkey), b.addressIndex, b.path)
    return fresh.lockingBytecode === b.lockingBytecode && fresh.cashAddress === b.cashAddress && fresh.tokenAddress === b.tokenAddress
  } catch {
    return false
  }
}

// --- Transactions ------------------------------------------------------------------------------

export const decodeTx = (hex: string): Transaction => {
  if (!isHex(hex) || hex.length === 0) throw new Error('Transaction is not hex')
  const decoded = decodeTransaction(hexToBin(hex))
  if (typeof decoded === 'string') throw new Error(`Transaction does not decode: ${decoded}`)
  return decoded
}

// Display-order transaction id of raw transaction hex.
export const txidOf = (hex: string) => hashTransaction(hexToBin(hex))

// The text of an OP_RETURN output with a single push, as THORChain's UTXO signer writes its memo.
export const opReturnText = (lockingBytecode: Uint8Array): string | undefined => {
  if (lockingBytecode[0] !== 0x6a || lockingBytecode.length < 2) return undefined
  const op = lockingBytecode[1]
  let start = 2
  let length = op
  if (op === 0x4c) {
    length = lockingBytecode[2]
    start = 3
  } else if (op > 0x4b) {
    return undefined
  }
  if (start + length !== lockingBytecode.length) return undefined
  return new TextDecoder().decode(lockingBytecode.slice(start, start + length))
}

// --- JSON over WebSocket -----------------------------------------------------------------------

// One request/response client for both Fulcrum (Electrum JSON-RPC) and the Cauldron Router, which
// share the `{ id, method, params } -> { id, result | error }` shape. Opened per use and closed after.
export class WsRpc {
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly url: string,
    private readonly options: { jsonrpc?: boolean; timeoutMs?: number } = {}
  ) {}

  async open(): Promise<this> {
    if (this.ws?.readyState === WebSocket.OPEN) return this
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error(`Timed out connecting to ${new URL(this.url).host}`))
      }, this.options.timeoutMs ?? 15_000)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`Could not connect to ${new URL(this.url).host}`))
      }
      ws.onclose = () => this.failAll(new Error('Connection closed'))
      ws.onmessage = event => this.onMessage(event.data)
      this.ws = ws
    })
    return this
  }

  request<T>(method: string, params: unknown): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcTimeoutError(`${method} timed out`))
      }, this.options.timeoutMs ?? 20_000)
      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer })
      ws.send(JSON.stringify(this.options.jsonrpc ? { jsonrpc: '2.0', id, method, params } : { id, method, params }))
    })
  }

  close() {
    this.ws?.close()
    this.ws = undefined
  }

  private onMessage(data: unknown) {
    let message: { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } }
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    if (typeof message?.id !== 'number') return
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new RpcError(String(message.error.code ?? 'error'), String(message.error.message ?? 'Request failed')))
    else entry.resolve(message.result)
  }

  private failAll(error: Error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
      this.pending.delete(id)
    }
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export class RpcTimeoutError extends Error {}

// --- Fulcrum lookups ---------------------------------------------------------------------------

const electrum = async () => {
  let lastError: unknown
  for (const url of BridgeConfig.electrumUrls) {
    const client = new WsRpc(url, { jsonrpc: true })
    try {
      await client.open()
      await client.request('server.version', ['thorchain-bch-bridge', '1.4'])
      return client
    } catch (error) {
      client.close()
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No BCH server reachable')
}

const withElectrum = async <T>(fn: (client: WsRpc) => Promise<T>) => {
  const client = await electrum()
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

// Electrum indexes scripts by the reversed sha256 of the locking script.
export const scriptHash = (lockingBytecode: string) => binToHex(sha256.hash(hexToBin(lockingBytecode)).reverse())

interface ElectrumUnspent {
  tx_hash: string
  tx_pos: number
  height: number
  value: number
  token_data?: unknown
}

export interface RawTx {
  hex: string
  tx: Transaction
}

// null when no server knows the transaction (yet). The hex is hashed locally against the txid.
const fetchRawTx = async (client: WsRpc, txid: string): Promise<RawTx | null> => {
  const hex = await client.request<string>('blockchain.transaction.get', [normalizeTxid(txid), false]).catch(error => {
    if (error instanceof RpcError) return null
    throw error
  })
  if (hex === null) return null
  if (!isHex(hex) || txidOf(hex) !== normalizeTxid(txid)) throw new Error('BCH server returned a transaction that does not match its id')
  return { hex, tx: decodeTx(hex) }
}

export const getRawTransaction = (txid: string) => withElectrum(client => fetchRawTx(client, txid))

export interface ScriptUtxo {
  txid: string
  vout: number
  value: bigint
  height: number
  hasToken: boolean
}

const fetchUnspent = async (client: WsRpc, lockingBytecode: string): Promise<{ tip: number; utxos: ScriptUtxo[] }> => {
  const header = await client.request<{ height: number }>('blockchain.headers.subscribe', [])
  // Fulcrum lists token outputs only when asked; 'include_tokens' keeps them in the answer so a
  // token-carrying output is seen (and refused) rather than silently missing.
  const list = await client.request<ElectrumUnspent[]>('blockchain.scripthash.listunspent', [scriptHash(lockingBytecode), 'include_tokens']).catch(error => {
    if (error instanceof RpcError) return client.request<ElectrumUnspent[]>('blockchain.scripthash.listunspent', [scriptHash(lockingBytecode)])
    throw error
  })
  if (!Array.isArray(list) || typeof header?.height !== 'number') throw new Error('Unexpected BCH server response')
  return {
    tip: header.height,
    utxos: list.map(u => ({
      txid: normalizeTxid(String(u.tx_hash)),
      vout: Number(u.tx_pos),
      value: BigInt(u.value),
      height: Number(u.height),
      hasToken: u.token_data !== undefined && u.token_data !== null
    }))
  }
}

export const confirmationsAt = (height: number, tip: number) => (height > 0 ? tip - height + 1 : 0)

// --- THORChain outbound receipt ----------------------------------------------------------------

export interface VerifiedOutput {
  txid: string
  vout: number
  // Satoshis, as a decimal string.
  value: string
  confirmations: number
  unspent: boolean
}

export type ReceiptCheck =
  | { kind: 'not_found' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; outputs: VerifiedOutput[]; total: string; confirmations: number }

// Checks that `outTxid` is THORChain's BCH outbound for `inboundHash`, paying `lockingBytecode`
// `expectedSats` in plain (token-free) outputs, and reports which of those outputs are still
// unspent and how deeply confirmed. A planned outbound, a wallet balance or the tracker's amount
// is never evidence: only this transaction's own outputs are.
export const verifyThorchainOutbound = async ({
  outTxid,
  inboundHash,
  lockingBytecode,
  expectedSats
}: {
  outTxid: string
  inboundHash: string
  lockingBytecode: string
  expectedSats: bigint
}): Promise<ReceiptCheck> =>
  withElectrum(async client => {
    const raw = await fetchRawTx(client, outTxid)
    if (!raw) return { kind: 'not_found' }
    return checkOutbound(raw, { inboundHash, lockingBytecode, expectedSats }, await fetchUnspent(client, lockingBytecode))
  })

export const checkOutbound = (
  raw: RawTx,
  { inboundHash, lockingBytecode, expectedSats }: { inboundHash: string; lockingBytecode: string; expectedSats: bigint },
  { tip, utxos }: { tip: number; utxos: ScriptUtxo[] }
): ReceiptCheck => {
  const txid = txidOf(raw.hex)
  const memo = `OUT:${normalizeTxid(inboundHash)}`.toUpperCase()
  const memos = raw.tx.outputs.map(o => opReturnText(o.lockingBytecode)).filter((m): m is string => m !== undefined)
  if (!memos.some(m => m.toUpperCase() === memo)) return { kind: 'invalid', reason: 'The BCH transaction is not THORChain’s outbound for this swap (memo mismatch)' }

  const script = hexToBin(lockingBytecode)
  const ours = raw.tx.outputs.map((o, vout) => ({ o, vout })).filter(({ o }) => binsAreEqual(o.lockingBytecode, script))
  if (ours.length === 0) return { kind: 'invalid', reason: 'The BCH transaction pays nothing to the bound address' }
  if (ours.some(({ o }) => o.token)) return { kind: 'invalid', reason: 'The BCH transaction sends tokens to the bound address' }

  const total = ours.reduce((sum, { o }) => sum + o.valueSatoshis, 0n)
  if (total !== expectedSats) return { kind: 'invalid', reason: `Received ${total} sats, THORChain reports ${expectedSats}` }

  const outputs = ours.map(({ o, vout }) => {
    const utxo = utxos.find(u => u.txid === txid && u.vout === vout)
    return {
      txid,
      vout,
      value: o.valueSatoshis.toString(),
      unspent: !!utxo && utxo.value === o.valueSatoshis && !utxo.hasToken,
      confirmations: utxo ? confirmationsAt(utxo.height, tip) : 0
    }
  })

  return { kind: 'ok', outputs, total: total.toString(), confirmations: Math.min(...outputs.map(o => o.confirmations)) }
}

// Whether each outpoint is still an unspent, token-free output of `lockingBytecode`.
export const checkUnspent = (lockingBytecode: string, outpoints: { txid: string; vout: number; value: string }[]) =>
  withElectrum(async client => {
    const { tip, utxos } = await fetchUnspent(client, lockingBytecode)
    return outpoints.map(p => {
      const utxo = utxos.find(u => u.txid === normalizeTxid(p.txid) && u.vout === p.vout)
      return { ...p, unspent: !!utxo && utxo.value.toString() === p.value && !utxo.hasToken, confirmations: utxo ? confirmationsAt(utxo.height, tip) : 0 }
    })
  })

// Whether each outpoint is still unspent with the value and token it is claimed to hold, whatever
// script it pays (Fulcrum's blockchain.utxo.get_info answers null for a spent or unknown output).
export const checkOutpointsLive = (outpoints: { txid: string; vout: number; value: bigint; token?: { category: string; amount: bigint } }[]) =>
  withElectrum(client =>
    Promise.all(
      outpoints.map(async p => {
        const info = await client.request<{ value?: number; token_data?: { category?: string; amount?: string | number } } | null>('blockchain.utxo.get_info', [
          normalizeTxid(p.txid),
          p.vout
        ])
        const token = info?.token_data
        const tokenMatches = p.token
          ? token?.category === p.token.category && BigInt(token.amount ?? -1) === p.token.amount
          : token === undefined || token === null
        return { ...p, live: !!info && BigInt(info.value ?? -1) === p.value && tokenMatches }
      })
    )
  )

// The second leg's state on chain: 'unknown' when no server has it, else its confirmations.
export const getTransactionState = (txid: string) =>
  withElectrum(async client => {
    const raw = await fetchRawTx(client, txid)
    if (!raw) return { seen: false as const }
    const verbose = await client.request<{ confirmations?: number }>('blockchain.transaction.get', [normalizeTxid(txid), true]).catch(() => ({}) as { confirmations?: number })
    return { seen: true as const, confirmations: Number(verbose.confirmations ?? 0) }
  })

export const broadcastViaElectrum = (hex: string) => withElectrum(client => client.request<string>('blockchain.transaction.broadcast', [hex]))

export const textToHex = (text: string) => binToHex(utf8ToBin(text))
