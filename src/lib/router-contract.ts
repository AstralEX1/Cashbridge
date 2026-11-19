import { bigIntToVmNumber, binToHex, encodeCashAddress, encodeDataPush, hash160, hexToBin } from '@bitauth/libauth'
import { BridgeConfig } from '@/config'
import { BCH_PREFIX, type BchBinding } from '@/lib/bch'

// The per-order contract of the Cashbridge Router (contracts/router-order.cash): THORChain pays the order's BCH to
// it, and the Router can only buy at least the quoted PUSD for the recipient or send the BCH back to the fallback
// address. Browser-safe, so the page can check a deposit address against the order's public terms.

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
  // The quote's minimum PUSD (base units).
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
    ...encodeDataPush(hexToBin(BridgeConfig.pusd.category).reverse()),
    ...encodeDataPush(hexToBin(terms.refundScript)),
    ...encodeDataPush(hexToBin(terms.recipientScript)),
    ...encodeDataPush(hexToBin(terms.routerKey)),
    ...CONTRACT_BYTECODE
  ])

// P2SH20, because THORChain pays out only to 20-byte script hashes (a P2SH32 destination fails its address check).
export const orderBinding = (terms: OrderTerms, addressIndex: number): BchBinding => {
  const payload = hash160(orderRedeemScript(terms))
  return {
    pubkey: terms.routerKey,
    path: 'receive',
    addressIndex,
    lockingBytecode: binToHex(Uint8Array.from([0xa9, 0x14, ...payload, 0x87])),
    cashAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2sh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix: BCH_PREFIX, type: 'p2shWithTokens', payload }).address
  }
}

export const orderUnlock = (terms: OrderTerms, fn: ContractFunction, signature?: Uint8Array) =>
  Uint8Array.from([...(signature ? encodeDataPush(signature) : []), ...pushInt(FUNCTIONS[fn]), ...encodeDataPush(orderRedeemScript(terms))])

// A Router-signed convert or giveBack: <signature> <function> <redeem script>, exactly as orderUnlock writes it.
export const parseOrderUnlock = (terms: OrderTerms) => (bytecode: Uint8Array) => {
  const sigLength = bytecode[0]
  if (!sigLength || sigLength > 0x4b) return undefined
  const signature = bytecode.slice(1, 1 + sigLength)
  const fn = (['convert', 'giveBack'] as const).find(name => binToHex(orderUnlock(terms, name, signature)) === binToHex(bytecode))
  return fn ? { hashType: signature[signature.length - 1], pubkey: hexToBin(terms.routerKey) } : undefined
}
