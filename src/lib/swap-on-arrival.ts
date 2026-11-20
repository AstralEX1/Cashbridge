import { bigIntToVmNumber, binToHex, encodeCashAddress, encodeDataPush, hash160, hexToBin } from '@bitauth/libauth'
import { BCH_PREFIX, type BchBinding } from '@/lib/bch'

// Swap-on-arrival (contracts/swap-on-arrival.cash): non-custodial Hashi-style escrow. A bridge pays plain BCH to
// this P2SH20; a one-swap trade key kept in the person's browser can buy the CashToken on Cauldron or release the
// BCH. After refundAfter anyone may reclaim to the owner. Cash Bridge never holds the trade key and never receives
// the BCH into a service wallet — only the contract address does.
//
// Distinct from RouterOrder (router-order.cash): that path uses the Router service key and a fixed minTokens. This
// path uses a browser trade key and a proportional floor (rateNum / rateDen).

// contracts/swap-on-arrival.json `debug.bytecode`, compiled by cashc 0.14.0 (npm run contract:compile).
const CONTRACT_BYTECODE = hexToBin(
  '5679009c63577a537aadc0c6537995547a96537aa3c0cd537a88c0d17b88c0d3a17777675679519c63577a537aadc3519dc4519d00cd7b8800d1008800ccc0c602b80b94a2696d6d755167567a529d557ab175c3519dc4519d00cd7b8800d1008800ccc0c602b80b94a2696d6d516868'
)

// What release and reclaim may leave to the miner; written out in the contract (3,000 sats).
export const ARRIVAL_REFUND_FEE_CAP = 3000n

export interface ArrivalTerms {
  // One-swap public key made in the browser (hex). Never sent to a Cashbridge keeper.
  tradeKey: string
  // Person's locking bytecode: token payout and BCH reclaim both go here.
  ownerScript: string
  // Token category as explorers show it (hex); the redeem script stores VM byte order (reversed).
  category: string
  // Quoted floor in token base units, and the BCH sats that floor assumes (pro rata below that).
  rateNum: string
  rateDen: string
  // Unix time after which anyone may send the BCH to the owner (chain median time).
  refundAfter: number
}

const FUNCTIONS = { swap: 0n, release: 1n, reclaim: 2n } as const
export type ArrivalFunction = keyof typeof FUNCTIONS

const pushInt = (value: bigint) => encodeDataPush(bigIntToVmNumber(value))

// CashScript layout: constructor args last-one-first, then contract code.
export const arrivalRedeemScript = (terms: ArrivalTerms) =>
  Uint8Array.from([
    ...pushInt(BigInt(terms.refundAfter)),
    ...pushInt(BigInt(terms.rateDen)),
    ...pushInt(BigInt(terms.rateNum)),
    ...encodeDataPush(hexToBin(terms.tradeKey)),
    ...encodeDataPush(hexToBin(terms.ownerScript)),
    ...encodeDataPush(hexToBin(terms.category).reverse()),
    ...CONTRACT_BYTECODE
  ])

// P2SH20 so THORChain / NEAR BCH payouts that only accept 20-byte script hashes can land here.
const p2sh20Binding = (redeemScript: Uint8Array, tradeKey: string, addressIndex: number): BchBinding => {
  const payload = hash160(redeemScript)
  return {
    pubkey: tradeKey,
    path: 'receive',
    addressIndex,
    lockingBytecode: binToHex(Uint8Array.from([0xa9, 0x14, ...payload, 0x87])),
    cashAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2sh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2shWithTokens', payload }).address
  }
}

export const arrivalBinding = (terms: ArrivalTerms, addressIndex: number): BchBinding =>
  p2sh20Binding(arrivalRedeemScript(terms), terms.tradeKey, addressIndex)

export const arrivalUnlock = (terms: ArrivalTerms, fn: ArrivalFunction, signature?: Uint8Array) =>
  Uint8Array.from([...(signature ? encodeDataPush(signature) : []), ...pushInt(FUNCTIONS[fn]), ...encodeDataPush(arrivalRedeemScript(terms))])

// Token floor for one coin: min(sats × rateNum / rateDen, rateNum), matching the contract.
export const arrivalMinimum = (terms: ArrivalTerms, sats: bigint) => {
  const num = BigInt(terms.rateNum)
  const den = BigInt(terms.rateDen)
  if (den <= 0n) throw new Error('rateDen must be positive')
  const proRata = (sats * num) / den
  return proRata < num ? proRata : num
}

const parseUnlock = (tradeKey: string, unlock: (fn: 'swap' | 'release', signature: Uint8Array) => Uint8Array) => (bytecode: Uint8Array) => {
  const sigLength = bytecode[0]
  if (!sigLength || sigLength > 0x4b) return undefined
  const signature = bytecode.slice(1, 1 + sigLength)
  const fn = (['swap', 'release'] as const).find(name => binToHex(unlock(name, signature)) === binToHex(bytecode))
  return fn ? { hashType: signature[signature.length - 1], pubkey: hexToBin(tradeKey) } : undefined
}

export const parseArrivalUnlock = (terms: ArrivalTerms) =>
  parseUnlock(terms.tradeKey, (fn, sig) => arrivalUnlock(terms, fn, sig))
