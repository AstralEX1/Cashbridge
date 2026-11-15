import type { BchBinding } from '@/lib/bch'
import { checkSigned, type ReviewedSwap, sourcesOf } from '@/lib/cauldron'

// Signing in the bound BCH wallet, over WizardConnect or WalletConnect (see bch-walletconnect.ts). The
// wallet is asked only to sign, never to broadcast (Paytaca broadcasts anyway; sending the same bytes
// again is harmless). The result is checked to carry signatures by the bound key on our own inputs
// alone, and to verify.
// Every way a request can end without a signature has its own error, so the UI can say what
// happened and offer the next step; none of them leaves anything sent.

// The wallet app is given this long; then the request is withdrawn from it (sign_cancel).
export const SIGN_TIMEOUT_MS = 3 * 60_000

// The user withdrew the request here (Cancel, closing the dialog).
export class SignCancelled extends Error {}
// The wallet answered with a refusal (the user declined it there).
export class SignDeclined extends Error {}
// No answer in time; the request was withdrawn from the wallet.
export class SignTimedOut extends Error {}
// The request never reached the wallet (no relay took it, even on a second try).
export class SignUndelivered extends Error {}

const DECLINED = /reject|declin|denied|cancel|refus/i
// WizardConnect's own wording when no relay took the request.
const UNDELIVERED = /failed to publish|not connected|closed/i
const NOT_SENT = /not connected|SendingOnClosedConnection/i
const RELAY_RETRY_MS = 2_500

export interface Signable {
  unsignedHex: string
  sourceOutputs: ReviewedSwap['sourceOutputs']
  ownIndexes: number[]
}

const anySignal = (signals: AbortSignal[]) => {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

// What either connection offers for signing: WizardConnect's DappConnectionManager as is, or the
// WalletConnect adapter. `inputPaths` tells a WizardConnect wallet which key signs each input; a
// WalletConnect wallet finds its own inputs by their empty unlocking bytecode.
export interface BchSigner {
  signTransaction(
    request: {
      transaction: { transaction: string; sourceOutputs: Signable['sourceOutputs']; broadcast: boolean; userPrompt: string }
      inputPaths: [number, string, number][]
    },
    options?: { signal?: AbortSignal }
  ): Promise<{ signedTransaction?: string; error?: string }>
}

export const signInWallet = async (
  signer: BchSigner,
  binding: BchBinding,
  tx: Signable,
  prompt: string,
  { signal, timeoutMs = SIGN_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {}
) => {
  if (signal?.aborted) throw new SignCancelled('Cancelled')
  const timeout = AbortSignal.timeout(timeoutMs)
  const inputPaths = tx.ownIndexes.map(i => [i, binding.path, binding.addressIndex] as [number, string, number])
  const request = { transaction: { transaction: tx.unsignedHex, sourceOutputs: tx.sourceOutputs, broadcast: false, userPrompt: prompt }, inputPaths }
  const options = { signal: signal ? anySignal([signal, timeout]) : timeout }
  let response: Awaited<ReturnType<BchSigner['signTransaction']>>
  try {
    try {
      response = await signer.signTransaction(request, options)
    } catch (error) {
      // Sent again only when it certainly never left: no relay connection at all. A failed publish
      // may still have reached the wallet (its answer then finds no pending request), and sending
      // it again would show the user a second prompt.
      if (options.signal.aborted || !NOT_SENT.test(error instanceof Error ? error.message : '')) throw error
      await new Promise(resolve => setTimeout(resolve, RELAY_RETRY_MS))
      response = await signer.signTransaction(request, options)
    }
  } catch (error) {
    if (signal?.aborted) throw new SignCancelled('Cancelled')
    if (timeout.aborted) throw new SignTimedOut('The wallet did not answer in time')
    const message = error instanceof Error ? error.message : String(error)
    if (DECLINED.test(message)) throw new SignDeclined(message, { cause: error })
    if (UNDELIVERED.test(message)) throw new SignUndelivered(message, { cause: error })
    // The relay could not deliver the request, or the wallet failed: nothing was signed.
    throw new Error(message || 'The wallet could not sign the transaction', { cause: error })
  }
  if (response.error || !response.signedTransaction) {
    const message = response.error || 'The wallet did not sign the transaction'
    throw DECLINED.test(message) ? new SignDeclined(message) : new Error(message)
  }
  const txid = checkSigned(tx.unsignedHex, response.signedTransaction, tx.ownIndexes, sourcesOf(tx), binding.pubkey)
  return { txid, signedHex: response.signedTransaction.toLowerCase() }
}
