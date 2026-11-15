import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)

test('legacy Near codecs preserve base58 bytes and reject Unicode lookalikes', () => {
  const browser = createRequire(require.resolve('@near-js/keystores-browser/package.json'))
  const crypto = createRequire(browser.resolve('@near-js/crypto/package.json'))
  const base58 = crypto('bs58')
  assert.equal(base58.encode(Buffer.from([0, 0, 1])), '112')
  assert.deepEqual([...base58.decode('112')], [0, 0, 1])
  assert.throws(() => base58.decode('2\u0430'), /Non-base58/)
})

test('the Connect Headers fallback leaves native Node Headers intact', async () => {
  const native = globalThis.Headers
  await import('@connectrpc/connect-node')
  assert.equal(globalThis.Headers, native)
  assert.equal(new Headers({ 'X-Test': 'value' }).get('x-test'), 'value')
})

test('legacy UUID callers retain CommonJS exports and reject undersized output buffers', () => {
  const jayson = createRequire(require.resolve('jayson/package.json'))
  const uuid = jayson('uuid')
  const id = uuid.v4()
  assert.equal(uuid.validate(id), true)
  assert.equal(uuid.version(id), 4)
  assert.throws(() => uuid.v5('cashbridge.example', uuid.v5.DNS, new Uint8Array(1)), RangeError)
})

test('Cardano relay IP serialization preserves IPv4 and IPv6 bytes', () => {
  const core = createRequire(require.resolve('@cardano-sdk/core'))
  const codec = core('./Serialization/Certificates/PoolParams/Relay/ipUtils.js')
  assert.deepEqual([...codec.ipV4StringToByteArray('192.0.2.1')], [192, 0, 2, 1])
  const bytes = codec.ipV6StringToByteArray('2001:db8::1')
  assert.equal(Buffer.from(bytes).toString('hex'), '20010db8000000000000000000000001')
  assert.equal(codec.byteArrayToIPv6String(bytes), '2001:0db8:0000:0000:0000:0000:0000:0001')
})
