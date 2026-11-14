import { useSyncExternalStore } from 'react'
import { ProviderName } from '@tcswap/helpers'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { Asset } from '@/components/swap/asset'
import { type BchBinding, isValidBinding, type VerifiedOutput } from '@/lib/bch'

// 'broadcast': a send history cannot confirm on its chain - known to be submitted, nothing more.
export type TxStatus = 'not_started' | 'pending' | 'swapping' | 'completed' | 'failed' | 'expired' | 'refunded' | 'unknown' | 'broadcast'

interface BaseTransaction {
  uid: string
  chainId: string
  hash?: string
  timestamp: Date
  estimatedTime?: number
  assetFrom: Asset
  assetTo: Asset
  amountFrom: string
  amountTo: string
  addressFrom?: string
  addressTo: string
  addressDeposit?: string
  status: TxStatus
  details?: any
  qrCodeData?: string
  // A memo/tag the deposit must carry (a provider's deposit tag), shown with the QR code.
  depositMemo?: string
  expiration?: number
  limitSwapMemo?: string
  limitPrice?: string
  // The provider's own id for the swap, when it tracks by one instead of by hash (Houdini order id).
  providerSwapId?: string
}

export interface SwapTransaction extends BaseTransaction {
  kind?: undefined
  provider: ProviderName
  // Set on a THORChain -> BCH -> PUSD bridge operation; the record's `status` is then the
  // operation's overall status (bridgeTxStatus), never the first leg's alone.
  bridge?: BridgeOperation
}

// --- Bridge operation (two legs) -----------------------------------------------------------------

// Where an operation is. Only public data is kept: addresses, amounts, hashes, outpoints.
export type BridgeStage =
  // Intent saved and the source wallet opened; no transaction hash yet.
  | 'first_leg_signing'
  // The page closed or the wallet errored before a hash came back: the source swap may or may
  // not have been sent. Never resubmitted automatically.
  | 'first_leg_unknown'
  // Source transaction sent; THORChain swapping / scheduling the BCH outbound.
  | 'first_leg_pending'
  // BCH outbound seen paying the bound address, waiting for confirmations.
  | 'bch_unconfirmed'
  // Verified, confirmed, unspent BCH outputs: the second leg may be quoted and authorized.
  | 'bch_ready'
  // A second-leg transaction was signed (its txid is saved before broadcast).
  | 'second_leg_signed'
  // Broadcast outcome unknown; reconciled by txid before anything else happens.
  | 'second_leg_unknown'
  | 'second_leg_pending'
  // Terminal states.
  | 'completed'
  | 'kept_bch'
  | 'refunded'
  | 'failed'

export type FirstLegResult = 'pending' | 'swapped' | 'partial' | 'refund_pending' | 'refunded'

export interface BridgeRefund {
  asset: string
  amount: string
  txid?: string
  pending: boolean
}

export interface SecondLeg {
  // Fresh id per authorization, so a stale tab cannot act on a newer attempt.
  attempt: string
  category: string
  sellSats: string
  minOutput: string
  pusdOut: string
  routerFeeSats: string
  minerFeeSats: string
  txid?: string
  // The signed transaction is public once broadcast, and re-sending the same bytes is the only
  // safe retry: it cannot spend the outputs twice.
  signedHex?: string
  confirmations?: number
  error?: string
}

export interface BridgeOperation {
  id: string
  stage: BridgeStage
  binding: BchBinding
  walletName?: string
  // Indicative BCH (sats) from the first-leg quote; never used as receipt evidence.
  quotedBchSats?: string
  firstLeg: { result: FirstLegResult; trackerStatus?: string }
  outbound?: { txid: string; amountSats: string }[]
  refunds?: BridgeRefund[]
  received?: VerifiedOutput[]
  secondLeg?: SecondLeg
  error?: string
  updatedAt: number
}

const TERMINAL_STAGES: BridgeStage[] = ['completed', 'kept_bch', 'refunded', 'failed']
export const isBridgeTerminal = (op: BridgeOperation) => TERMINAL_STAGES.includes(op.stage)

export const bridgeTxStatus = (op: BridgeOperation): TxStatus => {
  switch (op.stage) {
    case 'completed':
    case 'kept_bch':
      return 'completed'
    case 'refunded':
      return 'refunded'
    case 'failed':
      return 'failed'
    case 'first_leg_unknown':
    case 'second_leg_unknown':
      return 'unknown'
    case 'first_leg_signing':
      return 'not_started'
    case 'first_leg_pending':
      return 'swapping'
    default:
      return 'pending'
  }
}

// A plain transfer from the Send dialog, confirmed against its own chain (src/lib/transfer-status.ts).
export interface SendTransaction extends BaseTransaction {
  kind: 'send'
  provider?: undefined
}

export type Transaction = SwapTransaction | SendTransaction

interface TransactionStore {
  transactions: Transaction[]
  setTransaction: (tx: Transaction) => void
  setTransactionDetails: (uid: string, data: any) => void
  setTransactionStatus: (uid: string, status: TxStatus) => void
  updateBridge: (uid: string, update: (op: BridgeOperation, tx: SwapTransaction) => Partial<BridgeOperation> & Partial<Pick<SwapTransaction, 'hash' | 'addressFrom'>>) => void
}

const sanitizeBridge = (op: BridgeOperation): BridgeOperation => {
  if (!op || typeof op !== 'object') return { stage: 'failed', error: 'Unreadable saved operation' } as BridgeOperation
  if (!isValidBinding(op.binding)) return { ...op, stage: isBridgeTerminal(op) ? op.stage : 'failed', error: 'Saved BCH address failed validation' }
  // Mid-signing when the page went away: the source wallet may have sent it.
  if (op.stage === 'first_leg_signing') return { ...op, stage: 'first_leg_unknown' }
  return op
}

export const transactionStore = create<TransactionStore>()(
  persist(
    set => ({
      transactions: [],

      setTransaction: transaction => {
        set(state => {
          const exists = state.transactions.find(d => d.uid === transaction.uid)
          if (exists) return state

          return {
            transactions: [...state.transactions, transaction],
            showPendingAlert: true
          }
        })
      },

      setTransactionDetails: (uid, data: any) => {
        set(state => {
          return {
            transactions: state.transactions.map(item => {
              if (item.uid !== uid) {
                return item
              }

              // A bridge operation keeps the tracker's answer as first-leg detail only: the
              // tracker's `completed` and planned amounts say nothing about the BCH actually received.
              if (item.kind !== 'send' && item.bridge) {
                return { ...item, details: data, bridge: { ...item.bridge, firstLeg: { ...item.bridge.firstLeg, trackerStatus: data.status } } }
              }

              const tx = {
                ...item,
                status: data.status,
                hash: data.hash,
                addressFrom: data.fromAddress,
                details: data
              }

              if (data.status === 'completed') {
                tx.amountFrom = data.fromAmount
                tx.amountTo = data.toAmount
              }

              return tx
            })
          }
        })
      },

      updateBridge: (uid, update) => {
        set(state => ({
          transactions: state.transactions.map(item => {
            if (item.uid !== uid || item.kind === 'send' || !item.bridge) return item
            const { hash, addressFrom, ...patch } = update(item.bridge, item)
            const bridge = { ...item.bridge, ...patch, updatedAt: Date.now() }
            return { ...item, ...(hash && { hash }), ...(addressFrom && { addressFrom }), bridge, status: bridgeTxStatus(bridge) }
          })
        }))
      },

      setTransactionStatus: (uid, status) => {
        set(state => {
          return {
            transactions: state.transactions.map(item => {
              if (item.uid !== uid) {
                return item
              }
              // A bridge operation's status follows its stage (updateBridge).
              if (item.kind !== 'send' && item.bridge) return item

              return {
                ...item,
                status: status
              }
            })
          }
        })
      }
    }),
    {
      name: 'tc-transactions',
      version: 1,
      // Restored bridge operations are rechecked before use: a corrupted or edited record cannot
      // name another address, and a page closed mid-signing is never treated as "not sent".
      merge: (persisted, current) => {
        const transactions = ((persisted as Partial<TransactionStore>)?.transactions ?? []).map(tx => {
          if (tx.kind === 'send' || !tx.bridge) return tx
          const bridge = sanitizeBridge(tx.bridge)
          return { ...tx, bridge, status: bridgeTxStatus(bridge) }
        })
        return { ...current, transactions }
      }
    }
  )
)

const sortedTransactions = (state: TransactionStore) =>
  state.transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

export const useSetTransaction = () => transactionStore(state => state.setTransaction)
export const useSetTransactionDetails = () => transactionStore(state => state.setTransactionDetails)
export const useSetTransactionStatus = () => transactionStore(state => state.setTransactionStatus)
export const useUpdateBridge = () => transactionStore(state => state.updateBridge)

// One operation at a time per browser: the newest bridge operation that has not finished.
const activeBridge = (state: TransactionStore) =>
  state.transactions.find((tx): tx is SwapTransaction & { bridge: BridgeOperation } => tx.kind !== 'send' && !!tx.bridge && !isBridgeTerminal(tx.bridge))
// The store rehydrates from localStorage synchronously on the client, so the server and the first
// client render would disagree about a saved operation. It is read only once hydration is over.
const noSubscribe = () => () => {}
export const useActiveBridge = () => {
  const active = transactionStore(activeBridge)
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)
  return hydrated ? active : undefined
}
export const getActiveBridge = () => activeBridge(transactionStore.getState())
export const useTransactions = () => transactionStore(sortedTransactions)
export const useHasTransactions = () => transactionStore(state => state.transactions.length > 0)
export const useTransaction = (uid?: string) => transactionStore(state => (uid ? state.transactions.find(tx => tx.uid === uid) : undefined))

export const isTxPending = (status: string) => status === 'not_started' || status === 'swapping' || status === 'pending'
export const isTxTerminal = (status: string) => status === 'completed' || status === 'failed' || status === 'expired' || status === 'refunded'
// The tracker has seen the deposit into a channel: it has a hash, or the swap moved past waiting.
const DEPOSIT_SEEN_STATUSES: TxStatus[] = ['pending', 'swapping', 'completed', 'failed', 'refunded']
export const hasDepositArrived = (tx: Transaction) => !!tx.hash || DEPOSIT_SEEN_STATUSES.includes(tx.status)

// Sends never get tracker details, so they are only polled while pending.
const isTxSyncable = (tx: Transaction) => isTxPending(tx.status) || (tx.kind !== 'send' && !tx.details && !isTxTerminal(tx.status))
const isBridgeTx = (tx: Transaction) => tx.kind !== 'send' && !!tx.bridge

export const usePendingTransactions = () => transactionStore(useShallow(state => state.transactions.filter(isTxSyncable)))
// Bridge operations are tracked by useBridgeTracker, not the generic tracker poll.
export const useSyncablePlainTransactions = () => transactionStore(useShallow(state => state.transactions.filter(tx => isTxSyncable(tx) && !isBridgeTx(tx))))
