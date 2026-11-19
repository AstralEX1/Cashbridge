import { useSyncExternalStore } from 'react'
import { ProviderName } from '@tcswap/helpers'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { Asset } from '@/components/swap/asset'
import { type BchBinding, isValidBinding, type VerifiedOutput } from '@/lib/bch'
import { type CauldronToken, isCauldronToken, PUSD_TOKEN } from '@/lib/cauldron-tokens'

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
  // Set on a bridge operation (either direction); the record's `status` is then the
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
  // Token base units: the approved floor and what the signed trade pays.
  minOutput: string
  tokenOut?: string
  // Operations saved before any token could be bought kept the PUSD amount here.
  pusdOut?: string
  routerFeeSats: string
  minerFeeSats: string
  txid?: string
  // The signed transaction is public once broadcast, and re-sending the same bytes is the only
  // safe retry: it cannot spend the outputs twice.
  signedHex?: string
  confirmations?: number
  error?: string
}

// A reverse operation: (token -> BCH on Cauldron, step 1) then a BCH deposit to THORChain paying an
// EVM address (step 2). Its stages reuse the forward names: first_leg_* is the Cauldron sale,
// bch_ready the deposit ready to sign, second_leg_* the deposit, completed the payout seen on the
// EVM chain, refunded THORChain's BCH refund seen at the bound address, kept_bch the user stopping
// after step 1.
export interface ReverseSale {
  attempt: string
  sellTokens: string
  // Satoshis: the approved floor and what the signed trade pays out of the pools.
  minOutput: string
  bchOut: string
  minerFeeSats: string
  txid?: string
  signedHex?: string
  // The sale's token-free outputs to the bound address: the BCH the deposit spends.
  outputs?: { txid: string; vout: number; value: string }[]
}

export interface ReverseDeposit {
  attempt: string
  // Satoshis paid to THORChain's vault, and the deposit's own miner fee.
  amountSats: string
  minerFeeSats: string
  memo: string
  inboundAddress: string
  // The THORChain router on the destination chain, whose TransferOut event is the payout.
  router?: string
  // The destination chain's block height when the deposit was signed: the payout is searched from it.
  startBlock?: number
  // How far the payout search has looked, so a poll resumes there.
  scannedBlock?: number
  signedAt?: number
  // When THORNode's countdown expects the payout (display only).
  readyAt?: number
  expectedOut?: string
  txid?: string
  signedHex?: string
  error?: string
}

export interface ReverseDetails {
  // The THORChain buy asset and the EVM address it pays.
  buyAsset: string
  destination: string
  sale?: ReverseSale
  deposit?: ReverseDeposit
  // The payout transaction on the destination chain, and its amount in the buy asset's base units.
  payout?: { hash: string; amount?: string }
  refund?: { txid: string; amountSats: string }
  // Deposit txids signed earlier for this operation (a rejected broadcast is re-quoted and re-signed).
  priorDepositTxids?: string[]
  // Set when the Cashbridge Router runs the sale and the deposit: its order (id and capability), the signed send of
  // the tokens to the order's contract, and what the payout search needs.
  router?: { id: string; capability: string; depositAddress: string; sendTxid?: string; signedHex?: string; payoutRouter?: string; startBlock?: number }
}

export interface BridgeOperation {
  id: string
  stage: BridgeStage
  // Absent on older (forward) operations.
  direction?: 'forward' | 'reverse'
  // The BCH side: 'BCH' is native BCH; anything else is a Cauldron token (`token`, or PUSD on
  // operations saved before other tokens were possible, which wrote 'PUSD').
  destinationAsset?: 'BCH' | 'PUSD' | 'TOKEN'
  token?: CauldronToken
  reverse?: ReverseDetails
  binding: BchBinding
  walletName?: string
  // Indicative BCH (sats) from the first-leg quote; never used as receipt evidence.
  quotedBchSats?: string
  // sourceConfirmations: the source transaction's depth on its own chain; receivedAt: when the BCH
  // was first seen at the bound address (mempool included).
  firstLeg: {
    result: FirstLegResult
    trackerStatus?: string
    readyAt?: number
    timingUpdatedAt?: number
    sourceConfirmations?: number
    receivedAt?: number
  }
  outbound?: { txid: string; amountSats: string }[]
  refunds?: BridgeRefund[]
  received?: VerifiedOutput[]
  secondLeg?: SecondLeg
  // Txids of earlier second-leg signatures (a rejected broadcast is re-quoted and re-signed): a spend
  // of the received BCH by any of them is still this operation's swap.
  priorSwapTxids?: string[]
  error?: string
  updatedAt: number
}

// The Cauldron token of an operation's BCH side, or undefined for native BCH.
export const operationToken = (op: Pick<BridgeOperation, 'destinationAsset' | 'token'>): CauldronToken | undefined =>
  op.destinationAsset === 'BCH' ? undefined : op.token && isCauldronToken(op.token) ? op.token : PUSD_TOKEN
export const isReverseOperation = (op: Pick<BridgeOperation, 'direction'>) => op.direction === 'reverse'

const TERMINAL_STAGES: BridgeStage[] = ['completed', 'kept_bch', 'refunded', 'failed']
export const isBridgeTerminal = (op: BridgeOperation) => TERMINAL_STAGES.includes(op.stage)
// Only the network is left: the reverse deposit is out, or THORChain is paying plain BCH. Nothing
// more to sign and no wallet needed, so a new operation may start while this one runs on.
export const isBridgeWaiting = (op: BridgeOperation) =>
  isReverseOperation(op)
    ? op.stage === 'second_leg_pending'
    : op.destinationAsset === 'BCH' && (op.stage === 'first_leg_pending' || op.stage === 'bch_unconfirmed')

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
  // Drops a record that never became a transaction (the wallet declined to sign it).
  removeTransaction: (uid: string) => void
  updateBridge: (uid: string, update: (op: BridgeOperation, tx: SwapTransaction) => Partial<BridgeOperation> & Partial<Pick<SwapTransaction, 'hash' | 'addressFrom'>>) => void
}

const sanitizeBridge = (op: BridgeOperation): BridgeOperation => {
  if (!op || typeof op !== 'object') return { stage: 'failed', error: 'Unreadable saved operation' } as BridgeOperation
  if (!isValidBinding(op.binding)) return { ...op, stage: isBridgeTerminal(op) ? op.stage : 'failed', error: 'Saved BCH address failed validation' }
  // Mid-signing when the page went away: the source wallet may have sent it.
  if (op.stage === 'first_leg_signing') return { ...op, stage: 'first_leg_unknown' }
  // A completed operation carries no error (an older version could leave a stale one behind).
  if (op.stage === 'completed' && op.error) return { ...op, error: undefined }
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
                const total = data.transient?.estimatedTimeToComplete
                const observation = data.transient?.estimates?.outboundObservation
                // The second leg can use BCH before its outbound block confirmation. This is
                // display-only timing; receipt and spendability are verified independently.
                const timing =
                  typeof total === 'number' && Number.isFinite(total) &&
                  typeof observation === 'number' && Number.isFinite(observation) &&
                  observation >= 0 && total >= observation
                    ? { readyAt: Date.now() + (total - observation) * 1000, timingUpdatedAt: Date.now() }
                    : {}
                return {
                  ...item,
                  details: data,
                  bridge: { ...item.bridge, firstLeg: { ...item.bridge.firstLeg, ...timing, trackerStatus: data.status } }
                }
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
            // Completion clears any earlier error: it is the final word on the operation.
            if (bridge.stage === 'completed') bridge.error = undefined
            return { ...item, ...(hash && { hash }), ...(addressFrom && { addressFrom }), bridge, status: bridgeTxStatus(bridge) }
          })
        }))
      },

      removeTransaction: uid => {
        set(state => ({ transactions: state.transactions.filter(item => item.uid !== uid) }))
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

type BridgeRecord = SwapTransaction & { bridge: BridgeOperation }
const isUnfinishedBridge = (tx: Transaction): tx is BridgeRecord => tx.kind !== 'send' && !!tx.bridge && !isBridgeTerminal(tx.bridge)
// One operation at a time per browser needs the user: the newest unfinished one that is not just
// waiting on the network. Waiting ones run on in the background (isBridgeWaiting).
const activeBridge = (state: TransactionStore) => state.transactions.find((tx): tx is BridgeRecord => isUnfinishedBridge(tx) && !isBridgeWaiting(tx.bridge))
const unfinishedBridges = (state: TransactionStore) => state.transactions.filter(isUnfinishedBridge)
// The store rehydrates from localStorage synchronously on the client, so the server and the first
// client render would disagree about a saved operation. It is read only once hydration is over.
const noSubscribe = () => () => {}
export const useActiveBridge = () => {
  const active = transactionStore(activeBridge)
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)
  return hydrated ? active : undefined
}
export const getActiveBridge = () => activeBridge(transactionStore.getState())
// Every unfinished operation, the active one and those waiting in the background.
export const useUnfinishedBridges = () => {
  const list = transactionStore(useShallow(unfinishedBridges))
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)
  return hydrated ? list : NO_BRIDGES
}
const NO_BRIDGES: BridgeRecord[] = []
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
