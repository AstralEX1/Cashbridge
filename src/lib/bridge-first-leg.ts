import { isUserRejection } from '@/lib/errors'
import { generateId } from '@/lib/utils'
import { type BridgeOperation, getActiveBridge, type SwapTransaction, transactionStore } from '@/store/transaction-store'

// The first leg of a bridge: the operation is recorded before the source wallet opens, then the
// swap is handed to the wallet. Kept free of UI imports so it can be tested on its own.

// Serialises authorizations across tabs: the Web Locks API is shared by every tab of the origin.
export const withLock = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn()
  return navigator.locks.request(name, { ifAvailable: true }, async (lock: Lock | null) => (lock ? fn() : undefined))
}

export class BridgeBlocked extends Error {}
// The source wallet declined to sign: no transaction exists, so the operation's record is dropped.
export class FirstLegRejected extends Error {}

// Records the operation before the source wallet opens, then hands the swap to the SDK. A wallet
// error or a closed page leaves it 'first_leg_unknown': it is never re-sent on its own.
export const startBridgeFirstLeg = async ({
  base,
  binding,
  walletName,
  quotedBchSats,
  destinationAsset = 'PUSD',
  execute
}: {
  base: Omit<SwapTransaction, 'uid' | 'status' | 'bridge' | 'hash'>
  binding: BridgeOperation['binding']
  walletName?: string
  quotedBchSats?: string
  destinationAsset?: BridgeOperation['destinationAsset']
  execute: () => Promise<string>
}) => {
  const result = await withLock('bch-bridge-first-leg', async () => {
    await transactionStore.persist.rehydrate()
    if (getActiveBridge()) throw new BridgeBlocked('Finish or close the current bridge operation first')

    const uid = generateId()
    const { setTransaction, updateBridge, removeTransaction } = transactionStore.getState()
    setTransaction({
      ...base,
      uid,
      status: 'not_started',
      bridge: {
        id: uid,
        stage: 'first_leg_signing',
        destinationAsset,
        binding,
        walletName,
        quotedBchSats,
        firstLeg: { result: 'pending' },
        updatedAt: Date.now()
      }
    })

    try {
      const hash = await execute()
      updateBridge(uid, () => ({ stage: 'first_leg_pending', hash }))
      return hash
    } catch (error) {
      // A declined signature cannot have sent anything. Any other wallet error might have (a lost
      // answer after broadcasting), so that operation stays as 'unknown' for the user to resolve.
      if (isUserRejection(error)) {
        removeTransaction(uid)
        throw new FirstLegRejected('Transaction cancelled in wallet', { cause: error })
      }
      updateBridge(uid, () => ({ stage: 'first_leg_unknown', error: error instanceof Error ? error.message : 'Wallet error' }))
      throw error
    }
  })
  if (result === undefined) throw new BridgeBlocked('Another tab is starting a bridge operation')
  return result
}

