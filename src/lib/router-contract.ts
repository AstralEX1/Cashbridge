import { bigIntToVmNumber, binToHex, encodeCashAddress, encodeDataPush, hash160, hexToBin, utf8ToBin } from '@bitauth/libauth'
import { BCH_PREFIX, type BchBinding } from '@/lib/bch'
import { minOutputFor } from '@/lib/bridge'

// The per-order contract of the Cashbridge Router (contracts/router-order.cash): THORChain pays the order's BCH to
// it, and the Router can only buy at least the quoted amount of the ordered token for the recipient or send the BCH
// back to the fallback address. Browser-safe, so the page can check a deposit address against the order's public terms.

// contracts/router-order.json `debug.bytecode`, compiled by cashc 0.14.0 (npm run contract:compile).
const CONTRACT_BYTECODE = hexToBin(
  '5679009c63577a7cadc076cd7b8876d1537a88d37ba2777777675679519c63577a7cadc076cd537a8876d1008876cc02d007937cc6a2696d6d755167567a529d557ab175c076cd547a8876d1008876cc02d007937cc6a2696d6d516868'
)

// contracts/router-order-v2.json `debug.bytecode`, compiled by cashc 0.14.0: the page's one-use key may settle the order
// too, and a coin smaller than quoted must buy its share of the minimum.
const CONTRACT_V2_BYTECODE = hexToBin(
  '5879009c635a79875a797b879b69577a587aadc076c6557995567a96765679a0635579776878cd537a8878d1547a887cd3a1696d6d51675879519c635a79875a797b879b69577a587aadc076cd537a8876d1008876cc02d007937cc6a2696d6d6d5167587a529d577ab175c076cd557a8876d1008876cc02d007937cc6a2696d6d6d516868'
)

// What giveBack and expire may leave to the miner per coin; written out in the contract.
export const REFUND_FEE_CAP = 2000n
// How long after the order is created anyone may send its BCH back (the chain's median time runs about an hour behind).
export const REFUND_AFTER_SECONDS = 3 * 60 * 60
// What an exact sale (router-sale-exact.cash) keeps above its deposit: the miner fee cap and a relayable change.
export const SALE_EXACT_RESERVE = REFUND_FEE_CAP + 546n
// How far under the page's own sale quote the Router's floor may sit; routed sales deposit from under it.
export const SALE_FLOOR_TOLERANCE_BPS = 300
// The exact BCH a ShapeShift sale deposits from `bchOut`: under the floor by the change back and the fee cap.
export const shapeShiftSaleSats = (bchOut: bigint) => minOutputFor(bchOut, SALE_FLOOR_TOLERANCE_BPS) - SALE_EXACT_RESERVE

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
  // Version 2 (contracts/router-order-v2.cash) adds the page's key and the BCH the minimum was quoted for.
  version?: 2
  // The page's one-use public key (hex); the Router's key when the order has none.
  pageKey?: string
  quotedSats?: string
}

const FUNCTIONS = { convert: 0n, giveBack: 1n, expire: 2n } as const
export type ContractFunction = keyof typeof FUNCTIONS

const pushInt = (value: bigint) => encodeDataPush(bigIntToVmNumber(value))

// CashScript's layout: the constructor arguments pushed last one first, then the contract's code.
export const orderRedeemScript = (terms: OrderTerms) =>
  Uint8Array.from([
    ...pushInt(BigInt(terms.refundAfter)),
    ...(terms.version === 2 ? pushInt(BigInt(terms.quotedSats ?? '0')) : []),
    ...pushInt(BigInt(terms.minPusd)),
    // The VM reads a token category in transaction byte order, reversed from how explorers show it.
    ...encodeDataPush(hexToBin(terms.category).reverse()),
    ...encodeDataPush(hexToBin(terms.refundScript)),
    ...encodeDataPush(hexToBin(terms.recipientScript)),
    ...(terms.version === 2 ? encodeDataPush(hexToBin(terms.pageKey ?? terms.routerKey)) : []),
    ...encodeDataPush(hexToBin(terms.routerKey)),
    ...(terms.version === 2 ? CONTRACT_V2_BYTECODE : CONTRACT_BYTECODE)
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

// <signature> <function> <redeem script>; version 2 pushes the signing key first (CashScript pushes arguments last one
// first), the Router's unless `key` names the page's.
export const orderUnlock = (terms: OrderTerms, fn: ContractFunction, signature?: Uint8Array, key = terms.routerKey) =>
  Uint8Array.from([
    ...(signature && terms.version === 2 ? encodeDataPush(hexToBin(key)) : []),
    ...(signature ? encodeDataPush(signature) : []),
    ...pushInt(FUNCTIONS[fn]),
    ...encodeDataPush(orderRedeemScript(terms))
  ])

// A coin under this at an order's contract is dust; it is never settled or sent back.
export const MIN_ORDER_COIN_SATS = 1000n
// The coin a contract order settles: its largest coin of at least half the quoted BCH (the page and the Router pick the
// same one). A bridge pays within its slippage, so a smaller coin is someone else's: it can neither settle the order nor
// send it back, and goes back to the customer as BCH once the order is done.
export const settlingCoin = <T extends { txid: string; vout: number; value: bigint | string }>(coins: T[], quotedSats: bigint | string) =>
  coins
    .filter(coin => BigInt(coin.value) >= MIN_ORDER_COIN_SATS && 2n * BigInt(coin.value) >= BigInt(quotedSats))
    .sort((a, b) => (BigInt(a.value) === BigInt(b.value) ? `${a.txid}:${a.vout}`.localeCompare(`${b.txid}:${b.vout}`) : BigInt(a.value) > BigInt(b.value) ? -1 : 1))[0]

// The least of the token a coin of `value` sats must buy: version 2 takes the coin's share of the minimum, capped at it.
export const coinFloor = (terms: Pick<OrderTerms, 'version' | 'minPusd' | 'quotedSats'>, value: bigint) => {
  const min = BigInt(terms.minPusd)
  if (terms.version !== 2) return min
  const share = (value * min) / BigInt(terms.quotedSats ?? '1')
  return share < min ? share : min
}

// A Router-signed unlock: <signature> <function> <redeem script>, exactly as `unlock` writes it for one of `names`.
const parseUnlock = <F extends string>(routerKey: string, names: readonly F[], unlock: (fn: F, signature: Uint8Array) => Uint8Array) => (bytecode: Uint8Array) => {
  const sigLength = bytecode[0]
  if (!sigLength || sigLength > 0x4b) return undefined
  const signature = bytecode.slice(1, 1 + sigLength)
  const fn = names.find(name => binToHex(unlock(name, signature)) === binToHex(bytecode))
  return fn ? { hashType: signature[signature.length - 1], pubkey: hexToBin(routerKey) } : undefined
}

export const parseOrderUnlock = (terms: OrderTerms) => {
  if (terms.version !== 2) return parseUnlock(terms.routerKey, ['convert', 'giveBack'] as const, (fn, sig) => orderUnlock(terms, fn, sig))
  // Version 2: <key> <signature> <function> <redeem script>, the key being the Router's or the page's.
  return (bytecode: Uint8Array) => {
    if (bytecode[0] !== 33) return undefined
    const key = binToHex(bytecode.slice(1, 34))
    if (key !== terms.routerKey && key !== (terms.pageKey ?? terms.routerKey)) return undefined
    const sigLength = bytecode[34]
    if (!sigLength || sigLength > 0x4b) return undefined
    const signature = bytecode.slice(35, 35 + sigLength)
    const fn = (['convert', 'giveBack'] as const).find(name => binToHex(orderUnlock(terms, name, signature, key)) === binToHex(bytecode))
    return fn ? { hashType: signature[signature.length - 1], pubkey: hexToBin(key) } : undefined
  }
}

// --- Sales (contracts/router-sale.cash) ---------------------------------------------------------------
// The reverse direction: the customer sends CashTokens to the sale contract, and the Router can only sell them on
// Cauldron and pay the BCH to THORChain's vault with the order's memo, or send them back.

// contracts/router-sale.json `debug.bytecode`, compiled by cashc 0.14.0 (npm run contract:compile).
const SALE_BYTECODE = hexToBin(
  '5679009c63577a7cadc076cd78c78876d10088cc547aa2696d6d7551675679519c63577a7cadc0009dc3519dc4529d00ce008800c6547aa26900cd8800d1008800cc02d0079300c6a26951cd87777777675679529c63577a7cadc076cd547a8876d178ce8876d378d09d76d278cf8876cc02d007937cc6a2696d6d755167567a539d557ab175c076cd557a8876d178ce8876d378d09d76d278cf8876cc02d007937cc6a2696d6d51686868'
)

// contracts/router-sale-exact.json `debug.bytecode`, compiled by cashc 0.14.0 (npm run contract:compile): a sale whose
// bridge was quoted for an exact BCH amount (ShapeShift), so the deposit pays exactly that and the rest goes back.
const SALE_EXACT_BYTECODE = hexToBin(
  '5779009c63587a7cadc076cd78c78876d10088cc557aa2696d6d6d51675779519c63587a7cadc0009dc3519dc4539d00ce008800c6557aa26900cd8800d1008800cc537a9d51cd8852cd8852d1008800cc52cc9302d0079300c6a27777675779529c63587a7cadc076cd547a8876d178ce8876d378d09d76d278cf8876cc02d007937cc6a2696d6d6d5167577a539d567ab175c076cd557a8876d178ce8876d378d09d76d278cf8876cc02d007937cc6a2696d6d7551686868'
)

export interface SaleTerms {
  routerKey: string
  // The bridge's BCH deposit address (THORChain's vault, or a one-use NEAR Intents address) and the memo, both fixed
  // when the order is made.
  vaultScript: string
  memo: string
  refundScript: string
  // The least BCH the sale must bring (sats).
  minSats: string
  refundAfter: number
  // Set when the bridge takes exactly this many sats (router-sale-exact.cash); the rest of the sale goes back.
  depositSats?: string
}

const SALE_FUNCTIONS = { sell: 0n, deposit: 1n, giveBack: 2n, expire: 3n } as const
export type SaleFunction = keyof typeof SALE_FUNCTIONS

// THORChain's memo as an OP_RETURN with a single push, the form THORChain reads.
export const memoScript = (memo: string) => Uint8Array.from([0x6a, ...encodeDataPush(utf8ToBin(memo))])

export const saleRedeemScript = (terms: SaleTerms) =>
  Uint8Array.from([
    ...pushInt(BigInt(terms.refundAfter)),
    ...pushInt(BigInt(terms.minSats)),
    ...(terms.depositSats === undefined ? [] : pushInt(BigInt(terms.depositSats))),
    ...encodeDataPush(hexToBin(terms.refundScript)),
    ...encodeDataPush(memoScript(terms.memo)),
    ...encodeDataPush(hexToBin(terms.vaultScript)),
    ...encodeDataPush(hexToBin(terms.routerKey)),
    ...(terms.depositSats === undefined ? SALE_BYTECODE : SALE_EXACT_BYTECODE)
  ])

export const saleBinding = (terms: SaleTerms, addressIndex: number): BchBinding => p2sh20Binding(saleRedeemScript(terms), terms.routerKey, addressIndex)

export const saleUnlock = (terms: SaleTerms, fn: SaleFunction, signature?: Uint8Array) =>
  Uint8Array.from([...(signature ? encodeDataPush(signature) : []), ...pushInt(SALE_FUNCTIONS[fn]), ...encodeDataPush(saleRedeemScript(terms))])

export const parseSaleUnlock = (terms: SaleTerms) => parseUnlock(terms.routerKey, ['sell', 'deposit', 'giveBack'] as const, (fn, sig) => saleUnlock(terms, fn, sig))
