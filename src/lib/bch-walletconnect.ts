import { binToHex, binsAreEqual, decodeCashAddress, hash160, hexToBin, secp256k1, sha256, stringify, utf8ToBin } from '@bitauth/libauth'
import { BCH_PREFIX, type BchBinding, bindingFromPubkey, decodeTx } from '@/lib/bch'
import type { BchSigner, Signable } from '@/lib/bch-signing'
import { sourcesOf } from '@/lib/cauldron'

// BCH over WalletConnect v2, the "wc2-bch-bcr" spec (github.com/mainnet-pat/wc2-bch-bcr) that Paytaca,
// Cashonize and Zapit implement. The wallet shares only addresses, never a public key, while every
// check here is bound to a key (checkSigned compares the signing key with the binding). So the wallet
// signs one message at connect time, the key is recovered from that signature and must hash to the
// shared address; the result is a binding like WizardConnect's. Nothing in this file talks to a relay.

export const WC_BCH_CHAIN = 'bch:bitcoincash'
export const WC_BCH_METHODS = ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage'] as const
export const WC_BCH_EVENTS = ['addressesChanged'] as const

// The first BCH mainnet address a session shares ("bch:bitcoincash:q…" accounts), as a CashAddr.
export const sessionAddress = (accounts: readonly string[] | undefined) => {
  for (const account of accounts ?? []) {
    if (!account.startsWith(`${WC_BCH_CHAIN}:`)) continue
    const address = account.slice('bch:'.length).toLowerCase()
    const decoded = decodeCashAddress(address)
    if (typeof decoded !== 'string' && decoded.prefix === BCH_PREFIX && decoded.type.startsWith('p2pkh')) return address
  }
  return undefined
}

// Wallets answer bch_getAddresses with bare or prefixed CashAddrs; only a P2PKH one can be bound.
export const firstP2pkhAddress = (addresses: unknown) => {
  if (!Array.isArray(addresses)) return undefined
  return sessionAddress(addresses.filter((a): a is string => typeof a === 'string').map(a => `bch:${a.includes(':') ? a : `${BCH_PREFIX}:${a}`}`))
}

// What the wallet is asked to sign at connect time. Shown in the wallet; proves nothing beyond control
// of the key, and the nonce keeps an old signature from being replayed into a new session.
export const keyProofMessage = (appName: string, address: string, nonce: string) =>
  `${appName}: confirm that this wallet controls ${address} so it can receive and sign your bridge transfers.\n\nNonce: ${nonce}`

const varInt = (n: number) => (n < 0xfd ? [n] : n <= 0xffff ? [0xfd, n & 0xff, n >> 8] : [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24])

// Electron Cash / Bitcoin Core message digest: sha256d("\x18Bitcoin Signed Message:\n" ‖ varint ‖ message).
export const signedMessageHash = (message: string) => {
  const body = utf8ToBin(message)
  const magic = utf8ToBin('\x18Bitcoin Signed Message:\n')
  return sha256.hash(sha256.hash(Uint8Array.from([...magic, ...varInt(body.length), ...body])))
}

const fromBase64 = (value: string) => {
  try {
    return Uint8Array.from(atob(value.trim()), c => c.charCodeAt(0))
  } catch {
    return undefined
  }
}

// The compressed key behind a 65-byte recoverable message signature (header 27…34), accepted only if
// it hashes to `address`. The header's recovery id is tried first; some wallets encode it loosely, and
// any id that recovers the address's own key is equally valid proof.
export const recoverMessageKey = (message: string, signatureBase64: string, address: string): Uint8Array => {
  const signature = fromBase64(signatureBase64)
  if (!signature || signature.length !== 65 || signature[0] < 27 || signature[0] > 34) throw new Error('The wallet returned an unreadable message signature')
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string' || !decoded.type.startsWith('p2pkh')) throw new Error('The wallet shared an address that cannot sign')
  const hash = signedMessageHash(message)
  const compact = signature.slice(1)
  const hinted = (signature[0] - 27) & 3
  for (const recoveryId of [hinted, 0, 1, 2, 3] as const) {
    const pubkey = secp256k1.recoverPublicKeyCompressed(compact, recoveryId as 0 | 1 | 2 | 3, hash)
    if (typeof pubkey !== 'string' && binsAreEqual(hash160(pubkey), decoded.payload)) return pubkey
  }
  throw new Error('The message was not signed by the key of the shared address')
}

// The binding for a WalletConnect wallet. Path and index mean nothing to the wallet (it picks its own
// key for the address); 'receive'/0 keeps the binding in the shape every stored record already has.
export const bindingFromWalletConnect = (address: string, pubkey: Uint8Array): BchBinding => {
  const binding = bindingFromPubkey(pubkey, 0, 'receive')
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string' || binToHex(hash160(pubkey)) !== binToHex(decoded.payload)) throw new Error('The key does not belong to the shared address')
  return binding
}

// bch_signTransaction params: the libauth transaction and its source outputs in libauth's extended
// JSON (bytes as "<Uint8Array: 0x…>", amounts as "<bigint: …n>"), as the spec and its wallets parse
// it. Our own inputs carry empty unlocking bytecode, which is how the spec marks the inputs to sign.
// The wallet never broadcasts; the result goes through the same checkSigned as WizardConnect's.
export const walletConnectSignParams = (tx: Signable, userPrompt: string) => {
  const transaction = decodeTx(tx.unsignedHex)
  const sources = sourcesOf(tx)
  const sourceOutputs = transaction.inputs.map((input, i) => ({ ...input, ...sources[i] }))
  return JSON.parse(stringify({ transaction, sourceOutputs, broadcast: false, userPrompt })) as Record<string, unknown>
}

// The signed transaction from a bch_signTransaction answer (hex, or libauth-encoded bytes).
export const signedHexOf = (result: unknown) => {
  const value = (result as { signedTransaction?: unknown } | null)?.signedTransaction
  if (typeof value !== 'string') return undefined
  const hex = value.startsWith('<Uint8Array: 0x') ? value.slice('<Uint8Array: 0x'.length, -1) : value
  return /^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 ? binToHex(hexToBin(hex)) : undefined
}

// The slice of a WalletConnect SignClient this file needs, so it stays free of the client itself.
export interface WalletConnectRequester {
  request<T>(args: { topic: string; chainId: string; request: { method: string; params: unknown } }): Promise<T>
}

// A WalletConnect error is a JSON-RPC error object, not an Error: keep its message for the UI's
// declined / undelivered wording.
export const walletConnectError = (error: unknown) => {
  if (error instanceof Error) return error
  const message = (error as { message?: unknown } | null)?.message
  return new Error(typeof message === 'string' && message ? message : 'The wallet could not sign the transaction')
}

const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(signal.reason)
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

// A BchSigner over a WalletConnect session. WalletConnect has no way to withdraw a request from the
// wallet, so an abort only stops waiting; the wallet's late answer is then ignored, and since it never
// broadcasts, nothing is sent.
export const walletConnectSigner = (client: WalletConnectRequester, topic: string): BchSigner => ({
  async signTransaction(request, options) {
    const params = walletConnectSignParams(
      { unsignedHex: request.transaction.transaction, sourceOutputs: request.transaction.sourceOutputs, ownIndexes: [] },
      request.transaction.userPrompt
    )
    let result: unknown
    try {
      result = await Promise.race([
        client.request<unknown>({ topic, chainId: WC_BCH_CHAIN, request: { method: 'bch_signTransaction', params } }),
        untilAborted(options?.signal)
      ])
    } catch (error) {
      if (options?.signal?.aborted) throw error
      throw walletConnectError(error)
    }
    const signedTransaction = signedHexOf(result)
    return signedTransaction ? { signedTransaction } : { error: 'The wallet did not sign the transaction' }
  }
})

// Asks the wallet to sign keyProofMessage and returns the binding of the key that signed it.
export const proveWalletConnectKey = async (client: WalletConnectRequester, topic: string, address: string, appName: string) => {
  const nonce = binToHex(crypto.getRandomValues(new Uint8Array(8)))
  const message = keyProofMessage(appName, address, nonce)
  let signature: unknown
  try {
    signature = await client.request<unknown>({
      topic,
      chainId: WC_BCH_CHAIN,
      request: { method: 'bch_signMessage', params: { message, userPrompt: `Connect to ${appName}` } }
    })
  } catch (error) {
    const reason = walletConnectError(error)
    throw /reject|declin|denied|cancel/i.test(reason.message) ? new Error('The wallet declined the connection message, so it was not connected.', { cause: error }) : reason
  }
  if (typeof signature !== 'string') throw new Error('The wallet did not sign the connection message')
  return bindingFromWalletConnect(address, recoverMessageKey(message, signature, address))
}
