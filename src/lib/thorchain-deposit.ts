import { binToHex, encodeTransaction, hexToBin, utf8ToBin } from '@bitauth/libauth'
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize'
import { addressToLockingBytecode, normalizeTxid } from '@/lib/bch'

// The reverse bridge's THORChain leg: a BCH deposit to THORChain's vault carrying the swap memo,
// built here and signed in the bound BCH wallet. THORChain refunds to the address of the first
// input, so every input is the bound wallet's own. Pure functions, tested on fixtures.

// BCH kept back from a token sale's proceeds for the deposit's own miner fee.
export const DEPOSIT_FEE_RESERVE = 1_000n
// THORChain ignores BCH deposits below its dust threshold (inbound_addresses dust_threshold).
export const BCH_DUST_THRESHOLD = 10_000n
// BCH relays OP_RETURN data up to 223 bytes, but THORChain reads at most 80 bytes of memo.
export const MAX_MEMO_BYTES = 80
// Change below this is not worth an output; it goes to the miner.
const CHANGE_DUST = 546n
const P2PKH_UNLOCK_BYTES = 100

export class DepositError extends Error {}

// --- THORNode inbound address --------------------------------------------------------------------

export interface InboundAddress {
  chain: string
  address: string
  router?: string
  halted?: boolean
  chain_trading_paused?: boolean
  global_trading_paused?: boolean
  gas_rate?: string
  dust_threshold?: string
}

// The BCH vault a deposit may pay: THORNode's current BCH inbound address, and only while BCH
// trading is open; plus the destination chain's router, whose TransferOut event is the payout.
export const checkInbound = (inbounds: InboundAddress[], quotedVault: string, destinationChain: string) => {
  const bch = inbounds.find(i => i.chain === 'BCH')
  if (!bch) throw new DepositError('THORChain has no BCH vault right now')
  if (bch.halted || bch.chain_trading_paused || bch.global_trading_paused) throw new DepositError('THORChain has paused BCH trading')
  const vaultScript = addressToLockingBytecode(bch.address)
  if (!vaultScript || vaultScript !== addressToLockingBytecode(quotedVault)) throw new DepositError('The quoted vault is not THORChain’s current BCH vault')
  const destination = inbounds.find(i => i.chain === destinationChain)
  if (!destination || destination.halted || destination.chain_trading_paused) throw new DepositError(`THORChain has paused ${destinationChain} payouts`)
  const gasRate = BigInt(Math.min(10, Math.max(1, Number(bch.gas_rate) || 1)))
  return { vaultScript, router: destination.router, feeRate: gasRate }
}

// --- Memo ----------------------------------------------------------------------------------------

// The quoted memo must swap to the asked asset and pay the asked address: `=:ASSET:DEST[:LIMIT...]`
// (also `s`/`swap`). THORChain accepts the asset in its short form (BASE.USDC for
// BASE.USDC-0X8335...), which the aggregator uses to fit the 80 bytes.
export const checkDepositMemo = (memo: string, { buyAsset, destination }: { buyAsset: string; destination: string }) => {
  if (utf8ToBin(memo).length > MAX_MEMO_BYTES) throw new DepositError('The swap memo is longer than THORChain reads')
  const [action, asset = '', dest = ''] = memo.split(':')
  if (!['=', 's', 'swap'].includes(action.toLowerCase())) throw new DepositError('The memo is not a swap')
  const want = buyAsset.toUpperCase()
  const got = asset.toUpperCase()
  const [chainSymbol] = want.split('-')
  if (got !== want && got !== chainSymbol) throw new DepositError('The memo swaps to a different asset')
  if (dest.toLowerCase() !== destination.toLowerCase()) throw new DepositError('The memo pays a different address')
}

// --- Deposit transaction ---------------------------------------------------------------------------

export interface DepositIntent {
  // Token-free outputs of the bound address, all spent.
  funding: { txid: string; vout: number; value: string }[]
  lockingBytecode: string
  vaultScript: string
  memo: string
  // Satoshis to the vault; with `payAll` the vault gets everything but the fee and no change is made.
  amountSats?: bigint
  payAll?: boolean
  feeRate: bigint
}

export interface BuiltDeposit {
  unsignedHex: string
  sourceOutputs: ReturnType<typeof sourceOutputToRelay>[]
  ownIndexes: number[]
  amountSats: bigint
  minerFeeSats: bigint
  changeSats: bigint
}

const opReturn = (memo: string) => {
  const data = utf8ToBin(memo)
  return Uint8Array.from([0x6a, ...(data.length > 75 ? [0x4c, data.length] : [data.length]), ...data])
}

// Vault output first (THORChain reads the first output not paying the sender), then the memo, then
// change back to the bound address.
export const buildDeposit = (intent: DepositIntent): BuiltDeposit => {
  if (intent.funding.length === 0) throw new DepositError('No BCH to deposit')
  const own = hexToBin(intent.lockingBytecode)
  const vault = hexToBin(intent.vaultScript)
  const total = intent.funding.reduce((sum, f) => sum + BigInt(f.value), 0n)
  const inputs = intent.funding.map(f => ({
    outpointTransactionHash: hexToBin(normalizeTxid(f.txid)),
    outpointIndex: f.vout,
    sequenceNumber: 0xffffffff,
    unlockingBytecode: new Uint8Array()
  }))
  const assemble = (amount: bigint, change: bigint) => ({
    version: 2,
    locktime: 0,
    inputs,
    outputs: [
      { lockingBytecode: vault, valueSatoshis: amount },
      { lockingBytecode: opReturn(intent.memo), valueSatoshis: 0n },
      ...(change > 0n ? [{ lockingBytecode: own, valueSatoshis: change }] : [])
    ]
  })
  const feeFor = (tx: ReturnType<typeof assemble>) => BigInt(encodeTransaction(tx).length + P2PKH_UNLOCK_BYTES * inputs.length) * intent.feeRate

  let amount: bigint
  let change = 0n
  let fee: bigint
  if (intent.payAll) {
    fee = feeFor(assemble(total, 0n))
    amount = total - fee
  } else {
    amount = intent.amountSats ?? 0n
    fee = feeFor(assemble(amount, 1n))
    change = total - amount - fee
    if (change < CHANGE_DUST) {
      // No change output: what is left over (dust) goes to the miner, if it pays the fee at all.
      if (total - amount < feeFor(assemble(amount, 0n))) throw new DepositError('The BCH does not cover the deposit and its fee')
      fee = total - amount
      change = 0n
    }
  }
  if (amount < BCH_DUST_THRESHOLD) throw new DepositError('The deposit is below THORChain’s BCH minimum')
  if (fee < 0n || amount + fee + change !== total) throw new DepositError('The BCH does not cover the deposit and its fee')

  const tx = assemble(amount, change)
  return {
    unsignedHex: binToHex(encodeTransaction(tx)),
    sourceOutputs: tx.inputs.map((input, i) =>
      sourceOutputToRelay({ ...input, lockingBytecode: own, valueSatoshis: BigInt(intent.funding[i].value) })
    ),
    ownIndexes: tx.inputs.map((_, i) => i),
    amountSats: amount,
    minerFeeSats: total - amount - change,
    changeSats: change
  }
}

// --- Payout on the EVM chain -----------------------------------------------------------------------

// keccak256("TransferOut(address,address,address,uint256,string)") of THORChain's router.
export const TRANSFER_OUT_TOPIC = '0xa9cd03aa3c1b4515114539cd53d22085129d495cb9e9f9af77864526240f1bf7'

export interface RouterLog {
  topics: string[]
  data: string
  transactionHash: string
  blockNumber: number
}

const word = (data: string, index: number) => data.slice(2 + index * 64, 2 + (index + 1) * 64)

// The router's TransferOut paying `destination` for the deposit `depositTxid` (memo OUT:<txid>).
// The memo, recipient and asset are read from the event itself.
export const matchPayout = (logs: RouterLog[], { destination, depositTxid }: { destination: string; depositTxid: string }) => {
  const recipient = `0x${'0'.repeat(24)}${destination.toLowerCase().replace(/^0x/, '')}`
  const memo = `OUT:${normalizeTxid(depositTxid)}`.toUpperCase()
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_OUT_TOPIC || log.topics[2]?.toLowerCase() !== recipient) continue
    try {
      const amount = BigInt(`0x${word(log.data, 1)}`)
      const memoOffset = Number(BigInt(`0x${word(log.data, 2)}`)) / 32
      const memoLength = Number(BigInt(`0x${word(log.data, memoOffset)}`))
      const memoHex = log.data.slice(2 + (memoOffset + 1) * 64, 2 + (memoOffset + 1) * 64 + memoLength * 2)
      const text = new TextDecoder().decode(hexToBin(memoHex))
      if (text.toUpperCase() === memo) return { hash: log.transactionHash, amount: amount.toString(), asset: `0x${word(log.data, 0).slice(24)}` }
    } catch {
      // A malformed log is not ours.
    }
  }
  return undefined
}
