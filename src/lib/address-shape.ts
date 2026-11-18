import { base58ToBin, decodeBase58AddressFormat } from '@bitauth/libauth'
import { Chain, type EVMChain, EVMChains } from '@tcswap/core'
import { isValidClassicAddress } from 'ripple-address-codec'

// The address forms THORChain pays out to, per chain. The SDK's validator runs as well (checksums,
// Solana's curve); this is the stricter half it leaves out: ICAP and unprefixed EVM addresses, the zero
// address, Tron's hex form, XRP X-addresses, Zcash TEX and shielded addresses, a Cosmos prefix that only
// starts like the chain's (cosmosvaloper1…), and Litecoin Taproot, which THORChain is not known to pay.

const BECH32 = '[02-9ac-hj-np-z]'
// P2WPKH or P2WSH (v0), and Taproot (v1) where allowed. Bech32 may be written all upper case.
const segwit = (address: string, hrp: string, taproot: boolean) =>
  new RegExp(`^${hrp}1(q${BECH32}{38}|q${BECH32}{58}${taproot ? `|p${BECH32}{58}` : ''})$`).test(address === address.toUpperCase() ? address.toLowerCase() : address)

// Base58Check with one of the chain's version bytes and a 20-byte hash.
const base58 = (address: string, versions: number[]) => {
  const decoded = decodeBase58AddressFormat(address)
  return typeof decoded !== 'string' && decoded.payload.length === 20 && versions.includes(decoded.version)
}

const SHAPES: Partial<Record<Chain, (address: string) => boolean>> = {
  [Chain.Bitcoin]: a => base58(a, [0x00, 0x05]) || segwit(a, 'bc', true),
  [Chain.Litecoin]: a => base58(a, [0x30, 0x32]) || segwit(a, 'ltc', false),
  [Chain.Dogecoin]: a => base58(a, [0x1e, 0x16]),
  // Transparent t1 / t3 only: a two-byte version, so the first payload byte is the second version byte.
  [Chain.Zcash]: a => {
    const decoded = decodeBase58AddressFormat(a)
    return typeof decoded !== 'string' && decoded.version === 0x1c && decoded.payload.length === 21 && [0xb8, 0xbd].includes(decoded.payload[0])
  },
  [Chain.Tron]: a => base58(a, [0x41]),
  [Chain.Ripple]: a => isValidClassicAddress(a),
  [Chain.Solana]: a => {
    const key = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? base58ToBin(a) : ''
    return typeof key !== 'string' && key.length === 32
  },
  [Chain.Cosmos]: a => new RegExp(`^cosmos1${BECH32}{38}$`).test(a),
  [Chain.THORChain]: a => new RegExp(`^thor1${BECH32}{38}$`).test(a)
}

export const hasAddressShape = (chain: Chain, address: string) =>
  EVMChains.includes(chain as EVMChain) ? /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address) : (SHAPES[chain]?.(address) ?? true)
