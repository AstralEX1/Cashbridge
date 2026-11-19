import { binToHex } from '@bitauth/libauth'
import { decodeTx, findWalletTransaction, listWalletCoins } from '@/lib/bch'
import { checkSigned, sourcesOf } from '@/lib/cauldron'
import { SignCancelled, SignDeclined, SignSessionLost, SignTimedOut, SignUndelivered, type Signable } from '@/lib/bch-signing'
import { SIGN_REQUEST_EXPIRY_S } from '@/lib/bch-walletconnect'
import type { BridgeOperation, BridgeSigningRequest, ReverseDeposit, SecondLeg } from '@/store/transaction-store'

const REQUEST_WAIT_MS = SIGN_REQUEST_EXPIRY_S * 1000 + 60_000
export const OPEN_SECOND_REQUEST_NOTE = 'Your wallet may still sign and send the original request. Reject it in the wallet. This transfer is checking the saved authorization; do not send another transaction.'

export const signingRequest = (tx: Signable, now = Date.now()): BridgeSigningRequest => {
  const decoded = decodeTx(tx.unsignedHex)
  const sources = sourcesOf(tx)
  if (!tx.ownIndexes.length || new Set(tx.ownIndexes).size !== tx.ownIndexes.length || sources.length !== decoded.inputs.length ||
    tx.ownIndexes.some(i => !Number.isInteger(i) || i < 0 || i >= decoded.inputs.length)) throw new Error('Invalid saved signing authorization')
  return { unsignedHex: tx.unsignedHex, ownIndexes: [...tx.ownIndexes], sourceOutputs: tx.sourceOutputs, sentAt: now }
}

export const signingDefinitelyStopped = (error: unknown) =>
  ((error instanceof SignCancelled || error instanceof SignTimedOut) && !error.stillOpen) || error instanceof SignDeclined ||
  error instanceof SignSessionLost || error instanceof SignUndelivered

type Attempt = SecondLeg | ReverseDeposit
export const rememberAttempt = <T extends Attempt>(prior: T[] | undefined, attempt: T | undefined): T[] =>
  attempt ? [...(prior ?? []).filter(item => item.attempt !== attempt.attempt), attempt] : prior ?? []

export const hasSecondAuthorization = (op: BridgeOperation) => !!(
  op.secondLeg || op.priorSecondLegs?.length || op.reverse?.deposit || op.reverse?.priorDeposits?.length
)

// A stale poll or wallet answer must not overwrite a later authorization or a completed transfer.
export const sameSecondAttempt = (current: BridgeOperation, snapshot: BridgeOperation) =>
  current.stage === snapshot.stage && current.secondLeg?.attempt === snapshot.secondLeg?.attempt &&
  current.reverse?.deposit?.attempt === snapshot.reverse?.deposit?.attempt &&
  current.priorSecondLegs?.length === snapshot.priorSecondLegs?.length && current.reverse?.priorDeposits?.length === snapshot.reverse?.priorDeposits?.length

export const matchesSigningRequest = (request: BridgeSigningRequest, signedHex: string, pubkey: string) => {
  try {
    checkSigned(request.unsignedHex, signedHex, request.ownIndexes, sourcesOf(request), pubkey)
    return true
  } catch {
    return false
  }
}

export const recoverSecondSigning = async (op: BridgeOperation, now = Date.now()): Promise<Partial<BridgeOperation> | undefined> => {
  const reverse = op.direction === 'reverse'
  const active = reverse ? op.reverse?.deposit : op.secondLeg
  const prior: Attempt[] = reverse ? op.reverse?.priorDeposits ?? [] : op.priorSecondLegs ?? []
  const attempts = [...prior.filter(a => a.attempt !== active?.attempt), ...(active ? [active] : [])]
  if (!attempts.length) return
  const pending = attempts.filter((a): a is Attempt & { signing: BridgeSigningRequest } => !!a.signing)
  const uncertain = (detail: string): Partial<BridgeOperation> => ({ stage: 'second_leg_unknown', error: detail })
  if (!active?.txid && active && !active.signing) return uncertain('The original wallet authorization was not saved. Check the wallet history; this transfer cannot safely request another signature.')
  if (!pending.length) return
  try {
    if (pending.length > 16) throw new Error('Too many saved authorizations to check safely')
    const inputs = pending.flatMap(({ signing }) => {
      signingRequest(signing, signing.sentAt)
      if (!Number.isFinite(signing.sentAt) || signing.sentAt <= 0) throw new Error('Invalid authorization time')
      const decoded = decodeTx(signing.unsignedHex)
      const sources = sourcesOf(signing)
      return signing.ownIndexes.map(i => {
        if (sources[i].token || binToHex(sources[i].lockingBytecode) !== op.binding.lockingBytecode) throw new Error('Invalid authorization funding')
        return { txid: binToHex(decoded.inputs[i].outpointTransactionHash), vout: decoded.inputs[i].outpointIndex, value: sources[i].valueSatoshis }
      })
    })
    let matched: typeof pending[number] | undefined
    const found = await findWalletTransaction(op.binding.lockingBytecode, raw => {
      matched = pending.find(a => matchesSigningRequest(a.signing, raw.hex, op.binding.pubkey))
      return !!matched
    })
    if (found && matched) {
      if (reverse) {
        const deposit = matched as ReverseDeposit
        return { stage: 'second_leg_pending', error: undefined, ...(deposit.near ? { near: deposit.near } : {}), reverse: {
          ...op.reverse!, deposit: { ...deposit, txid: found.txid, signedHex: found.hex, signedAt: deposit.signedAt ?? deposit.signing!.sentAt, error: undefined }
        } }
      }
      return { stage: 'completed', error: undefined, secondLeg: { ...matched as SecondLeg, txid: found.txid, signedHex: found.hex, confirmations: 0, error: undefined } }
    }
    const { utxos } = await listWalletCoins(op.binding.lockingBytecode)
    if (!inputs.every(p => utxos.some(u => u.txid === p.txid && u.vout === p.vout && u.value === p.value && !u.hasToken)))
      return uncertain('Some authorized inputs are spent, but the saved transaction has not been found. The wallet may have sent it; checking continues.')
    if (pending.some(a => !a.txid && now - a.signing.sentAt <= REQUEST_WAIT_MS)) return uncertain(OPEN_SECOND_REQUEST_NOTE)
    // Expiry permits another quote only with intact inputs; every old authorization remains saved and watched.
    if (!active?.txid) return { stage: 'bch_ready', error: 'The earlier wallet request expired and its inputs are still available. Its authorization remains saved; review your wallet before signing again.' }
  } catch {
    return uncertain('The saved wallet request could not be reconciled. Checking continues; another signature is blocked until reliable BCH data is available.')
  }
}
