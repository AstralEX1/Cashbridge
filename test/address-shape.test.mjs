// Payout address forms per chain: each chain takes its own addresses and refuses every other chain's.
// Run: npm run test:bridge
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binToBase58, binToHex, encodeBase58AddressFormat, hash160, hexToBin, secp256k1 } from '@bitauth/libauth'
import { bech32, bech32m } from '@scure/base'
import { Chain } from '@tcswap/core'
import { computeAddress } from 'ethers'
import { encodeAccountID } from 'ripple-address-codec'
import { classicAddressToXAddress } from 'xrpl'
import { hasAddressShape } from '../src/lib/address-shape.ts'

const key = hexToBin('11'.repeat(32))
const hash = hash160(secp256k1.derivePublicKeyCompressed(key))
const b58 = (version, payload = hash) => encodeBase58AddressFormat(version, payload)
const segwit = (hrp, version, program) => (version === 0 ? bech32 : bech32m).encode(hrp, [version, ...bech32.toWords(program)])
const cosmos = hrp => bech32.encode(hrp, bech32.toWords(hash))
const evm = computeAddress(`0x${binToHex(key)}`)
const solana = binToBase58(new Uint8Array(32).fill(9))
const xrp = encodeAccountID(hash)

// Valid payout addresses of each chain.
const valid = {
  [Chain.Ethereum]: [evm, evm.toLowerCase()],
  [Chain.Base]: [evm],
  [Chain.Bitcoin]: [b58(0x00), b58(0x05), segwit('bc', 0, hash), segwit('bc', 0, new Uint8Array(32).fill(2)), segwit('bc', 1, new Uint8Array(32).fill(3)), segwit('bc', 0, hash).toUpperCase()],
  [Chain.Litecoin]: [b58(0x30), b58(0x32), segwit('ltc', 0, hash)],
  [Chain.Dogecoin]: [b58(0x1e), b58(0x16)],
  [Chain.Zcash]: [b58(0x1c, Uint8Array.of(0xb8, ...hash)), b58(0x1c, Uint8Array.of(0xbd, ...hash))],
  [Chain.Tron]: [b58(0x41)],
  [Chain.Ripple]: [xrp],
  [Chain.Solana]: [solana, '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'],
  [Chain.Cosmos]: [cosmos('cosmos')],
  [Chain.THORChain]: [cosmos('thor')]
}

const sameFamily = (a, b) => a === b || ([Chain.Ethereum, Chain.Base].includes(a) && [Chain.Ethereum, Chain.Base].includes(b))

test('each payout chain accepts its own address forms', () => {
  for (const [chain, addresses] of Object.entries(valid)) for (const address of addresses) assert.ok(hasAddressShape(chain, address), `${chain}: ${address}`)
})

test('no payout chain accepts another chain’s address', () => {
  for (const chain of Object.keys(valid))
    for (const [other, addresses] of Object.entries(valid))
      if (!sameFamily(chain, other)) for (const address of addresses) assert.ok(!hasAddressShape(chain, address), `${chain} took ${other}: ${address}`)
  for (const chain of Object.keys(valid)) {
    assert.ok(!hasAddressShape(chain, 'bitcoincash:qqrswpc8qurswpc8qurswpc8qurswpc8qutdt3aw7w'), `${chain} took a BCH address`)
    assert.ok(!hasAddressShape(chain, ''), `${chain} took nothing`)
  }
})

test('forms the SDK would let through are refused', () => {
  assert.ok(!hasAddressShape(Chain.Ethereum, evm.slice(2)), 'EVM without 0x')
  assert.ok(!hasAddressShape(Chain.Ethereum, `0x${'0'.repeat(40)}`), 'EVM zero address')
  assert.ok(!hasAddressShape(Chain.Ethereum, 'XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS'), 'ICAP')
  assert.ok(!hasAddressShape(Chain.Ethereum, `${evm} `), 'trailing text')
  assert.ok(!hasAddressShape(Chain.Tron, `41${binToHex(hash)}`), 'Tron hex form')
  assert.ok(!hasAddressShape(Chain.Ripple, classicAddressToXAddress(xrp, 1, false)), 'XRP X-address')
  assert.ok(!hasAddressShape(Chain.Zcash, bech32m.encode('tex', bech32m.toWords(hash))), 'Zcash TEX')
  assert.ok(!hasAddressShape(Chain.Zcash, b58(0x1c, Uint8Array.of(0xb9, ...hash))), 'Zcash unknown version')
  assert.ok(!hasAddressShape(Chain.Cosmos, cosmos('cosmosvaloper')), 'Cosmos validator address')
  assert.ok(!hasAddressShape(Chain.THORChain, cosmos('sthor')), 'THORChain stagenet')
  assert.ok(!hasAddressShape(Chain.THORChain, cosmos('thorx')), 'prefix that only starts like thor')
  assert.ok(!hasAddressShape(Chain.Litecoin, segwit('ltc', 1, new Uint8Array(32).fill(3))), 'Litecoin Taproot')
  assert.ok(!hasAddressShape(Chain.Bitcoin, segwit('tb', 0, hash)), 'Bitcoin testnet')
  assert.ok(!hasAddressShape(Chain.Bitcoin, b58(0x6f)), 'Bitcoin testnet legacy')
  const typo = b58(0x00).slice(0, -1) + (b58(0x00).endsWith('a') ? 'b' : 'a')
  assert.ok(!hasAddressShape(Chain.Bitcoin, typo), 'Base58Check checksum')
})
