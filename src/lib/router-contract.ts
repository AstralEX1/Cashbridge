import { bigIntToVmNumber, binToHex, encodeCashAddress, encodeDataPush, hash160, hexToBin, utf8ToBin } from '@bitauth/libauth'
import { BCH_PREFIX, type BchBinding } from '@/lib/bch'

// The per-order contract of the Cashbridge Router (contracts/router-order.cash): THORChain pays the order's BCH to
// it, and the Router can only buy at least the quoted amount of the ordered token for the recipient or send the BCH
// back to the fallback address. Browser-safe, so the page can check a deposit address against the order's public terms.

// contracts/router-order.json `debug.bytecode`, compiled by cashc 0.14.0 (npm run contract:compile).
const CONTRACT_BYTECODE = hexToBin(
  '5679009c63577a7cadc076cd7b8876d1537a88d37ba2777777675679519c63577a7cadc076cd537a8876d1008876cc02d007937cc6a2696d6d755167567a529d557ab175c076cd547a8876d1008876cc02d007937cc6a2696d6d516868'
)

// What giveBack and expire may leave to the miner per coin; written out in the contract.
export const REFUND_FEE_CAP = 2000n
// How long after the order is created anyone may send its BCH back (the chain's median time runs about an hour behind).
export const REFUND_AFTER_SECONDS = 3 * 60 * 60

export interface OrderTerms {
  // The Router's public key for this order (hex): the only key that can convert or give back early.
  routerKey: string
  recipientScript: string
  refundScript: string
  // The ordered token's category (hex, as explorers show it) and the quote's minimum of it in base units.
  category: string
  minPusd: string
  // Unix time after which anyone may send the BCH to the fallback.
  refundAfter: number
}

const FUNCTIONS = { convert: 0n, giveBack: 1n, expire: 2n } as const
export type ContractFunction = keyof typeof FUNCTIONS

const pushInt = (value: bigint) => encodeDataPush(bigIntToVmNumber(value))

// CashScript's layout: the constructor arguments pushed last one first, then the contract's code.
export const orderRedeemScript = (terms: OrderTerms) =>
  Uint8Array.from([
    ...pushInt(BigInt(terms.refundAfter)),
    ...pushInt(BigInt(terms.minPusd)),
    // The VM reads a token category in transaction byte order, reversed from how explorers show it.
    ...encodeDataPush(hexToBin(terms.category).reverse()),
    ...encodeDataPush(hexToBin(terms.refundScript)),
    ...encodeDataPush(hexToBin(terms.recipientScript)),
    ...encodeDataPush(hexToBin(terms.routerKey)),
    ...CONTRACT_BYTECODE
  ])

// P2SH20, because THORChain pays out only to 20-byte script hashes (a P2SH32 destination fails its address check).
const p2sh20Binding = (redeemScript: Uint8Array, routerKey: string, addressIndex: number): BchBinding => {
  const payload = hash160(redeemScript)
  return {
    pubkey: routerKey,
    path: 'receive',
    addressIndex,
    lockingBytecode: binToHex(Uint8Array.from([0xa9, 0x14, ...payload, 0x87])),
    cashAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2sh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2shWithTokens', payload }).address
  }
}

export const orderBinding = (terms: OrderTerms, addressIndex: number): BchBinding => p2sh20Binding(orderRedeemScript(terms), terms.routerKey, addressIndex)

export const orderUnlock = (terms: OrderTerms, fn: ContractFunction, signature?: Uint8Array) =>
  Uint8Array.from([...(signature ? encodeDataPush(signature) : []), ...pushInt(FUNCTIONS[fn]), ...encodeDataPush(orderRedeemScript(terms))])

// A Router-signed unlock: <signature> <function> <redeem script>, exactly as `unlock` writes it for one of `names`.
const parseUnlock = <F extends string>(routerKey: string, names: readonly F[], unlock: (fn: F, signature: Uint8Array) => Uint8Array) => (bytecode: Uint8Array) => {
  const sigLength = bytecode[0]
  if (!sigLength || sigLength > 0x4b) return undefined
  const signature = bytecode.slice(1, 1 + sigLength)
  const fn = names.find(name => binToHex(unlock(name, signature)) === binToHex(bytecode))
  return fn ? { hashType: signature[signature.length - 1], pubkey: hexToBin(routerKey) } : undefined
}

export const parseOrderUnlock = (terms: OrderTerms) => parseUnlock(terms.routerKey, ['convert', 'giveBack'] as const, (fn, sig) => orderUnlock(terms, fn, sig))

// --- Sales (contracts/router-sale.cash) ---------------------------------------------------------------
// The reverse direction: the customer sends CashTokens to the sale contract, and the Router can only sell them on
// Cauldron and pay the BCH to THORChain's vault with the order's memo, or send them back.

// contracts/router-sale.json `debug.bytecode`, compiled by cashc 0.14.0 (npm run contract:compile).
const SALE_BYTECODE = hexToBin(
  '5679009c63577a7cadc076cd78c78876d10088cc547aa2696d6d7551675679519c63577a7cadc0009dc3519dc4529d00ce008800c6547aa26900cd8800d1008800cc02d0079300c6a26951cd87777777675679529c63577a7cadc076cd547a8876d178ce8876d378d09d76d278cf8876cc02d007937cc6a2696d6d755167567a539d557ab175c076cd557a8876d178ce8876d378d09d76d278cf8876cc02d007937cc6a2696d6d51686868'
)

export interface SaleTerms {
  routerKey: string
  // THORChain's BCH vault and the swap memo, both fixed when the order is made.
  vaultScript: string
  memo: string
  refundScript: string
  // The least BCH the sale must bring (sats).
  minSats: string
  refundAfter: number
}

const SALE_FUNCTIONS = { sell: 0n, deposit: 1n, giveBack: 2n, expire: 3n } as const
export type SaleFunction = keyof typeof SALE_FUNCTIONS

// THORChain's memo as an OP_RETURN with a single push, the form THORChain reads.
export const memoScript = (memo: string) => Uint8Array.from([0x6a, ...encodeDataPush(utf8ToBin(memo))])

export const saleRedeemScript = (terms: SaleTerms) =>
  Uint8Array.from([
    ...pushInt(BigInt(terms.refundAfter)),
    ...pushInt(BigInt(terms.minSats)),
    ...encodeDataPush(hexToBin(terms.refundScript)),
    ...encodeDataPush(memoScript(terms.memo)),
    ...encodeDataPush(hexToBin(terms.vaultScript)),
    ...encodeDataPush(hexToBin(terms.routerKey)),
    ...SALE_BYTECODE
  ])

export const saleBinding = (terms: SaleTerms, addressIndex: number): BchBinding => p2sh20Binding(saleRedeemScript(terms), terms.routerKey, addressIndex)

export const saleUnlock = (terms: SaleTerms, fn: SaleFunction, signature?: Uint8Array) =>
  Uint8Array.from([...(signature ? encodeDataPush(signature) : []), ...pushInt(SALE_FUNCTIONS[fn]), ...encodeDataPush(saleRedeemScript(terms))])

export const parseSaleUnlock = (terms: SaleTerms) => parseUnlock(terms.routerKey, ['sell', 'deposit', 'giveBack'] as const, (fn, sig) => saleUnlock(terms, fn, sig))
