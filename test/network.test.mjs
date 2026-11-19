import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postJson } from '../src/lib/transfer-status.ts'

test('a stalled chain RPC is aborted so the next payout poll can run', async t => {
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', delay => {
    assert.equal(delay, 15000)
    return timeout(5)
  })
  let signal
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const keepAlive = setTimeout(() => {}, 1000)
  try {
    await assert.rejects(postJson('https://rpc.example.invalid/', { method: 'fixture' }), { name: 'TimeoutError' })
    assert.equal(signal.aborted, true)
  } finally { clearTimeout(keepAlive) }
})

test('THORNode and Midgard tracking requests carry a finite timeout', async () => {
  const { default: axios } = await import('axios')
  const original = axios.defaults.adapter,
    timeouts = []
  axios.defaults.adapter = async config => {
    timeouts.push(config.timeout)
    return { status: 200, statusText: 'OK', headers: {}, config, data: {} }
  }
  try {
    const api = await import('../src/lib/api.ts')
    await api.getTxStatus('ab'.repeat(32))
    await api.getMidgardActions('ab'.repeat(32))
    assert.deepEqual(timeouts, [15000, 15000])
  } finally {
    axios.defaults.adapter = original
  }
})
