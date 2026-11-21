import { Chain, EVMChain, EVMChains, USwapConfig, UTXOChain, UTXOChains } from '@tcswap/core'
import { BLOCKCHAIR_CHAINS } from '@/lib/blockchair'
import { XRPL_RPC_URLS } from '@/lib/endpoints'
import { getProvider } from '@/lib/evm-rpc'
import { fetchFirst } from '@/lib/fallback'
import { blockchairProxyUrl, getUSwap } from '@/lib/wallets'

// The aggregator's /track only follows swaps, so a plain wallet send is confirmed against its chain.
// 'pending' covers both "in the mempool" and "not seen yet".
export type TransferStatus = 'pending' | 'completed' | 'failed' | 'unsupported'

// Only the Cosmos chains this lookup was verified against; the others may have no RPC configured.
const TENDERMINT_CHAINS: Chain[] = [Chain.Cosmos, Chain.THORChain, Chain.Maya]


// How long a send may go unseen before history gives up. Low-fee UTXO and EVM transactions can wait
// for days; elsewhere transactions expire quickly (Solana blockhash, Tron expiration, XRPL LastLedgerSequence).
const HOUR_MS = 60 * 60 * 1000

export const transferDropWindow = (chain: Chain) => {
  if (UTXOChains.includes(chain as UTXOChain)) return 72 * HOUR_MS
  if (EVMChains.includes(chain as EVMChain)) return 24 * HOUR_MS
  return HOUR_MS
}

// Every node listed for a chain, without a trailing slash; the SDK config holds our lists and the Solana proxy.
export const rpcUrls = (chain: Chain): string[] => {
  getUSwap()
  return (USwapConfig.get('rpcUrls')[chain] ?? []).map(url => url.replace(/\/$/, ''))
}

// POST `body` as JSON to `path` on the first of `urls` that answers (src/lib/fallback.ts).
export const postFirst = async (urls: readonly string[], path: string, body: unknown) => {
  const res = await fetchFirst(urls, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${new URL(res.url || urls[0]).host} answered ${res.status}`)
  return res.json()
}
export const postJson = (url: string, body: unknown) => postFirst([url], '', body)

async function evmStatus(chain: EVMChain, hash: string): Promise<TransferStatus> {
  const result = await (await getProvider(chain)).send('eth_getTransactionReceipt', [hash])
  if (!result) return 'pending'
  return result.status === '0x1' ? 'completed' : 'failed'
}

async function utxoStatus(slug: string, hash: string): Promise<TransferStatus> {
  const res = await fetch(`${blockchairProxyUrl()}/${slug}/dashboards/transaction/${encodeURIComponent(hash)}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`UTXO lookup answered ${res.status}`)
  const { data } = await res.json()
  // Unknown hashes come back as an empty `data`; a mempool transaction has block_id -1.
  const blockId = data?.[hash]?.transaction?.block_id
  return typeof blockId === 'number' && blockId > 0 ? 'completed' : 'pending'
}

// Tendermint RPC: a hash the node has not indexed is an error whose data says "not found".
async function tendermintStatus(chain: Chain, hash: string): Promise<TransferStatus> {
  const res = await fetchFirst(rpcUrls(chain), `/tx?hash=0x${hash.startsWith('0x') ? hash.slice(2) : hash}`)
  const { result, error } = await res.json()
  if (error) {
    if (String(error.data).includes('not found')) return 'pending'
    throw new Error(error.data ?? error.message)
  }
  if (!result?.tx_result) throw new Error(`${chain} RPC returned no result for ${hash}`)
  // Protobuf JSON may omit a zero-valued field, so a missing code is code 0: success.
  return (result.tx_result.code ?? 0) === 0 ? 'completed' : 'failed'
}

// An unconfirmed transaction is `{}`. A TRC-20 call carries its outcome in `receipt.result`; a plain
// TRX transfer has none, and only a failed one sets the top-level `result`.
async function tronStatus(hash: string): Promise<TransferStatus> {
  const info = await postFirst(rpcUrls(Chain.Tron), '/wallet/gettransactioninfobyid', { value: hash })
  if (!info?.blockNumber) return 'pending'
  if (info.result === 'FAILED') return 'failed'
  const receiptResult = info.receipt?.result
  return !receiptResult || receiptResult === 'SUCCESS' ? 'completed' : 'failed'
}

async function solanaStatus(hash: string): Promise<TransferStatus> {
  const { result, error } = await postFirst(rpcUrls(Chain.Solana), '', {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignatureStatuses',
    params: [[hash], { searchTransactionHistory: true }]
  })
  if (error) throw new Error(error.message)
  const status = result?.value?.[0]
  if (!status) return 'pending'
  if (status.err) return 'failed'
  return status.confirmationStatus === 'finalized' || status.confirmationStatus === 'confirmed' ? 'completed' : 'pending'
}

// Only a validated ledger is final; any result other than tesSUCCESS (tec*) still burned the fee.
async function rippleStatus(hash: string): Promise<TransferStatus> {
  const { result } = await postFirst(XRPL_RPC_URLS, '', { method: 'tx', params: [{ transaction: hash }] })
  if (result?.error === 'txnNotFound') return 'pending'
  if (result?.error) throw new Error(result.error_message ?? result.error)
  if (!result?.validated) return 'pending'
  return result.meta?.TransactionResult === 'tesSUCCESS' ? 'completed' : 'failed'
}

const statusLookup = (chain: Chain): ((hash: string) => Promise<TransferStatus>) | undefined => {
  if (EVMChains.includes(chain as EVMChain)) return hash => evmStatus(chain as EVMChain, hash)
  const blockchairSlug = BLOCKCHAIR_CHAINS[chain as UTXOChain]
  if (blockchairSlug) return hash => utxoStatus(blockchairSlug, hash)
  if (TENDERMINT_CHAINS.includes(chain)) return hash => tendermintStatus(chain, hash)
  if (chain === Chain.Tron) return tronStatus
  if (chain === Chain.Solana) return solanaStatus
  if (chain === Chain.Ripple) return rippleStatus
  return undefined
}

export async function getTransferStatus(chain: Chain, hash: string): Promise<TransferStatus> {
  const lookup = statusLookup(chain)
  if (!lookup) return 'unsupported'
  return lookup(hash)
}
