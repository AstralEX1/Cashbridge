import {
  binToHex,
  binsAreEqual,
  createVirtualMachineBch2026,
  encodeTransaction,
  encodeTransactionOutputs,
  generatePrivateKey,
  hexToBin,
  type Output,
  type Transaction
} from '@bitauth/libauth'
import { ExchangeLab, type PoolV0, type TradeResult, type TradeTxResult } from '@cashlab/cauldron'
import { InsufficientCapitalInPools } from '@cashlab/cauldron/exchange-lab.js'
import { NATIVE_BCH_TOKEN_ID, PayoutAmountRuleType, SpendableCoinType } from '@cashlab/common/constants.js'
import { InsufficientFunds } from '@cashlab/common/exceptions.js'
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize'
import { BridgeConfig } from '@/config'
import { broadcastTransaction, checkOutpointsLive, decodeTx, normalizeTxid, RpcError, RpcTimeoutError, txidOf } from '@/lib/bch'

// BCH -> PUSD on Cauldron: quotes and unsigned trade transactions built from the live PUSD pools.
// Every transaction is checked here against what the user approved before it is shown for
// signing, and again after the wallet signs it.

export class CauldronError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

// --- Live pools --------------------------------------------------------------------------------

// The beta Cauldron router (route.quote / tx.build) priced and built from a stale pool set: in one
// check, every one of the 42 pool outputs its tx.build spent had been spent on chain a month
// earlier. Like Cauldron's own app, the trade is therefore built here from the PUSD pools in
// Cauldron's indexer with @cashlab/cauldron (pool selection and the trade transaction), and only
// pools still unspent on chain are traded against. The result goes through the same review as a
// router build (reviewBuild, checkPoolCovenants, checkPoolsLive) before anything is signed.

const lab = new ExchangeLab()
// 1 sat/byte, the relay minimum Cauldron's app also builds with.
const TX_FEE_PER_BYTE = 1n

export interface PusdQuote {
  // What the trade actually sells. Pools trade in steps, so this is at most the requested
  // amount; the rest stays in the wallet as change.
  sellSats: bigint
  requestedSats: bigint
  // PUSD base units (2 decimals).
  output: bigint
  pools: number
  // Satoshis of the sale kept by the pools as their liquidity provider fee.
  tradeFeeSats: bigint
  // PUSD base units the same sale would buy at the traded pools' current prices with no fee and no
  // price impact. Display only, so a float: PUSD's 2 decimals would round small differences away.
  spotOutput: number
  // The miner fee a transaction for this trade pays, from a local build with a stand-in funding coin.
  minerFeeSats?: bigint
}

// P2PKH of a zero key hash: only stands in for the wallet's script to size the trade transaction.
const STAND_IN_SCRIPT = `76a914${'00'.repeat(20)}88ac`

const quoteOf = (trade: TradeResult, requestedSats: bigint): PusdQuote => {
  const spotOutput = trade.entries.reduce((sum, e) => sum + (Number(e.supply) * Number(e.pool.output.token.amount)) / Number(e.pool.output.amount), 0)
  let minerFeeSats: bigint | undefined
  try {
    const funding = [{ txid: '00'.repeat(32), vout: 0, value: (trade.summary.supply + 100_000n).toString() }]
    const build = tradeTransaction(trade, { funding, lockingBytecode: STAND_IN_SCRIPT, tokenAddress: '', cashAddress: '', sellSats: trade.summary.supply, minOutput: 0n })
    minerFeeSats = BigInt(build.miner_fee_sats)
  } catch {
    // Only an estimate for display; the real build happens when the BCH arrives.
  }
  return {
    sellSats: trade.summary.supply,
    requestedSats,
    output: trade.summary.demand,
    pools: trade.entries.length,
    tradeFeeSats: trade.summary.trade_fee,
    spotOutput,
    minerFeeSats
  }
}

const fetchIndexedPools = async (): Promise<PoolV0[]> => {
  const { category } = BridgeConfig.pusd
  const response = await fetch(`${BridgeConfig.cauldronIndexerUrl}/cauldron/pool/active?token=${category}`, { signal: AbortSignal.timeout(15_000) }).catch(
    () => undefined
  )
  const body = (await response?.json().catch(() => undefined)) as { active?: unknown } | undefined
  if (!response?.ok || !Array.isArray(body?.active)) throw new CauldronError('pools_unavailable', 'Could not read the PUSD pools')
  return body.active.flatMap(raw => {
    const p = raw as { token_id?: unknown; owner_pkh?: unknown; txid?: unknown; tx_pos?: unknown; sats?: unknown; tokens?: unknown }
    if (
      p.token_id !== category ||
      typeof p.owner_pkh !== 'string' ||
      !/^[0-9a-f]{40}$/.test(p.owner_pkh) ||
      typeof p.txid !== 'string' ||
      !/^[0-9a-f]{64}$/.test(p.txid) ||
      !Number.isSafeInteger(p.tx_pos) ||
      !Number.isSafeInteger(p.sats) ||
      !Number.isSafeInteger(p.tokens) ||
      (p.sats as number) <= 0 ||
      (p.tokens as number) <= 0
    ) {
      return []
    }
    const parameters = { withdraw_pubkey_hash: hexToBin(p.owner_pkh) }
    return [
      {
        version: '0' as const,
        parameters,
        outpoint: { txhash: hexToBin(p.txid), index: p.tx_pos as number },
        output: {
          locking_bytecode: poolLockingBytecode(parameters.withdraw_pubkey_hash),
          token: { amount: BigInt(p.tokens as number), token_id: category },
          amount: BigInt(p.sats as number)
        }
      }
    ]
  })
}

// The trade selling at most `sellSats` BCH for PUSD at the best rate across `pools`.
export const bestTrade = (pools: PoolV0[], sellSats: bigint): TradeResult => {
  try {
    return lab.constructTradeBestRateForTargetSupply(NATIVE_BCH_TOKEN_ID, BridgeConfig.pusd.category, sellSats, pools, TX_FEE_PER_BYTE)
  } catch (error) {
    if (error instanceof InsufficientCapitalInPools) throw new CauldronError('route_failed', 'The PUSD pools cannot fill this amount')
    throw error
  }
}

export const poolLockingBytecode = (withdrawPubkeyHash: Uint8Array) => lab.generatePoolV0LockingBytecode({ withdraw_pubkey_hash: withdrawPubkeyHash })

const outpointOf = (pool: PoolV0) => `${binToHex(pool.outpoint.txhash)}:${pool.outpoint.index}`

// The best trade selling at most `sellSats` on pools that are unspent on chain right now: the
// indexer can lag, so each pool the trade picks is checked and the trade is redone without the
// spent ones.
const tradeOnLivePools = async (sellSats: bigint) => {
  if (sellSats <= 0n) throw new CauldronError('bad_request', 'Nothing to sell')
  let pools = await fetchIndexedPools()
  const live = new Set<string>()
  for (let round = 0; round < 4; round++) {
    const trade = bestTrade(pools, sellSats)
    const unchecked = trade.entries.filter(e => !live.has(outpointOf(e.pool)))
    const checked = await checkOutpointsLive(
      unchecked.map(e => ({
        txid: binToHex(e.pool.outpoint.txhash),
        vout: e.pool.outpoint.index,
        value: e.pool.output.amount,
        token: { category: e.pool.output.token.token_id, amount: e.pool.output.token.amount }
      }))
    )
    const spent = new Set(checked.filter(c => !c.live).map(c => `${c.txid}:${c.vout}`))
    checked.filter(c => c.live).forEach(c => live.add(`${c.txid}:${c.vout}`))
    if (spent.size === 0) {
      if (trade.summary.demand <= 0n) throw new CauldronError('route_failed', 'The PUSD pools cannot fill this amount')
      return trade
    }
    pools = pools.filter(p => !spent.has(outpointOf(p)))
  }
  throw new CauldronError('pools_unavailable', "Cauldron's pool list is behind the chain; try again shortly")
}

export const quotePusd = async (sellSats: bigint): Promise<PusdQuote> => {
  return quoteOf(await tradeOnLivePools(sellSats), sellSats)
}

export interface FundingOutput {
  txid: string
  vout: number
  value: string
}

export interface BuildIntent {
  funding: FundingOutput[]
  // P2PKH script of the bound wallet address (hex); both PUSD and BCH change return to it.
  lockingBytecode: string
  tokenAddress: string
  cashAddress: string
  sellSats: bigint
  minOutput: bigint
}

// The shape of a router tx.build answer, which reviewBuild checks; the local build produces it too.
interface BuildResult {
  unsigned_tx_hex: string
  source_outputs: { value: string; locking_script_hex: string; token?: { category: string; amount: string } }[]
  inputs_to_sign: number[]
  expected_output: string
  fee_sats: string
  fee_token_amount: string
  miner_fee_sats: string
  route: unknown
}

export const buildPusdSwap = async (intent: BuildIntent) => tradeTransaction(await tradeOnLivePools(intent.sellSats), intent)

// The unsigned transaction for `trade`: pool inputs first (each carrying its pool's redeem script),
// then the funding outputs with empty unlocking scripts for the wallet to sign. PUSD and all BCH
// change go to the bound address. @cashlab/cauldron only builds signed transactions, so the funding
// inputs are signed with a throwaway key that is never used for anything else, and those unlocking
// scripts are then removed; nothing it signs is kept.
export const tradeTransaction = (trade: TradeResult, intent: BuildIntent): BuildResult => {
  const ownScript = hexToBin(intent.lockingBytecode)
  const throwawayKey = generatePrivateKey()
  const coins = intent.funding.map(f => ({
    type: SpendableCoinType.P2PKH as const,
    key: throwawayKey,
    outpoint: { txhash: hexToBin(normalizeTxid(f.txid)), index: f.vout },
    output: { locking_bytecode: ownScript, amount: BigInt(f.value) }
  }))
  // createTradeTx reports funding below the sale as a ValueError; it is the same shortfall.
  const funded = intent.funding.reduce((sum, f) => sum + BigInt(f.value), 0n)
  if (funded < trade.summary.supply) throw new CauldronError('insufficient_funds', `The funding (${funded} sats) is below the sale (${trade.summary.supply} sats)`)
  let result: TradeTxResult
  try {
    result = lab.createTradeTx(
      trade.entries,
      coins,
      [{ type: PayoutAmountRuleType.CHANGE, locking_bytecode: ownScript, allow_mixing_native_and_token_when_bch_change_is_dust: true }],
      null,
      TX_FEE_PER_BYTE
    )
  } catch (error) {
    if (error instanceof InsufficientFunds) throw new CauldronError('insufficient_funds', error.message)
    throw error
  }
  const transaction = decodeTx(binToHex(result.txbin))
  const ownIndexes = transaction.inputs.flatMap((_, i) => (i >= trade.entries.length ? [i] : []))
  const unsigned = {
    ...transaction,
    inputs: transaction.inputs.map((input, i) => (ownIndexes.includes(i) ? { ...input, unlockingBytecode: new Uint8Array() } : input))
  }
  return {
    unsigned_tx_hex: binToHex(encodeTransaction(unsigned)),
    source_outputs: result.libauth_source_outputs.map(s => ({
      value: s.valueSatoshis.toString(),
      locking_script_hex: binToHex(s.lockingBytecode),
      ...(s.token && { token: { category: binToHex(s.token.category), amount: s.token.amount.toString() } })
    })),
    inputs_to_sign: ownIndexes,
    expected_output: trade.summary.demand.toString(),
    fee_sats: '0',
    fee_token_amount: '0',
    miner_fee_sats: result.txfee.toString(),
    route: { pools: trade.entries.length }
  }
}

// --- Validation --------------------------------------------------------------------------------

// Miner fee bounds against the size the signed transaction will have (1 sat/byte relays).
const MIN_FEE_RATE = 1n
const MAX_FEE_RATE = 5n
// A P2PKH unlocking script (push of a ~65-byte Schnorr signature and a 33-byte key) plus its length byte.
const P2PKH_UNLOCK_BYTES = 100n

export interface ReviewedSwap {
  unsignedHex: string
  // Relay-safe WizardConnect source outputs, aligned to the inputs.
  sourceOutputs: ReturnType<typeof sourceOutputToRelay>[]
  // Indexes of the inputs the bound wallet signs (exactly the verified funding outputs).
  ownIndexes: number[]
  sellSats: bigint
  // PUSD the transaction itself pays the bound address, and the approved floor.
  pusdOut: bigint
  minOutput: bigint
  expectedOutput: bigint
  // Satoshis leaving the user: the sale and the miner fee.
  debitSats: bigint
  // Always 0: no output may pay anyone but the wallet and the pools. Kept for the stored operation.
  routerFeeSats: bigint
  minerFeeSats: bigint
  // BCH back to the bound address as change and as the PUSD output's dust.
  returnedSats: bigint
}

type SourceOutput = Output & { lockingBytecode: Uint8Array }

const tokenKey = (o: Output) =>
  o.token ? `${binToHex(o.token.category)}|${o.token.nft ? `${o.token.nft.capability}:${binToHex(o.token.nft.commitment)}` : '-'}` : undefined

// Every CashToken that enters the transaction leaves it, and none is created: per category the
// fungible amounts match and the NFTs are the same multiset.
const tokensConserved = (inputs: Output[], outputs: Output[]) => {
  const fungible = new Map<string, bigint>()
  const nfts = new Map<string, number>()
  const tally = (o: Output, sign: 1 | -1) => {
    if (!o.token) return
    const category = binToHex(o.token.category)
    fungible.set(category, (fungible.get(category) ?? 0n) + BigInt(sign) * o.token.amount)
    if (o.token.nft) {
      const key = tokenKey(o)!
      nfts.set(key, (nfts.get(key) ?? 0) + sign)
    }
  }
  inputs.forEach(o => tally(o, 1))
  outputs.forEach(o => tally(o, -1))
  return [...fungible.values()].every(v => v === 0n) && [...nfts.values()].every(v => v === 0)
}

// Checks the unsigned trade transaction against the approved intent. Throws with the reason
// the transaction is refused; nothing that fails here is ever shown for signing.
export const reviewBuild = (build: BuildResult, intent: BuildIntent): ReviewedSwap => {
  const fail = (reason: string): never => {
    throw new CauldronError('rejected_build', reason)
  }

  const tx = decodeTx(build.unsigned_tx_hex)
  if (build.source_outputs.length !== tx.inputs.length) fail('Source outputs do not line up with the inputs')

  const ownScript = hexToBin(intent.lockingBytecode)
  const category = hexToBin(BridgeConfig.pusd.category)

  const sources: SourceOutput[] = build.source_outputs.map(s => ({
    lockingBytecode: hexToBin(s.locking_script_hex),
    valueSatoshis: BigInt(s.value),
    ...(s.token && { token: { category: hexToBin(s.token.category), amount: BigInt(s.token.amount) } })
  }))

  // Inputs: exactly the approved outputs are ours, each once, and they are exactly the ones to sign.
  const ownIndexes: number[] = []
  const usedFunding = new Set<string>()
  tx.inputs.forEach((input, i) => {
    const outpoint = `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`
    const funding = intent.funding.find(f => `${normalizeTxid(f.txid)}:${f.vout}` === outpoint)
    const paysUs = binsAreEqual(sources[i].lockingBytecode, ownScript)
    if (funding) {
      if (usedFunding.has(outpoint)) fail('An approved output is spent twice')
      usedFunding.add(outpoint)
      if (!paysUs || sources[i].valueSatoshis.toString() !== funding.value || sources[i].token) fail('A funding input does not match the verified BCH output')
      if (input.unlockingBytecode.length !== 0) fail('A funding input arrived pre-signed')
      ownIndexes.push(i)
    } else if (paysUs) {
      fail('The transaction spends a wallet output that was not approved for this swap')
    } else if (input.unlockingBytecode.length === 0) {
      fail('A pool input has no unlocking script')
    }
  })
  if (usedFunding.size !== intent.funding.length) fail('Not every verified BCH output is spent')
  const toSign = [...build.inputs_to_sign].sort((a, b) => a - b)
  if (toSign.length !== ownIndexes.length || toSign.some((v, i) => v !== ownIndexes[i])) fail('The inputs to sign are not exactly the approved outputs')

  // Outputs: what comes back to us, and what leaves to anyone who is not a pool.
  const poolScripts = sources.filter((_, i) => !ownIndexes.includes(i)).map(s => s.lockingBytecode)
  let pusdOut = 0n
  let returnedSats = 0n
  for (const output of tx.outputs) {
    if (binsAreEqual(output.lockingBytecode, ownScript)) {
      returnedSats += output.valueSatoshis
      if (!output.token) continue
      if (!binsAreEqual(output.token.category, category)) fail('The transaction pays a different token category to the wallet')
      if (output.token.nft) fail('The transaction pays an NFT to the wallet')
      pusdOut += output.token.amount
    } else if (output.lockingBytecode[0] === 0x6a) {
      if (output.valueSatoshis !== 0n || output.token) fail('A data output carries value')
    } else if (!poolScripts.some(p => binsAreEqual(p, output.lockingBytecode))) {
      fail(output.token ? 'Tokens leave to an address that is neither the wallet nor a pool' : 'BCH leaves to an address that is neither the wallet nor a pool')
    }
  }

  if (!tokensConserved(sources, tx.outputs)) fail('Tokens would be burned or created')

  const totalIn = sources.reduce((sum, s) => sum + s.valueSatoshis, 0n)
  const totalOut = tx.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
  const minerFeeSats = totalIn - totalOut
  const ownIn = ownIndexes.reduce((sum, i) => sum + sources[i].valueSatoshis, 0n)
  const debitSats = ownIn - returnedSats

  const signedSize = BigInt(hexToBin(build.unsigned_tx_hex).length) + P2PKH_UNLOCK_BYTES * BigInt(ownIndexes.length)
  if (minerFeeSats < signedSize * MIN_FEE_RATE) fail('The miner fee is too low to relay')
  if (minerFeeSats > signedSize * MAX_FEE_RATE) fail('The miner fee is excessive')
  if (debitSats > intent.sellSats + minerFeeSats) fail('More BCH leaves the wallet than the sale and its fee')
  if (debitSats <= 0n) fail('The transaction sells no BCH')

  const expectedOutput = BigInt(build.expected_output)
  if (pusdOut < intent.minOutput) fail('The transaction pays less PUSD than the approved minimum')
  if (expectedOutput < intent.minOutput) fail('The trade expects less PUSD than the approved minimum')

  const sourceOutputs = tx.inputs.map((input, i) =>
    sourceOutputToRelay({
      outpointTransactionHash: input.outpointTransactionHash,
      outpointIndex: input.outpointIndex,
      sequenceNumber: input.sequenceNumber,
      unlockingBytecode: input.unlockingBytecode,
      lockingBytecode: sources[i].lockingBytecode,
      valueSatoshis: sources[i].valueSatoshis,
      ...(sources[i].token && { token: sources[i].token })
    })
  )

  return {
    unsignedHex: build.unsigned_tx_hex.toLowerCase(),
    sourceOutputs,
    ownIndexes,
    sellSats: intent.sellSats,
    pusdOut,
    minOutput: intent.minOutput,
    expectedOutput,
    debitSats,
    routerFeeSats: 0n,
    minerFeeSats,
    returnedSats
  }
}

// Every pool input must accept the trade under its own covenant before the user is asked to sign:
// a pool's script reads only the transaction, not our signature, so it can be evaluated unsigned.
export const checkPoolCovenants = (reviewed: Pick<ReviewedSwap, 'unsignedHex' | 'sourceOutputs' | 'ownIndexes'>) => {
  const transaction = decodeTx(reviewed.unsignedHex)
  const sourceOutputs = sourcesOf(reviewed)
  const vm = createVirtualMachineBch2026(true)
  transaction.inputs.forEach((_, inputIndex) => {
    if (reviewed.ownIndexes.includes(inputIndex)) return
    const result = vm.stateSuccess(vm.evaluate({ inputIndex, sourceOutputs, transaction }))
    if (result !== true) throw new CauldronError('rejected_build', `Pool input ${inputIndex} does not accept this trade: ${result}`)
  })
}

// Every pool input must still be unspent on chain, holding what the build claims: a transaction on a
// spent pool is one the network would refuse.
export const checkPoolsLive = async (reviewed: Pick<ReviewedSwap, 'unsignedHex' | 'sourceOutputs' | 'ownIndexes'>) => {
  const transaction = decodeTx(reviewed.unsignedHex)
  const sources = sourcesOf(reviewed)
  const pools = transaction.inputs.flatMap((input, i) =>
    reviewed.ownIndexes.includes(i)
      ? []
      : [
          {
            txid: binToHex(input.outpointTransactionHash),
            vout: input.outpointIndex,
            value: sources[i].valueSatoshis,
            ...(sources[i].token && { token: { category: binToHex(sources[i].token!.category), amount: sources[i].token!.amount } })
          }
        ]
  )
  const stale = (await checkOutpointsLive(pools)).filter(p => !p.live).length
  if (stale > 0) throw new CauldronError('stale_pools', `${stale} of the ${pools.length} pools in this trade are already spent; prepare it again.`)
}

export const sourcesOf = (reviewed: Pick<ReviewedSwap, 'sourceOutputs'>): Output[] =>
  reviewed.sourceOutputs.map(s => ({
    lockingBytecode: hexToBin(s.lockingBytecode),
    valueSatoshis: BigInt(String(s.valueSatoshis).replace(/^<bigint: (\d+)n>$/, '$1')),
    ...(s.token && {
      token: {
        category: hexToBin(s.token.category),
        amount: BigInt(String(s.token.amount).replace(/^<bigint: (\d+)n>$/, '$1')),
        ...(s.token.nft && {
          nft: {
            capability: s.token.nft.capability as 'none' | 'mutable' | 'minting',
            commitment: s.token.nft.commitment ? hexToBin(s.token.nft.commitment) : new Uint8Array()
          }
        })
      }
    })
  }))

// The wallet may only add unlocking scripts to our own inputs: everything else must be the
// approved transaction byte for byte, and the result must pass full script verification.
// SIGHASH_ALL | SIGHASH_FORKID, optionally | SIGHASH_UTXOS: the signature commits to every input and output.
const ALLOWED_SIGHASH = [0x41, 0x61]

// A P2PKH unlocking script: <signature> <public key>, both direct pushes.
const parseP2pkhUnlock = (bytecode: Uint8Array) => {
  const sigLength = bytecode[0]
  if (!sigLength || sigLength > 0x4b) return undefined
  const signature = bytecode.slice(1, 1 + sigLength)
  const keyLength = bytecode[1 + sigLength]
  const pubkey = bytecode.slice(2 + sigLength, 2 + sigLength + keyLength)
  if (signature.length !== sigLength || keyLength !== 33 || pubkey.length !== 33 || bytecode.length !== 2 + sigLength + keyLength) return undefined
  return { hashType: signature[signature.length - 1], pubkey }
}

export const checkSigned = (unsignedHex: string, signedHex: string, ownIndexes: number[], sources: Output[], ownPubkey: string) => {
  const fail = (reason: string): never => {
    throw new CauldronError('rejected_signature', reason)
  }
  const unsigned = decodeTx(unsignedHex)
  let signed: Transaction
  try {
    signed = decodeTx(signedHex)
  } catch {
    return fail('The wallet returned an invalid transaction')
  }
  if (signed.version !== unsigned.version || signed.locktime !== unsigned.locktime) fail('The wallet changed the transaction header')
  if (signed.inputs.length !== unsigned.inputs.length) fail('The wallet changed the inputs')
  signed.inputs.forEach((input, i) => {
    const original = unsigned.inputs[i]
    if (
      !binsAreEqual(input.outpointTransactionHash, original.outpointTransactionHash) ||
      input.outpointIndex !== original.outpointIndex ||
      input.sequenceNumber !== original.sequenceNumber
    ) {
      fail('The wallet changed the inputs')
    }
    if (ownIndexes.includes(i)) {
      const unlock = parseP2pkhUnlock(input.unlockingBytecode)
      if (!unlock) fail('The wallet left an input unsigned or signed it unexpectedly')
      if (binToHex(unlock!.pubkey) !== ownPubkey.toLowerCase()) fail('An input was signed by a different key than the bound address')
      if (!ALLOWED_SIGHASH.includes(unlock!.hashType)) fail('An input was signed without committing to the whole transaction')
    } else if (!binsAreEqual(input.unlockingBytecode, original.unlockingBytecode)) {
      fail('The wallet changed a pool input')
    }
  })
  if (!binsAreEqual(encodeTransactionOutputs(signed.outputs), encodeTransactionOutputs(unsigned.outputs))) fail('The wallet changed the outputs')

  const verified = createVirtualMachineBch2026(true).verify({ sourceOutputs: sources, transaction: signed })
  if (verified !== true) fail(`The signed transaction does not verify: ${verified}`)

  return txidOf(signedHex)
}

// --- Broadcast ---------------------------------------------------------------------------------

export class BroadcastRejected extends Error {}
// The broadcast may or may not have reached the network; reconcile by txid before anything else.
export class BroadcastUnknown extends Error {}

// Cauldron's broadcast service: the second route, used only when Fulcrum cannot be reached.
const broadcastViaCauldron = async (signedHex: string, txid: string) => {
  let response: Response
  try {
    response = await fetch(BridgeConfig.cauldronBroadcastUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx: signedHex }),
      signal: AbortSignal.timeout(30_000)
    })
  } catch (error) {
    throw new BroadcastUnknown(error instanceof Error ? error.message : 'Broadcast did not complete')
  }
  const body = (await response.json().catch(() => undefined)) as { txid?: string; error?: { code?: string; message?: string } } | undefined
  if (body?.txid) {
    if (normalizeTxid(body.txid) !== txid) throw new BroadcastUnknown('The broadcast service reported a different transaction id')
    return txid
  }
  if (body?.error?.code === 'REJECTED') throw new BroadcastRejected(body.error.message || 'Rejected by the network')
  throw new BroadcastUnknown(body?.error?.message || `Broadcast service answered ${response.status}`)
}

// A node that already holds the transaction answers with one of these: the broadcast succeeded.
const ALREADY_KNOWN = /already (in|known)|txn-already|already have transaction|transaction already in block chain/i

// Broadcasts the signed second leg. Fulcrum first (the server the app already checks the chain
// with); Cauldron's service only if Fulcrum cannot be reached. Re-sending the same bytes is safe:
// it is one transaction, so it cannot pay twice.
export const broadcastPusdSwap = async (
  signedHex: string,
  txid: string,
  routes: { fulcrum: (hex: string) => Promise<string>; cauldron: (hex: string, txid: string) => Promise<string> } = {
    fulcrum: broadcastTransaction,
    cauldron: broadcastViaCauldron
  }
) => {
  let answer: string | undefined
  try {
    answer = await routes.fulcrum(signedHex)
  } catch (error) {
    if (error instanceof RpcError) {
      if (ALREADY_KNOWN.test(error.message)) return txid
      throw new BroadcastRejected(error.message || 'Rejected by the network')
    }
    // Not delivered (no connection, timeout): try the second route with the same bytes.
    return routes.cauldron(signedHex, txid)
  }
  if (normalizeTxid(String(answer)) !== txid) throw new BroadcastUnknown('The BCH server reported a different transaction id')
  return txid
}

export { RpcTimeoutError }
