import { base58ToBin, base64ToBin, binToHex, hexToBin } from '@bitauth/libauth'
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing'
import { normalizeTxid, opReturnText } from '@/lib/bch'
import { sameAddress } from '@/lib/payout-chains'

// THORChain's payout of a reverse bridge on a chain without a router contract: THORNode names the
// outbound, and it counts only once that chain's own node shows a successful transaction paying the
// destination (in the asset's base units) with the memo OUT:<deposit txid>. Parsers are pure and
// tested on fixtures; the fetchers live in reverse-bridge.ts.

export interface ChainPayout {
  hash: string
  amount: string
}

export interface PayoutExpectation {
  destination: string
  // THORChain's payout carries OUT:<deposit txid>. Absent for a NEAR Intents payout, which carries no memo: its hash
  // comes from 1Click's status and the transaction only has to pay the destination.
  depositTxid?: string
  // The asked THORChain asset, e.g. TRON.USDT-TR7NHQ... (its contract identifies a token payout).
  buyAsset: string
}

// Chains only THORChain pays here (Cosmos Hub, THORChain itself): the memo always names the deposit.
type ThorchainExpectation = PayoutExpectation & { depositTxid: string }

const decoder = new TextDecoder()
const textOf = (hex: string) => {
  try {
    return decoder.decode(hexToBin(hex))
  } catch {
    return ''
  }
}

const isOutMemo = (text: string | undefined, depositTxid: string) => text?.trim().toUpperCase() === `OUT:${normalizeTxid(depositTxid)}`.toUpperCase()
// Without a deposit txid to name (a payout found by its hash alone), a memo is not asked for.
const memoMatches = (text: string | undefined, depositTxid?: string) => depositTxid === undefined || isOutMemo(text, depositTxid)

// --- UTXO chains (the transaction dashboard of /api/blockchair, Blockchair-shaped) ----------------------------------------------

interface BlockchairOutput {
  recipient?: string
  value?: number | string
  script_hex?: string
}

export const utxoPayout = (dashboard: unknown, hash: string, expect: PayoutExpectation): ChainPayout | undefined => {
  const data = (dashboard as { data?: Record<string, { transaction?: unknown; outputs?: BlockchairOutput[] }> })?.data ?? {}
  const entry = data[hash] ?? data[hash.toLowerCase()]
  // An unknown hash is an empty `data`; a mempool transaction is accepted (0-conf).
  if (!entry?.transaction || !Array.isArray(entry.outputs)) return undefined
  const memo = entry.outputs.map(o => (o.script_hex?.startsWith('6a') ? opReturnText(hexToBin(o.script_hex)) : undefined)).find(Boolean)
  if (!memoMatches(memo, expect.depositTxid)) return undefined
  const paid = entry.outputs.filter(o => o.recipient && sameAddress(o.recipient, expect.destination)).reduce((sum, o) => sum + BigInt(o.value ?? 0), 0n)
  return paid > 0n ? { hash, amount: paid.toString() } : undefined
}

// --- XRP Ledger (`tx` JSON-RPC) ---------------------------------------------------------------------

interface XrpTx {
  validated?: boolean
  TransactionType?: string
  Destination?: string
  Memos?: { Memo?: { MemoData?: string } }[]
  meta?: { TransactionResult?: string; delivered_amount?: unknown }
}

// Only a validated ledger is final; native XRP's delivered amount is a string of drops.
export const xrpPayout = (result: unknown, hash: string, expect: PayoutExpectation): ChainPayout | undefined => {
  const tx = result as XrpTx
  if (!tx?.validated || tx.TransactionType !== 'Payment' || tx.meta?.TransactionResult !== 'tesSUCCESS') return undefined
  if (!tx.Destination || tx.Destination !== expect.destination) return undefined
  if (expect.depositTxid !== undefined && !(tx.Memos ?? []).some(m => memoMatches(textOf(m.Memo?.MemoData ?? ''), expect.depositTxid))) return undefined
  const delivered = tx.meta.delivered_amount
  return typeof delivered === 'string' && /^\d+$/.test(delivered) ? { hash, amount: delivered } : undefined
}

// --- Solana (`getTransaction`, jsonParsed) ------------------------------------------------------------

interface SolInstruction {
  program?: string
  parsed?: unknown
}

export const solanaPayout = (result: unknown, hash: string, expect: PayoutExpectation): ChainPayout | undefined => {
  const tx = result as { meta?: { err?: unknown; innerInstructions?: { instructions?: SolInstruction[] }[] }; transaction?: { message?: { instructions?: SolInstruction[] } } }
  if (!tx?.meta || tx.meta.err) return undefined
  const instructions = [...(tx.transaction?.message?.instructions ?? []), ...(tx.meta.innerInstructions ?? []).flatMap(i => i.instructions ?? [])]
  // A memo, when the transaction carries one, must be this deposit's.
  const memos = instructions.filter(i => i.program === 'spl-memo' && typeof i.parsed === 'string').map(i => i.parsed as string)
  if (memos.length && !memos.some(m => memoMatches(m, expect.depositTxid))) return undefined
  let paid = 0n
  for (const i of instructions) {
    const parsed = i.parsed as { type?: string; info?: { destination?: string; lamports?: number | string } } | undefined
    if (i.program === 'system' && parsed?.type === 'transfer' && parsed.info?.destination === expect.destination) paid += BigInt(parsed.info.lamports ?? 0)
  }
  return paid > 0n ? { hash, amount: paid.toString() } : undefined
}

// --- TRON (`gettransactionbyid` + `gettransactioninfobyid`) ----------------------------------------

// A base58check TRON address as the 21-byte hex (41...) its node reports.
export const tronHex = (address: string) => {
  const bin = base58ToBin(address)
  return typeof bin === 'string' || bin.length !== 25 ? undefined : binToHex(bin.slice(0, 21)).toLowerCase()
}

const TRC20_TRANSFER = 'a9059cbb'

export const tronPayout = (tx: unknown, info: unknown, hash: string, expect: PayoutExpectation): ChainPayout | undefined => {
  const t = tx as { raw_data?: { data?: string; contract?: { type?: string; parameter?: { value?: Record<string, unknown> } }[] } }
  const i = info as { blockNumber?: number; result?: string; receipt?: { result?: string } }
  // A TRC-20 call carries its outcome in `receipt.result`; a failed plain transfer sets `result`.
  if (!i?.blockNumber || i.result === 'FAILED' || (i.receipt?.result && i.receipt.result !== 'SUCCESS')) return undefined
  const memo = t?.raw_data?.data
  if (memo && !memoMatches(textOf(memo), expect.depositTxid)) return undefined
  const to = tronHex(expect.destination)
  const contract = t?.raw_data?.contract?.[0]
  const value = contract?.parameter?.value ?? {}
  if (!to || !contract) return undefined
  const token = expect.buyAsset.split('-')[1]
  if (!token) {
    if (contract.type !== 'TransferContract' || String(value.to_address).toLowerCase() !== to) return undefined
    return { hash, amount: BigInt(value.amount as number).toString() }
  }
  const data = String(value.data ?? '').toLowerCase()
  if (contract.type !== 'TriggerSmartContract' || String(value.contract_address).toLowerCase() !== tronHex(token)) return undefined
  if (!data.startsWith(TRC20_TRANSFER) || `41${data.slice(8 + 24, 8 + 64)}` !== to) return undefined
  return { hash, amount: BigInt(`0x${data.slice(8 + 64, 8 + 128)}`).toString() }
}

// --- EVM chains, paid by NEAR Intents (a receipt and its transaction) -----------------------------------------------------

// keccak256("Transfer(address,address,uint256)") of ERC-20.
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// A successful transaction paying the destination: the token's Transfer events to it, or for the chain's own coin a
// plain transfer to it. THORChain's EVM payouts go through its router instead (matchPayout in thorchain-deposit.ts).
export const evmTransferPayout = (
  receipt: { status?: number | null; logs: readonly { address: string; topics: readonly string[]; data: string }[] } | null,
  tx: { to?: string | null; value?: bigint } | null,
  hash: string,
  expect: PayoutExpectation
): ChainPayout | undefined => {
  if (!receipt || receipt.status !== 1) return undefined
  const token = expect.buyAsset.split('-')[1]
  if (!token) return tx?.to && sameAddress(tx.to, expect.destination) && tx.value && tx.value > 0n ? { hash, amount: tx.value.toString() } : undefined
  const to = `0x${expect.destination.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`
  const paid = receipt.logs
    .filter(l => l.address.toLowerCase() === token.toLowerCase() && l.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === to)
    .reduce((sum, l) => sum + BigInt(l.data), 0n)
  return paid > 0n ? { hash, amount: paid.toString() } : undefined
}

// --- Cosmos Hub (Tendermint `/tx`) ---------------------------------------------------------------------

const registry = new Registry()

export const cosmosPayout = (result: unknown, hash: string, expect: ThorchainExpectation, denom = 'uatom'): ChainPayout | undefined => {
  const r = result as { tx?: string; tx_result?: { code?: number } }
  // Protobuf JSON may omit a zero-valued field, so a missing code is code 0: success.
  if (!r?.tx || (r.tx_result?.code ?? 0) !== 0) return undefined
  const decoded = decodeTxRaw(base64ToBin(r.tx) as Uint8Array)
  if (!isOutMemo(decoded.body.memo, expect.depositTxid)) return undefined
  let paid = 0n
  for (const message of decoded.body.messages) {
    if (message.typeUrl !== '/cosmos.bank.v1beta1.MsgSend') continue
    const send = registry.decode(message) as { toAddress: string; amount: { denom: string; amount: string }[] }
    if (send.toAddress !== expect.destination) continue
    for (const coin of send.amount) if (coin.denom === denom) paid += BigInt(coin.amount)
  }
  return paid > 0n ? { hash, amount: paid.toString() } : undefined
}

// --- THORChain itself ------------------------------------------------------------------------------------

// RUNE and THORChain-native tokens are paid inside THORChain, so THORNode is that chain's own node: its
// recorded outbound (id all zeros) is the payout, linked by the deposit's hash.
export const thorchainPayout = (
  out: { id: string; chain: string; to_address?: string; coins: { asset: string; amount: string }[]; memo?: string },
  expect: ThorchainExpectation
): ChainPayout | undefined => {
  if (out.chain?.toUpperCase() !== 'THOR' || !out.to_address || !sameAddress(out.to_address, expect.destination)) return undefined
  if (!isOutMemo(out.memo, expect.depositTxid)) return undefined
  const coin = out.coins?.find(c => c.asset?.toUpperCase() === expect.buyAsset.toUpperCase())
  if (!coin) return undefined
  const hash = /^0+$/.test(out.id) ? normalizeTxid(expect.depositTxid).toUpperCase() : out.id
  return { hash, amount: coin.amount }
}
