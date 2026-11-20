import {
  binToHex,
  createVirtualMachineBch2026,
  encodeTransaction,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1,
  type Output,
  type Transaction
} from '@bitauth/libauth'
import { decodeTx, listWalletCoins, normalizeTxid, txidOf, type ScriptUtxo } from '@/lib/bch'
import {
  bestTrade,
  broadcastBchTransaction,
  CauldronError,
  checkPoolCovenants,
  checkPoolsLive,
  checkSigned,
  prepareTokenTrade,
  quoteToken,
  reviewBuild,
  sourcesOf,
  tradeTransaction,
  type FundingOutput,
  type ReviewedSwap
} from '@/lib/cauldron'
import {
  ARRIVAL_REFUND_FEE_CAP,
  arrivalBinding,
  arrivalMinimum,
  arrivalRedeemScript,
  arrivalUnlock,
  parseArrivalUnlock,
  type ArrivalTerms
} from '@/lib/swap-on-arrival'

// Hashi-style arrival engine: after a bridge pays the SwapOnArrival P2SH20, the browser trade key
// buys the CashToken on Cauldron (or releases / reclaims to the owner). Soft statuses keep the UI
// smooth — waiting and below-floor are retries, not hard failures.

export type ArrivalTradeStatus =
  | { kind: 'Waiting'; reason: 'no_coin' | 'price' | 'confirming' }
  | { kind: 'BelowFloor'; sats: bigint; minimum: bigint; available: bigint }
  | { kind: 'FeeShortfall'; attempt: number }
  | { kind: 'TradeLayoutError'; message: string }
  | { kind: 'BroadcastConflict'; attempt: number }
  | { kind: 'Swapped'; txid: string; signedHex: string; tokens: bigint; soldSats: bigint }
  | { kind: 'Released'; txid: string; signedHex: string; sats: bigint }
  | { kind: 'Reclaimed'; txid: string; signedHex: string; sats: bigint }

export class ArrivalTradeError extends Error {
  constructor(
    readonly status: ArrivalTradeStatus,
    message?: string
  ) {
    super(
      message ??
        (status.kind === 'TradeLayoutError'
          ? status.message
          : status.kind === 'BelowFloor'
            ? `BelowFloor: need ${status.minimum}, have ${status.available}`
            : status.kind)
    )
    this.name = 'ArrivalTradeError'
  }
}

const DUST = 546n
const MAX_FEE_TOPUPS = 4
const MAX_BROADCAST_RETRIES = 3
const FEE_RESERVE_STEP = 400n
const BASE_FEE_RESERVE = 800n
const vm = createVirtualMachineBch2026(true)

const tradeKeyBin = (hex: string) => {
  const key = hexToBin(hex)
  if (key.length !== 32) throw new Error('trade private key must be 32 bytes')
  return key
}

const signInput = (transaction: Transaction, sourceOutputs: Output[], inputIndex: number, terms: ArrivalTerms, privateKey: Uint8Array) => {
  const preimage = generateSigningSerializationBch(
    { inputIndex, sourceOutputs, transaction },
    { coveredBytecode: arrivalRedeemScript(terms), signingSerializationType: Uint8Array.of(0x61) }
  )
  return Uint8Array.from([...secp256k1.signMessageHashSchnorr(privateKey, hash256(preimage)), 0x61])
}

const plainCoins = (utxos: ScriptUtxo[]): FundingOutput[] =>
  utxos.filter(u => !u.hasToken && u.value >= DUST).map(u => ({ txid: u.txid, vout: u.vout, value: u.value.toString() }))

const signReviewedSwap = (reviewed: ReviewedSwap, terms: ArrivalTerms, privateKeyHex: string) => {
  const privateKey = tradeKeyBin(privateKeyHex)
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  for (const i of reviewed.ownIndexes) {
    transaction.inputs[i].unlockingBytecode = arrivalUnlock(terms, 'swap', signInput(transaction, sourceOutputs, i, terms, privateKey))
  }
  const signedHex = binToHex(encodeTransaction(transaction))
  const txid = checkSigned(reviewed.unsignedHex, signedHex, reviewed.ownIndexes, sourceOutputs, terms.tradeKey, parseArrivalUnlock(terms))
  return { txid, signedHex, tokens: reviewed.output, soldSats: reviewed.sell }
}

const buildSwapAttempt = async (terms: ArrivalTerms, funding: FundingOutput[], sellCeiling: bigint, minTokens: bigint): Promise<ReviewedSwap> => {
  const contract = arrivalBinding(terms, 0)
  const unlockBytes = arrivalUnlock(terms, 'swap', new Uint8Array(65)).length + 2
  const reviewed = await prepareTokenTrade(
    {
      category: terms.category,
      side: 'buy',
      funding,
      lockingBytecode: contract.lockingBytecode,
      tokenAddress: contract.tokenAddress,
      cashAddress: contract.cashAddress,
      payout: { tokenScript: terms.ownerScript, changeScript: terms.ownerScript },
      ownUnlockBytes: unlockBytes
    },
    sellCeiling,
    () => (minTokens > 0n ? minTokens : 1n)
  )
  if (reviewed.output < minTokens) {
    throw new ArrivalTradeError({
      kind: 'BelowFloor',
      sats: funding.reduce((s, f) => s + BigInt(f.value), 0n),
      minimum: minTokens,
      available: reviewed.output
    })
  }
  // Contract binds payout to each coin's own input index — one funding coin only.
  if (reviewed.ownIndexes.length !== 1) {
    throw new ArrivalTradeError({ kind: 'TradeLayoutError', message: 'SwapOnArrival accepts one funding coin per swap' })
  }
  checkPoolCovenants(reviewed)
  return reviewed
}

export interface CompleteArrivalOptions {
  terms: ArrivalTerms
  tradePrivateKeyHex: string
  coins?: FundingOutput[]
  feeReserve?: bigint
  slippageBps?: number
  broadcast?: boolean
  signal?: AbortSignal
}

export const completeArrivalTrade = async (opts: CompleteArrivalOptions): Promise<ArrivalTradeStatus> => {
  const { terms, tradePrivateKeyHex, broadcast = true, signal } = opts
  const contract = arrivalBinding(terms, 0)
  let funding = opts.coins
  if (!funding) {
    const { utxos } = await listWalletCoins(contract.lockingBytecode)
    funding = plainCoins(utxos)
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (funding.length === 0) return { kind: 'Waiting', reason: 'no_coin' }

  funding = [...funding].sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1)).slice(0, 1)
  const sats = BigInt(funding[0].value)
  const contractMin = arrivalMinimum(terms, sats)
  if (contractMin <= 0n) return { kind: 'Waiting', reason: 'price' }

  let feeReserve = opts.feeReserve ?? BASE_FEE_RESERVE

  for (let attempt = 0; attempt <= MAX_FEE_TOPUPS; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const sellCeiling = sats - feeReserve
    if (sellCeiling < DUST) return { kind: 'FeeShortfall', attempt }

    try {
      let demand: bigint
      try {
        demand = (await quoteToken({ category: terms.category, side: 'buy', amount: sellCeiling })).output
      } catch {
        return { kind: 'Waiting', reason: 'price' }
      }
      if (demand < contractMin) return { kind: 'BelowFloor', sats, minimum: contractMin, available: demand }

      const bps = BigInt(opts.slippageBps ?? 200)
      const slipped = demand - (demand * bps) / 10_000n
      const minTokens = slipped > contractMin ? slipped : contractMin

      const reviewed = await buildSwapAttempt(terms, funding, sellCeiling, minTokens)
      await checkPoolsLive(reviewed)
      const signed = signReviewedSwap(reviewed, terms, tradePrivateKeyHex)

      if (!broadcast) return { kind: 'Swapped', ...signed }

      for (let broadcastAttempt = 0; broadcastAttempt < MAX_BROADCAST_RETRIES; broadcastAttempt++) {
        try {
          await broadcastBchTransaction(signed.signedHex, signed.txid)
          return { kind: 'Swapped', ...signed }
        } catch {
          if (broadcastAttempt + 1 >= MAX_BROADCAST_RETRIES) return { kind: 'BroadcastConflict', attempt: broadcastAttempt + 1 }
        }
      }
    } catch (error) {
      if (error instanceof ArrivalTradeError) {
        if (error.status.kind === 'BelowFloor' || error.status.kind === 'TradeLayoutError') return error.status
        throw error
      }
      if (
        (error instanceof CauldronError && error.code === 'insufficient_funds') ||
        (error instanceof Error && /miner fee|fee is too low|insufficient/i.test(error.message))
      ) {
        feeReserve += FEE_RESERVE_STEP
        continue
      }
      throw error
    }
  }

  return { kind: 'FeeShortfall', attempt: MAX_FEE_TOPUPS }
}

export interface ArrivalReturnOptions {
  terms: ArrivalTerms
  tradePrivateKeyHex?: string
  coin: FundingOutput
  fee?: bigint
  locktime?: number
  mode: 'release' | 'reclaim'
  broadcast?: boolean
}

export const buildArrivalReturn = async (opts: ArrivalReturnOptions): Promise<ArrivalTradeStatus> => {
  const { terms, coin, mode, broadcast = true } = opts
  const value = BigInt(coin.value)
  const fee = opts.fee ?? 400n
  if (fee > ARRIVAL_REFUND_FEE_CAP) throw new ArrivalTradeError({ kind: 'TradeLayoutError', message: 'Refund fee exceeds contract cap' })
  if (value <= fee + DUST) throw new ArrivalTradeError({ kind: 'TradeLayoutError', message: 'Coin too small to return' })

  const contract = arrivalBinding(terms, 0)
  const locktime = mode === 'reclaim' ? (opts.locktime ?? terms.refundAfter) : 0
  if (mode === 'reclaim' && locktime < terms.refundAfter) return { kind: 'Waiting', reason: 'confirming' }

  const transaction: Transaction = {
    version: 2,
    locktime,
    inputs: [
      {
        outpointTransactionHash: hexToBin(normalizeTxid(coin.txid)),
        outpointIndex: coin.vout,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: new Uint8Array()
      }
    ],
    outputs: [{ lockingBytecode: hexToBin(terms.ownerScript), valueSatoshis: value - fee }]
  }
  const sourceOutputs: Output[] = [{ lockingBytecode: hexToBin(contract.lockingBytecode), valueSatoshis: value }]

  if (mode === 'release') {
    if (!opts.tradePrivateKeyHex) throw new Error('release needs the trade private key')
    transaction.inputs[0].unlockingBytecode = arrivalUnlock(
      terms,
      'release',
      signInput(transaction, sourceOutputs, 0, terms, tradeKeyBin(opts.tradePrivateKeyHex))
    )
  } else {
    transaction.inputs[0].unlockingBytecode = arrivalUnlock(terms, 'reclaim')
  }

  const verified = vm.verify({ sourceOutputs, transaction })
  if (verified !== true) {
    throw new ArrivalTradeError({ kind: 'TradeLayoutError', message: `Return transaction does not verify: ${verified}` })
  }

  const signedHex = binToHex(encodeTransaction(transaction))
  const txid = txidOf(signedHex)
  if (broadcast) {
    for (let attempt = 0; attempt < MAX_BROADCAST_RETRIES; attempt++) {
      try {
        await broadcastBchTransaction(signedHex, txid)
        break
      } catch {
        if (attempt + 1 >= MAX_BROADCAST_RETRIES) return { kind: 'BroadcastConflict', attempt: attempt + 1 }
      }
    }
  }

  return mode === 'release' ? { kind: 'Released', txid, signedHex, sats: value - fee } : { kind: 'Reclaimed', txid, signedHex, sats: value - fee }
}

export const arrivalCanClearFloor = (terms: ArrivalTerms, sats: bigint, poolDemandForSell: bigint) => {
  const minimum = arrivalMinimum(terms, sats)
  return { minimum, ok: poolDemandForSell >= minimum && minimum > 0n }
}

export const buildArrivalSwapLocal = (
  terms: ArrivalTerms,
  funding: FundingOutput[],
  sell: bigint,
  pools: Parameters<typeof bestTrade>[0]
) => {
  const contract = arrivalBinding(terms, 0)
  const unlockBytes = arrivalUnlock(terms, 'swap', new Uint8Array(65)).length + 2
  const trade = bestTrade(pools, sell, terms.category, 'buy')
  const intent = {
    category: terms.category,
    side: 'buy' as const,
    funding,
    lockingBytecode: contract.lockingBytecode,
    tokenAddress: contract.tokenAddress,
    cashAddress: contract.cashAddress,
    payout: { tokenScript: terms.ownerScript, changeScript: terms.ownerScript },
    sell,
    minOutput: arrivalMinimum(
      terms,
      funding.reduce((s, f) => s + BigInt(f.value), 0n)
    ),
    ownUnlockBytes: unlockBytes
  }
  return reviewBuild(tradeTransaction(trade, intent), intent)
}
