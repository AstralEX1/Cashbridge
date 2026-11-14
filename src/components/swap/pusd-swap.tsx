'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Chain, getChainConfig, getExplorerTxUrl } from '@tcswap/core'
import { ArrowRight, CheckCircle2, Clock, Copy, ExternalLink, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip } from '@/components/tooltip'
import { shortBridgeAddress } from '@/components/swap/bridge-wallet-badge'
import { useBchWallet } from '@/components/bch-wallet'
import { GenericButton } from '@/components/generic-button'
import { SwapError } from '@/components/swap/swap-error'
import { BridgeConfig } from '@/config'
import { useQuote } from '@/hooks/use-quote'
import { useSwapRates } from '@/hooks/use-rates'
import { getMidgardActions, getTrack, getTxStatus } from '@/lib/api'
import { checkUnspent, getTransactionState, isTxid, normalizeTxid, verifyThorchainOutbound } from '@/lib/bch'
import {
  formatBaseUnits,
  inboundMatchesBinding,
  interpretMidgard,
  interpretTxStatus,
  minOutputFor,
  secondLegSellAmount,
  toBaseUnits
} from '@/lib/bridge'
import {
  BroadcastRejected,
  BroadcastUnknown,
  broadcastPusdSwap,
  buildPusdSwap,
  CauldronError,
  checkPoolCovenants,
  checkPoolsLive,
  checkSigned,
  quotePusd,
  type ReviewedSwap,
  reviewBuild,
  sourcesOf
} from '@/lib/cauldron'
import { generateId } from '@/lib/utils'
import { useSwapStore } from '@/store/swap-store'
import {
  type BridgeOperation,
  getActiveBridge,
  type SwapTransaction,
  transactionStore,
  useActiveBridge,
  useSetTransactionDetails,
  useTransaction,
  isBridgeTerminal,
  useUpdateBridge
} from '@/store/transaction-store'

type BridgeTx = SwapTransaction & { bridge: BridgeOperation }

const BCH_DECIMALS = 8
const formatBch = (sats: bigint | string) => formatBaseUnits(sats, BCH_DECIMALS)
const formatPusd = (units: bigint | string) => formatBaseUnits(units, BridgeConfig.pusd.decimals)

// A reviewed second-leg transaction is signed only while this fresh; after that it is rebuilt.
const REVIEW_TTL_MS = 60_000
const SIGN_TIMEOUT_MS = 5 * 60_000
const POLL_MS = 15_000

// Serialises authorizations across tabs: the Web Locks API is shared by every tab of the origin.
const withLock = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn()
  return navigator.locks.request(name, { ifAvailable: true }, async (lock: Lock | null) => (lock ? fn() : undefined))
}

// The persisted operation as every tab sees it right now (another tab may have moved it on).
const freshOperation = async (uid: string) => {
  await transactionStore.persist.rehydrate()
  const tx = transactionStore.getState().transactions.find(t => t.uid === uid)
  return tx && tx.kind !== 'send' && tx.bridge ? (tx as BridgeTx) : undefined
}

// --- Combined estimate -------------------------------------------------------------------------

// The indicative PUSD the first leg's BCH would buy now. Nothing is reserved: the second leg is
// quoted again on the BCH actually received, and the user may keep the BCH instead.
export const usePusdEstimate = () => {
  const { quote } = useQuote()
  const destinationAsset = useSwapStore(state => state.destinationAsset)
  const bchSats = useMemo(() => {
    if (!quote?.expectedBuyAmount) return undefined
    try {
      return toBaseUnits(quote.expectedBuyAmount, BCH_DECIMALS)
    } catch {
      return undefined
    }
  }, [quote?.expectedBuyAmount])
  const sellSats = bchSats === undefined ? undefined : secondLegSellAmount(bchSats)

  const query = useQuery({
    queryKey: ['pusd-estimate', sellSats?.toString()],
    queryFn: () => quotePusd(sellSats!),
    enabled: destinationAsset === 'PUSD' && !!sellSats && sellSats > 0n,
    retry: false,
    staleTime: 20_000
  })

  return { bchSats, sellSats, pusd: query.data?.output, isLoading: query.isLoading, error: query.error as Error | null }
}

export const PusdEstimate = () => {
  const t = useTranslations('bridge')
  const { bchSats, sellSats, pusd, isLoading, error } = usePusdEstimate()
  const { rateTo } = useSwapRates()
  if (bchSats === undefined) return null
  // What one PUSD costs in dollars at this rate: the live pools need not price it at $1.
  const bchUsd = rateTo ? Number(rateTo.toSignificant(12)) : NaN
  const pusdUsd = pusd && sellSats && bchUsd > 0 ? ((Number(sellSats) / 1e8) * bchUsd) / (Number(pusd) / 10 ** BridgeConfig.pusd.decimals) : undefined

  return (
    <div className="bg-swap-bloc rounded-15 space-y-2 border p-4 text-sm">
      <div className="flex justify-between">
        <span className="text-txt-label-small">{t('estimate.step1')}</span>
        <span>≈ {formatBch(bchSats)} BCH</span>
      </div>
      <div className="flex justify-between">
        <span className="text-txt-label-small">{t('estimate.step2')}</span>
        <span>
          {isLoading ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : pusd !== undefined ? (
            `≈ ${formatPusd(pusd)} ${BridgeConfig.pusd.ticker}`
          ) : (
            '—'
          )}
        </span>
      </div>
      {pusdUsd !== undefined && Number.isFinite(pusdUsd) && (
        <div className={`text-xs ${Math.abs(pusdUsd - 1) > 0.05 ? 'text-warning' : 'text-txt-label-small'}`}>
          {t(Math.abs(pusdUsd - 1) > 0.05 ? 'estimate.offPeg' : 'estimate.pusdPrice', { price: pusdUsd.toFixed(2) })}
        </div>
      )}
      {sellSats === 0n && <SwapError error={new Error(t('estimate.tooSmall'))} />}
      {error && <SwapError error={new Error(t('estimate.noRoute', { reason: error.message }))} />}
      <div className="text-txt-label-small text-xs">{t('estimate.disclaimer')}</div>
    </div>
  )
}

// --- BCH wallet --------------------------------------------------------------------------------

export const BchWalletStatus = () => {
  const t = useTranslations('bridge')
  const { mismatch, error, reconnectStalled, walletName } = useBchWallet()
  if (!mismatch && !error && !reconnectStalled) return null
  return (
    <div className="bridge-wallet">
      {mismatch && <SwapError error={new Error(t('wallet.mismatch'))} />}
      {error && <SwapError error={new Error(error)} />}
      {reconnectStalled && <p>{t('wallet.reconnectStalled', { name: walletName ?? t('wallet.yourWallet') })}</p>}
    </div>
  )
}

// --- First leg ---------------------------------------------------------------------------------

export class BridgeBlocked extends Error {}

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
    const { setTransaction, updateBridge } = transactionStore.getState()
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
      updateBridge(uid, () => ({ stage: 'first_leg_unknown', error: error instanceof Error ? error.message : 'Wallet error' }))
      throw error
    }
  })
  if (result === undefined) throw new BridgeBlocked('Another tab is starting a bridge operation')
  return result
}

// --- Tracking ----------------------------------------------------------------------------------

const syncFirstLeg = async (tx: BridgeTx, update: ReturnType<typeof useUpdateBridge>, setDetails: ReturnType<typeof useSetTransactionDetails>) => {
  const op = tx.bridge
  if (!tx.hash) return
  let timing: Partial<BridgeOperation['firstLeg']> = {}

  // The aggregator's tracker is the normal progress feed; its answer is shown, never trusted for receipt.
  getTrack({
    provider: tx.provider,
    hash: tx.hash,
    chainId: getChainConfig(tx.assetFrom.chain).chainId,
    fromAsset: tx.assetFrom.identifier,
    fromAddress: tx.addressFrom,
    fromAmount: tx.amountFrom,
    toAsset: tx.assetTo.identifier,
    toAddress: tx.addressTo,
    toAmount: tx.amountTo
  })
    .then(data => setDetails(tx.uid, data))
    .catch(() => null)

  const view = await getTxStatus(tx.hash)
    .then(status => {
      const stages = status.stages
      // Estimate the remaining outbound queue after swapping, without adding a BCH block wait.
      const seconds = stages?.swap_finalised?.completed && !stages.swap_status?.pending ? stages.outbound_delay?.remaining_delay_seconds : undefined
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
        timing = { readyAt: Date.now() + seconds * 1000, timingUpdatedAt: Date.now() }
      }
      return interpretTxStatus(status, op.binding.lockingBytecode)
    })
    .catch(async () => interpretMidgard(await getMidgardActions(tx.hash!).catch(() => [])))
  if (!view) return

  if (view.kind === 'invalid') return update(tx.uid, () => ({ error: view.reason }))
  if (view.kind === 'refunded')
    return update(tx.uid, current => ({ stage: 'refunded', refunds: view.refunds, firstLeg: { ...current.firstLeg, ...timing, result: 'refunded' } }))
  if (view.kind === 'pending')
    return update(tx.uid, current => ({ refunds: view.refunds, firstLeg: { ...current.firstLeg, ...timing, result: view.result }, error: undefined }))

  const received = []
  for (const out of view.outbound) {
    const check = await verifyThorchainOutbound({
      outTxid: out.txid,
      inboundHash: tx.hash,
      lockingBytecode: op.binding.lockingBytecode,
      expectedSats: BigInt(out.amountSats)
    })
    if (check.kind === 'not_found')
      return update(tx.uid, current => ({ outbound: view.outbound, refunds: view.refunds, firstLeg: { ...current.firstLeg, ...timing, result: view.result } }))
    if (check.kind === 'invalid') return update(tx.uid, () => ({ outbound: view.outbound, error: check.reason }))
    received.push(...check.outputs)
  }

  // Deduplicate by outpoint: the same outbound is never counted twice.
  const unique = [...new Map(received.map(o => [`${o.txid}:${o.vout}`, o])).values()]
  const ready = unique.every(o => (op.destinationAsset === 'BCH' || o.unspent) && o.confirmations >= BridgeConfig.minConfirmations)
  const nativeStage = view.result === 'refund_pending' ? 'first_leg_pending' : 'kept_bch'
  update(tx.uid, current => ({
    stage: ready ? (op.destinationAsset === 'BCH' ? nativeStage : 'bch_ready') : 'bch_unconfirmed',
    outbound: view.outbound,
    refunds: view.refunds,
    received: unique,
    firstLeg: { ...current.firstLeg, ...timing, result: view.result },
    error:
      op.destinationAsset !== 'BCH' && unique.some(o => !o.unspent && o.confirmations > 0) ? 'Some received BCH has already been spent' : undefined
  }))
}

const syncReceived = async (tx: BridgeTx, update: ReturnType<typeof useUpdateBridge>) => {
  const op = tx.bridge
  if (!op.received?.length) return
  const checked = await checkUnspent(op.binding.lockingBytecode, op.received)
  if (op.destinationAsset === 'BCH') {
    const ready = checked.every(o => o.confirmations >= BridgeConfig.minConfirmations)
    const nativeStage = op.firstLeg.result === 'refund_pending' ? 'first_leg_pending' : 'kept_bch'
    return update(tx.uid, () => ({ stage: ready ? nativeStage : 'bch_unconfirmed', received: checked }))
  }
  const allUnspent = checked.every(o => o.unspent)
  // Outputs spent by something other than this app's second leg: the user moved their BCH.
  if (!allUnspent && op.stage === 'bch_ready') {
    return update(tx.uid, () => ({ stage: 'kept_bch', received: checked, error: 'The received BCH was spent from your wallet outside this app' }))
  }
  const ready = allUnspent && checked.every(o => o.confirmations >= BridgeConfig.minConfirmations)
  update(tx.uid, () => ({ stage: ready ? 'bch_ready' : 'bch_unconfirmed', received: checked }))
}

const syncSecondLeg = async (tx: BridgeTx, update: ReturnType<typeof useUpdateBridge>) => {
  const op = tx.bridge
  const leg = op.secondLeg
  if (!leg?.txid) return
  const state = await getTransactionState(leg.txid)
  if (state.seen) {
    return update(tx.uid, () => ({
      stage: state.confirmations >= 1 ? 'completed' : 'second_leg_pending',
      secondLeg: { ...leg, confirmations: state.confirmations, error: undefined }
    }))
  }
  // Not seen: if the funding is gone, something else spent it and this transaction can never confirm.
  const checked = await checkUnspent(op.binding.lockingBytecode, op.received ?? [])
  if (checked.some(o => !o.unspent)) {
    update(tx.uid, () => ({ stage: 'failed', error: 'The BCH was spent by a different transaction; the PUSD swap did not happen' }))
  }
}

// Mounted once in the layout: follows the active operation and keeps tabs in step.
export const BridgeTracker = () => {
  const active = useActiveBridge()
  const update = useUpdateBridge()
  const setDetails = useSetTransactionDetails()

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'tc-transactions') transactionStore.persist.rehydrate()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useQuery({
    queryKey: ['bridge-sync', active?.uid, active?.bridge.stage],
    queryFn: async () => {
      if (!active) return null
      switch (active.bridge.stage) {
        case 'first_leg_pending':
          await syncFirstLeg(active, update, setDetails)
          break
        case 'bch_unconfirmed':
        case 'bch_ready':
          await syncReceived(active, update)
          break
        case 'second_leg_signed':
        case 'second_leg_unknown':
        case 'second_leg_pending':
          await syncSecondLeg(active, update)
          break
      }
      return Date.now()
    },
    enabled: !!active,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false
  })

  return null
}

// --- Operation panel ---------------------------------------------------------------------------

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-4">
    <span className="text-txt-label-small">{label}</span>
    <span className="text-right break-all">{value}</span>
  </div>
)

export const BridgeOperationPanel = ({ uid, onClose }: { uid?: string; onClose: () => void }) => {
  const t = useTranslations('bridge')
  const tx = useTransaction(uid)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!uid) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [uid])
  if (!tx || tx.kind === 'send' || !tx.bridge) return null
  const active = tx as BridgeTx
  const op = active.bridge
  const terminal = isBridgeTerminal(op)
  const pusd = op.destinationAsset !== 'BCH'
  const completed = op.stage === 'completed' || (!pusd && op.stage === 'kept_bch' && !!op.received?.length)
  const firstDone =
    ['bch_ready', 'second_leg_signed', 'second_leg_unknown', 'second_leg_pending', 'completed', 'kept_bch'].includes(op.stage) ||
    (terminal && !!op.received?.length)
  const secondStarted = ['second_leg_signed', 'second_leg_unknown', 'second_leg_pending'].includes(op.stage)
  const ready = op.stage === 'bch_ready' && pusd
  const remaining = Number.isFinite(op.firstLeg.readyAt) ? Math.ceil((op.firstLeg.readyAt! - now) / 1000) : undefined
  const freshTiming = Number.isFinite(op.firstLeg.timingUpdatedAt) && now - op.firstLeg.timingUpdatedAt! < POLL_MS * 3
  const time = firstDone
    ? t('progress.ready')
    : freshTiming && remaining !== undefined && remaining > 0
      ? `≈${remaining >= 60 ? `${Math.ceil(remaining / 60)}m` : `${remaining}s`}`
      : t('progress.estimating')
  const states = [
    firstDone ? 'complete' : terminal ? 'waiting' : 'active',
    op.stage === 'completed' ? 'complete' : secondStarted ? 'active' : 'waiting'
  ]
  const elapsed = Math.floor((op.updatedAt - new Date(active.timestamp).getTime()) / 1000)
  const transactions = [
    ...(active.hash ? [{ label: t('progress.sourceTx'), chain: active.assetFrom.chain, hash: active.hash }] : []),
    ...[...new Set((op.received ?? []).map(output => output.txid))].map(hash => ({ label: t('progress.receiveTx'), chain: Chain.BitcoinCash, hash })),
    ...(op.secondLeg?.txid ? [{ label: t('progress.swapTx'), chain: Chain.BitcoinCash, hash: op.secondLeg.txid }] : [])
  ]

  const copyTransaction = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash)
      toast.success(t('progress.copied'))
    } catch {
      toast.error(t('progress.copyFailed'))
    }
  }

  return (
    <Dialog
      open={!!uid}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="bridge-progress">
        <div className="bridge-progress-top">
          <span>
            {t('progress.transfer')} <strong>{shortBridgeAddress(active.hash ?? active.uid)}</strong>
          </span>
          {completed && Number.isFinite(elapsed) && elapsed >= 0 ? (
            <span className="bridge-progress-time" title={t('progress.elapsed')}>
              <Clock size={14} />
              {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
            </span>
          ) : !secondStarted && !terminal ? (
            <span className="bridge-progress-time">
              <Clock size={14} />
              {time}
            </span>
          ) : null}
        </div>
        <div className={`bridge-progress-message${completed ? ' bridge-progress-success' : ''}`}>
          <DialogTitle className="bridge-progress-title">
            {completed
              ? t('progress.completeTitle')
              : terminal || op.stage === 'first_leg_unknown'
                ? t(`stage.${op.stage}`)
                : ready
                  ? t('progress.readyTitle')
                  : secondStarted
                    ? t('progress.swapping')
                    : t('progress.processing')}
          </DialogTitle>
          <DialogDescription className="bridge-progress-description">
            {completed
              ? t('progress.completeDescription')
              : terminal
                ? t('progress.finished')
                : pusd
                  ? t(firstDone ? 'progress.secondDescription' : 'progress.firstDescription')
                  : t('progress.nativeDescription')}
          </DialogDescription>
        </div>
        <div className="bridge-progress-transfer">
          <div>
            <span className="bridge-progress-address">
              <img src={`/networks/${active.assetFrom.chain.toLowerCase()}.svg`} width={18} height={18} alt="" />
              {active.addressFrom ? shortBridgeAddress(active.addressFrom) : active.assetFrom.chain}
            </span>
            <strong>
              {active.amountFrom} <small>{active.assetFrom.ticker}</small>
            </strong>
          </div>
          {completed ? <CheckCircle2 size={30} aria-hidden="true" /> : <ArrowRight size={24} aria-hidden="true" />}
          <div>
            <span className="bridge-progress-address">
              <img src="/networks/bch.svg" width={18} height={18} alt="" />
              {shortBridgeAddress(op.binding.cashAddress)}
            </span>
            <strong>
              {op.secondLeg
                ? `${op.stage === 'completed' ? '' : '≈ '}${formatPusd(op.secondLeg.pusdOut)}`
                : !pusd && op.received?.length
                  ? formatBch(op.received.reduce((sum, o) => sum + BigInt(o.value), 0n))
                  : '—'}{' '}
              <small>{pusd ? 'PUSD' : 'BCH'}</small>
            </strong>
          </div>
        </div>
        {!completed && (
          <div className="bridge-progress-steps" aria-label={t(pusd ? 'progress.threeTransactions' : 'progress.bridgeTransactions')}>
            {states.slice(0, pusd ? 2 : 1).map((state, index) => (
              <div key={index} className="bridge-progress-step" data-state={state}>
                <span>{t(index === 0 ? 'progress.firstStep' : 'progress.secondStep', { step: pusd ? '1/2' : '1/1' })}</span>
                <div className="bridge-progress-bars" aria-hidden="true">
                  {Array.from({ length: 14 }, (_, n) => (
                    <i key={n} style={{ animationDelay: `${n * 80}ms` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {transactions.length > 0 && (
          <div className="bridge-progress-transactions">
            {transactions.map(({ label, chain, hash }) => (
              <div key={`${label}:${hash}`} className="bridge-progress-tx">
                <span>{label}</span>
                <strong title={hash}>{shortBridgeAddress(hash)}</strong>
                <Tooltip content={t('progress.copy')}>
                  <button type="button" aria-label={`${t('progress.copy')}: ${label}`} onClick={() => copyTransaction(hash)}>
                    <Copy size={16} />
                  </button>
                </Tooltip>
                <Tooltip content={t('progress.explorer')}>
                  <a
                    aria-label={`${t('progress.explorer')}: ${label}`}
                    href={getExplorerTxUrl({ chain, txHash: hash })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                  </a>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
        {op.error && op.stage !== 'first_leg_unknown' && <SwapError error={new Error(op.error)} />}
        {op.stage === 'first_leg_unknown' && <UnknownFirstLeg tx={active} />}
        {ready ? (
          <SecondLeg key={active.uid} tx={active} />
        ) : secondStarted ? (
          <SecondLegStatus tx={active} />
        ) : terminal ? (
          <GenericButton className="bridge-progress-primary w-full" onClick={onClose}>
            {t(completed ? 'progress.newTransfer' : 'progress.done')}
          </GenericButton>
        ) : (
          <GenericButton className="bridge-progress-primary w-full" disabled>
            {t(pusd ? 'progress.swapButton' : 'progress.processing')}
          </GenericButton>
        )}
      </DialogContent>
    </Dialog>
  )
}

// The source wallet's answer was lost. The user either supplies the transaction hash (checked
// against THORNode and the bound address) or states nothing was sent; nothing is re-sent.
const UnknownFirstLeg = ({ tx }: { tx: BridgeTx }) => {
  const t = useTranslations('bridge')
  const update = useUpdateBridge()
  const [hash, setHash] = useState('')
  const [error, setError] = useState<string>()
  const [checking, setChecking] = useState(false)

  const resume = async () => {
    setError(undefined)
    const bare = normalizeTxid(hash.trim())
    if (!isTxid(bare)) return setError(t('unknown.badHash'))
    setChecking(true)
    try {
      const status = await getTxStatus(bare)
      if (!inboundMatchesBinding(status, tx.bridge.binding.lockingBytecode)) return setError(t('unknown.notOurs'))
      update(tx.uid, () => ({ stage: 'first_leg_pending', hash: hash.trim(), error: undefined }))
    } catch {
      setError(t('unknown.lookupFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-txt-label-small">{t('unknown.explain')}</div>
      <input
        className="bg-input-modal-bg-active w-full rounded-xl border p-3"
        placeholder={t('unknown.placeholder')}
        value={hash}
        onChange={e => setHash(e.target.value)}
      />
      {error && <SwapError error={new Error(error)} />}
      <div className="flex gap-2">
        <GenericButton size="medium" colorType="3" onClick={resume} disabled={checking || !hash.trim()}>
          {checking ? <LoaderCircle size={16} className="animate-spin" /> : t('unknown.resume')}
        </GenericButton>
        <GenericButton size="medium" onClick={() => update(tx.uid, () => ({ stage: 'failed', error: t('unknown.dismissed') }))}>
          {t('unknown.notSent')}
        </GenericButton>
      </div>
    </div>
  )
}

interface Review {
  reviewed: ReviewedSwap
  at: number
}

const SecondLeg = ({ tx }: { tx: BridgeTx }) => {
  const t = useTranslations('bridge')
  const update = useUpdateBridge()
  const { binding, manager } = useBchWallet()
  const [review, setReview] = useState<Review>()
  const [busy, setBusy] = useState<'quote' | 'sign'>()
  const [error, setError] = useState<string>()
  const [now, setNow] = useState(Date.now())
  const op = tx.bridge
  const total = (op.received ?? []).reduce((sum, o) => sum + BigInt(o.value), 0n)
  const walletMatches = !!binding && binding.pubkey === op.binding.pubkey
  const signing = useRef(false)
  const preparation = useRef(0)
  const fundingKey = (op.received ?? []).map(o => `${o.txid}:${o.vout}:${o.value}`).join('|')

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const expired = !!review && now - review.at > REVIEW_TTL_MS

  // Fresh quote on the BCH actually received, then a build checked against it.
  const prepare = async () => {
    if (signing.current) return
    const request = ++preparation.current
    setBusy('quote')
    setError(undefined)
    setReview(undefined)
    try {
      const funding = (op.received ?? []).map(o => ({ txid: o.txid, vout: o.vout, value: o.value }))
      const checked = await checkUnspent(op.binding.lockingBytecode, funding)
      if (checked.some(o => !o.unspent)) throw new Error(t('second.spent'))

      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        const sellSats = secondLegSellAmount(total, attempt)
        if (sellSats <= 0n) throw new Error(t('second.tooSmall'))
        try {
          const quote = await quotePusd(sellSats)
          const minOutput = minOutputFor(quote.output)
          if (minOutput <= 0n) throw new Error(t('second.tooSmall'))
          const intent = {
            funding,
            lockingBytecode: op.binding.lockingBytecode,
            tokenAddress: op.binding.tokenAddress,
            cashAddress: op.binding.cashAddress,
            // Build exactly what the route priced (it may round the requested amount down).
            sellSats: quote.sellSats,
            minOutput
          }
          const build = await buildPusdSwap(intent)
          const reviewed = reviewBuild(build, intent)
          checkPoolCovenants(reviewed)
          await checkPoolsLive(reviewed)
          if (request === preparation.current) setReview({ reviewed, at: Date.now() })
          return
        } catch (e) {
          lastError = e
          if (!(e instanceof CauldronError && e.code === 'insufficient_funds')) break
        }
      }
      throw lastError
    } catch (e) {
      if (request === preparation.current) setError(e instanceof Error ? e.message : t('second.failed'))
    } finally {
      if (request === preparation.current) setBusy(undefined)
    }
  }

  useEffect(() => {
    void prepare()
    return () => {
      preparation.current++
    }
    // Refresh only when the funding changes, not on each tracking poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundingKey])

  useEffect(() => {
    if (expired && !signing.current) void prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])

  const sign = async () => {
    if (!review || expired || !manager || !walletMatches || signing.current) return
    signing.current = true
    setBusy('sign')
    setError(undefined)
    try {
      const done = await withLock(`bch-bridge-sign-${tx.uid}`, async () => {
        const current = await freshOperation(tx.uid)
        if (current?.bridge.stage !== 'bch_ready') throw new Error(t('second.movedOn'))

        const { reviewed } = review
        const unsigned = reviewed.unsignedHex
        const { ownIndexes } = reviewed
        const inputPaths = ownIndexes.map(i => [i, op.binding.path, op.binding.addressIndex] as [number, string, number])
        const attempt = generateId()

        update(tx.uid, () => ({
          secondLeg: {
            attempt,
            category: BridgeConfig.pusd.category,
            sellSats: reviewed.sellSats.toString(),
            minOutput: reviewed.minOutput.toString(),
            pusdOut: reviewed.pusdOut.toString(),
            routerFeeSats: reviewed.routerFeeSats.toString(),
            minerFeeSats: reviewed.minerFeeSats.toString()
          }
        }))

        const response = await manager.signTransaction(
          {
            transaction: {
              transaction: unsigned,
              sourceOutputs: reviewed.sourceOutputs as never,
              broadcast: false,
              userPrompt: `Swap ${formatBch(reviewed.sellSats)} BCH for at least ${formatPusd(reviewed.minOutput)} PUSD`
            },
            inputPaths
          },
          { signal: AbortSignal.timeout(SIGN_TIMEOUT_MS) }
        )
        if (response.error || !response.signedTransaction) throw new Error(response.error || t('second.rejected'))

        const txid = checkSigned(unsigned, response.signedTransaction, ownIndexes, sourcesOf(reviewed), op.binding.pubkey)

        // Saved before broadcasting, so a lost broadcast answer is reconciled by this id.
        update(tx.uid, op => ({
          stage: 'second_leg_signed',
          secondLeg: { ...op.secondLeg!, txid, signedHex: response.signedTransaction.toLowerCase() }
        }))

        await broadcast(tx.uid, response.signedTransaction, txid, update)
        return true
      })
      if (done === undefined) throw new Error(t('second.otherTab'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('second.failed'))
      setReview(undefined)
    } finally {
      signing.current = false
      setBusy(undefined)
    }
  }

  const r = review?.reviewed
  return (
    <div className="bridge-progress-offer">
      {r && !expired && (
        <div className="bridge-progress-quote">
          <strong>≈ {formatPusd(r.pusdOut)} PUSD</strong>
          <Row label={t('second.minimum')} value={`${formatPusd(r.minOutput)} PUSD`} />
          <Row label={t('second.minerFee')} value={`${formatBch(r.minerFeeSats)} BCH`} />
        </div>
      )}
      {!walletMatches && <p className="bridge-progress-note">{t('progress.reconnectBch')}</p>}
      {error && <SwapError error={new Error(error)} />}
      <GenericButton className="bridge-progress-primary w-full" colorType="3" onClick={sign} disabled={!r || expired || !!busy || !walletMatches}>
        {busy && <LoaderCircle size={16} className="animate-spin" />}
        {t('progress.swapButton')}
      </GenericButton>
      {!r && !busy && error && (
        <button type="button" className="bridge-progress-link" onClick={prepare}>
          {t('progress.retry')}
        </button>
      )}
      <button
        type="button"
        className="bridge-progress-link"
        onClick={() => update(tx.uid, current => (current.stage === 'bch_ready' ? { stage: 'kept_bch' } : {}))}
        disabled={!!busy}
      >
        {t('second.keepBch')}
      </button>
    </div>
  )
}

const rejectedAndFundingIntact = async (uid: string, txid: string) => {
  const tx = await freshOperation(uid)
  const received = tx?.bridge.received
  if (!tx || !received?.length) return false
  if ((await getTransactionState(txid)).seen) return false
  const checked = await checkUnspent(tx.bridge.binding.lockingBytecode, received)
  return checked.every(o => o.unspent)
}

const broadcast = async (uid: string, signedHex: string, txid: string, update: ReturnType<typeof useUpdateBridge>) => {
  try {
    await broadcastPusdSwap(signedHex, txid)
    update(uid, op => ({ stage: 'second_leg_pending', secondLeg: { ...op.secondLeg!, error: undefined } }))
  } catch (error) {
    if (error instanceof BroadcastRejected) {
      // A rejection can also mean "already known" or a conflicting spend, so only go back to a
      // fresh quote once the transaction is absent and every funding output is still unspent.
      const unspent = await rejectedAndFundingIntact(uid, txid).catch(() => false)
      if (unspent) {
        update(uid, op => ({ stage: 'bch_ready', secondLeg: undefined, error: `PUSD swap rejected: ${error.message}. Get a new quote.`, received: op.received }))
        return
      }
    }
    // A timeout is not a failure: the transaction may be in the network. Reconcile by txid.
    update(uid, op => ({ stage: 'second_leg_unknown', secondLeg: { ...op.secondLeg!, error: error instanceof BroadcastUnknown ? error.message : 'Broadcast outcome unknown' } }))
  }
}

const SecondLegStatus = ({ tx }: { tx: BridgeTx }) => {
  const t = useTranslations('bridge')
  const update = useUpdateBridge()
  const [busy, setBusy] = useState(false)
  const leg = tx.bridge.secondLeg
  if (!leg?.txid) return null

  // Re-sending the same signed bytes is safe: it is the same transaction, it cannot pay twice.
  const resend = async () => {
    if (!leg.signedHex || !leg.txid) return
    setBusy(true)
    await withLock(`bch-bridge-sign-${tx.uid}`, () => broadcast(tx.uid, leg.signedHex!, leg.txid!, update))
    setBusy(false)
  }

  return (
    <div className="bridge-progress-offer">
      {leg.error && <SwapError error={new Error(leg.error)} />}
      {tx.bridge.stage !== 'second_leg_pending' && <p className="bridge-progress-note">{t('second.unknownExplain')}</p>}
      <GenericButton className="bridge-progress-primary w-full" onClick={resend} disabled={busy || tx.bridge.stage === 'second_leg_pending'}>
        {busy || tx.bridge.stage === 'second_leg_pending' ? <LoaderCircle size={16} className="animate-spin" /> : null}
        {t(tx.bridge.stage === 'second_leg_pending' ? 'progress.swapping' : 'second.resend')}
      </GenericButton>
    </div>
  )
}
