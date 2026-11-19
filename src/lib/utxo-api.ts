import { binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth'
import { address, networks, type Network } from 'bitcoinjs-lib'
import { BCH_PREFIX, decodeTx, RpcError, txidOf, WsRpc } from '@/lib/bch'

// Keyless public explorers behind the Blockchair-shaped routes the UTXO toolbox and this app call
// (src/app/api/blockchair). Esplora (mempool.space and its forks) and Blockbook (Trezor's public
// backends) cover most chains; Bitcoin Cash is read from Fulcrum (Electrum servers). Each chain lists its explorers in order; a call
// moves to the next one when an explorer is unreachable, rate-limited or failing, and stops at the
// first one that answers, including "not found" only once every explorer has said so.

const TIMEOUT_MS = 5_000

export interface Coin {
  hash: string
  index: number
  value: number
  blockId: number // -1 while in the mempool, like Blockchair's block_id
}

export interface TxOutput {
  recipient?: string
  value: number
  scriptHex: string
}

export interface Tx {
  blockId: number
  outputs: TxOutput[]
}

interface Explorer {
  name: string
  balance(addr: string): Promise<{ balance: number; txCount: number }>
  coins(addr: string): Promise<Coin[]>
  tx(hash: string): Promise<Tx | null> // null: this explorer does not know the hash
  rawTx(hash: string): Promise<string | null>
  broadcast(hex: string): Promise<string>
}

// An explorer that answered and refused the request (bad address, a transaction the node rejects).
// Asking another explorer would get the same answer, so the call stops here.
export class Rejected extends Error {}

async function ask(url: string, init?: RequestInit): Promise<string | null> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { accept: 'application/json, text/plain', ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const text = await res.text()
  if (res.ok) return text
  if (res.status === 404) return null
  // An HTML page is the explorer's CDN turning this server away (a Cloudflare block page), not the
  // explorer judging the request, so the next explorer may still answer.
  const page = /^\s*</.test(text) || !!res.headers.get('content-type')?.includes('text/html')
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 && !page) throw new Rejected(text.slice(0, 300) || `HTTP ${res.status}`)
  throw new Error(`${url} answered ${res.status}${page ? ' with an HTML page' : ''}`)
}

const askJson = async (url: string, init?: RequestInit) => {
  const text = await ask(url, init)
  return text === null ? null : JSON.parse(text)
}

const txid = (text: string | null, name: string) => {
  const id = text?.trim() ?? ''
  if (!/^[0-9a-f]{64}$/i.test(id)) throw new Error(`${name} answered a broadcast with ${id.slice(0, 80) || 'nothing'}`)
  return id.toLowerCase()
}

function esplora(base: string): Explorer {
  return {
    name: base,
    async balance(addr) {
      const { chain_stats: c, mempool_stats: m } = await askJson(`${base}/address/${encodeURIComponent(addr)}`)
      return { balance: c.funded_txo_sum - c.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum, txCount: c.tx_count + m.tx_count }
    },
    async coins(addr) {
      const list: { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } }[] =
        (await askJson(`${base}/address/${encodeURIComponent(addr)}/utxo`)) ?? []
      return list.map(u => ({ hash: u.txid, index: u.vout, value: u.value, blockId: u.status.confirmed ? (u.status.block_height ?? -1) : -1 }))
    },
    async tx(hash) {
      const tx = await askJson(`${base}/tx/${hash}`)
      if (!tx) return null
      return {
        blockId: tx.status?.confirmed ? (tx.status.block_height ?? -1) : -1,
        outputs: tx.vout.map((o: { scriptpubkey: string; scriptpubkey_address?: string; value: number }) => ({
          recipient: o.scriptpubkey_address,
          value: o.value,
          scriptHex: o.scriptpubkey
        }))
      }
    },
    rawTx: hash => ask(`${base}/tx/${hash}/hex`).then(hex => hex?.trim() ?? null),
    broadcast: async hex => txid(await ask(`${base}/tx`, { method: 'POST', body: hex }), base)
  }
}

// Blockbook (https://github.com/trezor/blockbook/blob/master/docs/api.md), amounts as decimal strings.
function blockbook(base: string): Explorer {
  const api = `${base}/api/v2`
  const height = (h: unknown) => (typeof h === 'number' && h > 0 ? h : -1)
  const tx = async (hash: string) => {
    try {
      return await askJson(`${api}/tx/${hash}`)
    } catch (error) {
      // Blockbook reports an unknown transaction as a 400 whose error says "not found".
      if (error instanceof Rejected && /not found/i.test(error.message)) return null
      throw error
    }
  }
  return {
    name: base,
    async balance(addr) {
      const a = await askJson(`${api}/address/${encodeURIComponent(addr)}?details=basic`)
      return { balance: Number(a.balance) + Number(a.unconfirmedBalance ?? 0), txCount: Number(a.txs ?? 0) + Number(a.unconfirmedTxs ?? 0) }
    },
    async coins(addr) {
      const list: { txid: string; vout: number; value: string; height?: number }[] = (await askJson(`${api}/utxo/${encodeURIComponent(addr)}`)) ?? []
      return list.map(u => ({ hash: u.txid, index: u.vout, value: Number(u.value), blockId: height(u.height) }))
    },
    async tx(hash) {
      const t = await tx(hash)
      if (!t) return null
      return {
        blockId: height(t.blockHeight),
        outputs: t.vout.map((o: { value: string; hex: string; addresses?: string[]; isAddress?: boolean }) => ({
          recipient: o.isAddress === false ? undefined : o.addresses?.[0],
          value: Number(o.value),
          scriptHex: o.hex
        }))
      }
    },
    rawTx: async hash => (await tx(hash))?.hex ?? null,
    broadcast: async hex => {
      const answer = await askJson(`${api}/sendtx/`, { method: 'POST', body: hex })
      return txid(answer?.result, base)
    }
  }
}

// Fulcrum: the Electrum protocol over WebSocket, the server kind src/lib/bch.ts checks BCH with. No CDN
// bot filter sits in front of it, unlike Trezor's Blockbook, which answers the deployed site with a
// Cloudflare block page. Transactions only: Bitcoin Cash has no address lookups here (cashaddr scripts
// are not derived above). Raw bytes are hashed against the asked id and decoded locally.
function fulcrum(url: string): Explorer {
  const name = new URL(url).host
  const session = async <T>(run: (rpc: WsRpc) => Promise<T>) => {
    const rpc = new WsRpc(url, { jsonrpc: true, timeoutMs: TIMEOUT_MS })
    try {
      await rpc.open()
      await rpc.request('server.version', ['cashbridge', '1.4'])
      return await run(rpc)
    } finally {
      rpc.close()
    }
  }
  // Fulcrum reports an unknown transaction as an error from its node.
  const raw = async (rpc: WsRpc, hash: string) => {
    const hex = await rpc.request<string>('blockchain.transaction.get', [hash.toLowerCase(), false]).catch(error => {
      if (error instanceof RpcError) return null
      throw error
    })
    if (hex === null) return null
    if (typeof hex !== 'string' || txidOf(hex) !== hash.toLowerCase()) throw new Error(`${name} answered a transaction that is not ${hash}`)
    return hex
  }
  const noAddresses = () => Promise.reject(new Error('Bitcoin Cash addresses are not looked up here'))
  return {
    name,
    balance: noAddresses,
    coins: noAddresses,
    tx: hash =>
      session(async rpc => {
        const hex = await raw(rpc, hash)
        if (!hex) return null
        const [verbose, tip] = await Promise.all([
          rpc.request<{ confirmations?: number }>('blockchain.transaction.get', [hash.toLowerCase(), true]),
          rpc.request<{ height: number }>('blockchain.headers.subscribe', [])
        ])
        const confirmations = Number(verbose?.confirmations ?? 0)
        if (confirmations > 0 && !Number.isInteger(tip?.height)) throw new Error(`${name} answered no chain tip`)
        return {
          blockId: confirmations > 0 ? tip.height - confirmations + 1 : -1,
          outputs: decodeTx(hex).outputs.map(o => {
            const cashaddr = lockingBytecodeToCashAddress({ prefix: BCH_PREFIX, bytecode: o.lockingBytecode })
            return { recipient: typeof cashaddr === 'string' ? undefined : cashaddr.address, value: Number(o.valueSatoshis), scriptHex: binToHex(o.lockingBytecode) }
          })
        }
      }),
    rawTx: hash => session(rpc => raw(rpc, hash)),
    // An error from the server is its node's verdict on the transaction, as in src/lib/bch.ts.
    broadcast: hex =>
      session(rpc => rpc.request<string>('blockchain.transaction.broadcast', [hex])).then(
        id => txid(id, name),
        error => {
          throw error instanceof RpcError ? new Rejected(error.message) : error
        }
      )
  }
}

// Output scripts are not in either explorer's UTXO list, so they are derived from the address.
const LITECOIN: Network = { ...networks.bitcoin, messagePrefix: '\x19Litecoin Signed Message:\n', bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }
const DOGECOIN: Network = { ...networks.bitcoin, messagePrefix: '\x19Dogecoin Signed Message:\n', bech32: 'doge', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }

export function outputScriptHex(addr: string, network: Network): string | undefined {
  try {
    return Buffer.from(address.toOutputScript(addr, network)).toString('hex')
  } catch {}
  // A taproot script is OP_1 <32-byte key>; toOutputScript wants an ECC library only to check the key.
  try {
    const { prefix, version, data } = address.fromBech32(addr)
    if (prefix === network.bech32 && version === 1 && data.length === 32) return `5120${Buffer.from(data).toString('hex')}`
  } catch {}
}

// slug (as the toolbox derives it) -> explorers. `network` set: addresses can be looked up too; a chain
// without it serves transaction lookups and broadcasts only. Trezor's hosts are numbered backends of
// one operator, so they back each other up against an outage but not against that operator blocking us.
export const UTXO_CHAINS: Record<string, { network?: Network; explorers: Explorer[] }> = {
  bitcoin: {
    network: networks.bitcoin,
    explorers: [esplora('https://mempool.space/api'), esplora('https://blockstream.info/api'), blockbook('https://btc1.trezor.io')]
  },
  litecoin: {
    network: LITECOIN,
    explorers: [esplora('https://litecoinspace.org/api'), blockbook('https://ltc1.trezor.io'), blockbook('https://ltc2.trezor.io')]
  },
  dogecoin: {
    network: DOGECOIN,
    explorers: [blockbook('https://doge1.trezor.io'), blockbook('https://doge2.trezor.io'), blockbook('https://doge3.trezor.io')]
  },
  'bitcoin-cash': { explorers: [fulcrum('wss://bch.imaginary.cash:50004'), fulcrum('wss://bch.loping.net:50004'), blockbook('https://bch1.trezor.io')] },
  dash: { explorers: [blockbook('https://dash1.trezor.io')] },
  zcash: { explorers: [blockbook('https://zec1.trezor.io')] }
}

async function firstAnswer<T>(explorers: Explorer[], run: (explorer: Explorer) => Promise<T | null>): Promise<T | null> {
  const failures: string[] = []
  let unknown = false
  for (const explorer of explorers) {
    try {
      const answer = await run(explorer)
      if (answer !== null) return answer
      unknown = true
    } catch (error) {
      if (error instanceof Rejected) throw error
      failures.push(`${explorer.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (unknown) return null
  throw new Error(failures.join(' | '))
}

// --- The Blockchair-shaped answers (the `data` member), as the toolbox and our status checks read them ---

export async function addressDashboard(slug: string, addr: string) {
  const { explorers } = UTXO_CHAINS[slug]
  const { stats, coins } = (await firstAnswer(explorers, async e => {
    const [stats, coins] = await Promise.all([e.balance(addr), e.coins(addr)])
    return { stats, coins }
  }))!
  return {
    [addr]: {
      address: { balance: stats.balance, transaction_count: stats.txCount },
      transactions: [],
      utxo: coins.map(c => ({ block_id: c.blockId, index: c.index, transaction_hash: c.hash, value: c.value }))
    }
  }
}

// What `outputs?q=recipient(ADDR),is_spent(false)...&s=value(desc)&limit=&offset=` returns: the unspent
// outputs of one address, largest first, one page at a time.
export async function unspentOutputs(slug: string, addr: string, limit: number, offset: number) {
  const { network, explorers } = UTXO_CHAINS[slug]
  const script = outputScriptHex(addr, network!)
  if (!script) throw new Rejected(`${addr} is not a ${slug} address`)
  const coins = (await firstAnswer(explorers, e => e.coins(addr)))!
  return coins
    .sort((a, b) => b.value - a.value)
    .slice(offset, offset + limit)
    .map(c => ({
      is_spent: false,
      transaction_hash: c.hash,
      index: c.index,
      value: c.value,
      script_hex: script,
      block_id: c.blockId,
      spending_signature_hex: null
    }))
}

// An unknown hash is an empty object, as on Blockchair; a mempool transaction has block_id -1.
export async function transactionDashboard(slug: string, hash: string) {
  const tx = await firstAnswer(UTXO_CHAINS[slug].explorers, e => e.tx(hash))
  if (!tx) return {}
  return {
    [hash]: {
      transaction: { hash, block_id: tx.blockId },
      outputs: tx.outputs.map(o => ({ recipient: o.recipient, value: o.value, script_hex: o.scriptHex }))
    }
  }
}

export async function rawTransaction(slug: string, hash: string) {
  const hex = await firstAnswer(UTXO_CHAINS[slug].explorers, e => e.rawTx(hash))
  return hex ? { [hash]: { raw_transaction: hex } } : {}
}

export async function broadcast(slug: string, hex: string) {
  return { transaction_hash: (await firstAnswer(UTXO_CHAINS[slug].explorers, e => e.broadcast(hex)))! }
}
