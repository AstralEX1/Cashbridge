'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Chain, getChainConfig, USwapNumber } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { ArrowRight, ChevronDown, Clock, Fuel, LoaderCircle, Route, TrendingDown, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { AnimatedButton } from '@/components/animated-button'
import { AssetIcon } from '@/components/asset-icon'
import { useBchWallet } from '@/components/bch-wallet'
import { chainLabel } from '@/components/connect-wallet/config'
import { ConnectWallet } from '@/components/connect-wallet/connect-wallet'
import { GenericButton } from '@/components/generic-button'
import { useDialog } from '@/components/global-dialog'
import { TransactionHistoryDialog } from '@/components/header/transaction-history-dialog'
import type { Asset } from '@/components/swap/asset'
import { BchMark, CauldronMark, HoverCard, ThorchainMark, TokenMark } from '@/components/swap/bridge-marks'
import { shortBridgeAddress } from '@/components/swap/bridge-wallet-badge'
import { BridgeFlow, chainTxUrl, type FlowBar, type FlowStage, type FlowToast, type FlowToken, thorchainTxUrl } from '@/components/swap/pusd-swap'
import { useBchSideBalance } from '@/components/swap/reverse-inputs'
import { SwapError } from '@/components/swap/swap-error'
import { Credenza, CredenzaContent, CredenzaDescription, CredenzaHeader, CredenzaTitle } from '@/components/ui/credenza'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BridgeConfig } from '@/config'
import { useQuote } from '@/hooks/use-quote'
import { useRates } from '@/hooks/use-rates'
import { useAssetFrom } from '@/hooks/use-swap'
import { useTokenSale } from '@/hooks/use-token-sale'
import { useConnectedAccount, useSetExternalWalletMode } from '@/hooks/use-wallets'
import { checkUnspent, findThorchainOutbound, getTransactionState, historyIncludes } from '@/lib/bch'
import { formatBaseUnits, toBaseUnits } from '@/lib/bridge'
import { withLock } from '@/lib/bridge-first-leg'
import { bridgeCompletionTransactions } from '@/lib/bridge-completion'
import { formatStepTime, stepTime } from '@/lib/bridge-tracking'
import { formatAmount, formatMinutes, formatPercent, formatUsd, PUSD_LEG_SECONDS, valueImpact } from '@/lib/bridge-summary'
import { BroadcastRejected, broadcastBchTransaction, type ReviewedSwap } from '@/lib/cauldron'
import { SignCancelled, SignDeclined, SignTimedOut, SignUndelivered } from '@/lib/bch-signing'
import { type CauldronToken, PUSD_TOKEN } from '@/lib/cauldron-tokens'
import { readableError } from '@/lib/errors'
import { getTxStatus } from '@/lib/api'
import {
  bchAsset,
  blockHeight,
  confirmReportedPayout,
  depositReadyAt,
  destinationChainOf,
  findPayout,
  prepareBchDeposit,
  prepareDeposit,
  prepareSale,
  type PreparedDeposit,
  ReverseBlocked,
  signInWallet,
  startReverseOperation,
  tokenAsset
} from '@/lib/reverse-bridge'
import { DEPOSIT_FEE_RESERVE } from '@/lib/thorchain-deposit'
import { resolveFees } from '@/lib/swap-helpers'
import { isEvmChain } from '@/lib/payout-chains'
import { generateId } from '@/lib/utils'
import { useSwapStore } from '@/store/swap-store'
import {
  type BridgeOperation,
  isBridgeTerminal,
  operationToken,
  type SwapTransaction,
  transactionStore,
  useActiveBridge,
  useTransaction,
  useUpdateBridge
} from '@/store/transaction-store'

// The reverse bridge's UI: the form's button, the confirm dialog, the progress screen and the
// tracker. Step 1 (a token only) sells it for BCH on Cauldron; step 2 deposits the BCH to THORChain,
// which pays the destination address. Both are signed in the bound BCH wallet and broadcast by this app.

type BridgeTx = SwapTransaction & { bridge: BridgeOperation }
type Update = ReturnType<typeof useUpdateBridge>

const formatBch = (sats: bigint | string) => formatBaseUnits(sats, 8)
// How long the payout is looked for in the router's logs alone before THORNode's report is also read.
const REPORTED_PAYOUT_AFTER_MS = 3 * 60_000
const toNumber = (value?: USwapNumber) => (value ? Number(value.toSignificant(12)) : undefined)
const usdText = (value?: number) => (value === undefined || !Number.isFinite(value) ? undefined : formatUsd(value))

const freshOperation = async (uid: string) => {
  await transactionStore.persist.rehydrate()
  const tx = transactionStore.getState().transactions.find(t => t.uid === uid)
  return tx && tx.kind !== 'send' && tx.bridge ? (tx as BridgeTx) : undefined
}

// --- Broadcast -----------------------------------------------------------------------------------

const broadcastSale = async (uid: string, signedHex: string, txid: string, update: Update) => {
  try {
    await broadcastBchTransaction(signedHex, txid)
    // Accepted by the network: the BCH is there at 0-conf, step 2 can be signed.
    update(uid, () => ({ stage: 'bch_ready', error: undefined }))
  } catch (error) {
    if (error instanceof BroadcastRejected) {
      const seen = await getTransactionState(txid).catch(() => ({ seen: false }))
      if (!seen.seen) return update(uid, () => ({ stage: 'failed', error: `The swap was rejected: ${error.message}. Nothing was sent.` }))
    }
    update(uid, () => ({ stage: 'first_leg_unknown', error: error instanceof Error ? error.message : 'Broadcast outcome unknown' }))
  }
}

const broadcastDeposit = async (uid: string, signedHex: string, txid: string, update: Update) => {
  try {
    await broadcastBchTransaction(signedHex, txid)
    update(uid, () => ({ stage: 'second_leg_pending', error: undefined }))
  } catch (error) {
    if (error instanceof BroadcastRejected) {
      const seen = await getTransactionState(txid).catch(() => ({ seen: false }))
      if (!seen.seen) {
        // Nothing reached THORChain: a token operation goes back to step 2 with the BCH it holds;
        // a plain one ends here, its BCH untouched.
        return update(uid, op =>
          op.reverse?.sale
            ? {
                stage: 'bch_ready',
                error: `The deposit was rejected: ${error.message}. Prepare it again.`,
                reverse: { ...op.reverse, deposit: undefined, priorDepositTxids: [...(op.reverse.priorDepositTxids ?? []), txid] }
              }
            : { stage: 'failed', error: `The deposit was rejected: ${error.message}. Nothing was sent.` }
        )
      }
    }
    update(uid, op => ({
      stage: 'second_leg_unknown',
      reverse: { ...op.reverse!, deposit: { ...op.reverse!.deposit!, error: error instanceof Error ? error.message : 'Broadcast outcome unknown' } }
    }))
  }
}

// Signs a prepared deposit for the operation `uid` and broadcasts it.
const sendDeposit = async (uid: string, prepared: PreparedDeposit, update: Update, wallet: ReturnType<typeof useBchWallet>, signal?: AbortSignal) => {
  const tx = await freshOperation(uid)
  const op = tx?.bridge
  if (!op?.reverse || !wallet.manager || !wallet.binding) throw new Error('The BCH wallet is not connected')
  const { built, route, router } = prepared
  const startBlock = await blockHeight(destinationChainOf(op.reverse.buyAsset)).catch(() => undefined)
  const asset = tx!.assetTo.ticker
  const { txid, signedHex } = await signInWallet(
    wallet.manager,
    op.binding,
    built,
    `Send ${formatBch(built.amountSats)} BCH to THORChain for at least ${route.expectedBuyAmountMaxSlippage ?? route.expectedBuyAmount} ${asset}`,
    { signal }
  )
  update(uid, current => ({
    stage: 'second_leg_signed',
    ...(current.reverse?.sale ? {} : { hash: txid }),
    reverse: {
      ...current.reverse!,
      deposit: {
        attempt: generateId(),
        amountSats: built.amountSats.toString(),
        minerFeeSats: built.minerFeeSats.toString(),
        memo: route.memo!,
        inboundAddress: route.inboundAddress!,
        router,
        startBlock,
        expectedOut: route.expectedBuyAmount,
        txid,
        signedHex,
        signedAt: Date.now()
      }
    }
  }))
  await broadcastDeposit(uid, signedHex, txid, update)
}

// --- Tracking ------------------------------------------------------------------------------------

// Progress from the chains: the BCH transactions on Fulcrum, the payout as the router's TransferOut
// event on an EVM chain's RPC or the outbound on another chain's own node, a refund as THORChain's REFUND:<deposit> payment at the bound address.
export const syncReverse = async (tx: BridgeTx, update: Update) => {
  const op = tx.bridge
  const reverse = op.reverse
  if (!reverse) return
  const sale = reverse.sale
  const deposit = reverse.deposit
  switch (op.stage) {
    case 'first_leg_unknown': {
      // Mid-signing when the page went away: this app broadcasts only what it saved, so nothing was sent.
      if (!sale?.txid) return update(tx.uid, () => ({ stage: 'failed', error: 'Nothing was signed, so nothing was sent' }))
      const state = await getTransactionState(sale.txid)
      if (state.seen) update(tx.uid, () => ({ stage: 'bch_ready', error: undefined }))
      return
    }
    case 'first_leg_pending': {
      if (sale?.txid && (await getTransactionState(sale.txid)).seen) update(tx.uid, () => ({ stage: 'bch_ready', error: undefined }))
      return
    }
    case 'bch_ready': {
      const outputs = sale?.outputs ?? []
      if (!outputs.length) return
      const checked = await checkUnspent(op.binding.lockingBytecode, outputs)
      if (checked.every(o => o.unspent)) return
      // Spent by one of this operation's deposits (a lost broadcast answer) is still ours.
      const ours = await historyIncludes(op.binding.lockingBytecode, reverse.priorDepositTxids ?? [])
      if (ours.length === 0) update(tx.uid, () => ({ stage: 'kept_bch', error: 'The BCH from the swap was spent outside this app' }))
      return
    }
    case 'second_leg_signed':
    case 'second_leg_unknown': {
      if (deposit?.txid && (await getTransactionState(deposit.txid)).seen) update(tx.uid, () => ({ stage: 'second_leg_pending', error: undefined }))
      return
    }
    case 'second_leg_pending': {
      if (!deposit?.txid) return
      const [found, refund, readyAt] = await Promise.all([
        findPayout(op).catch(() => undefined),
        findThorchainOutbound(deposit.txid, op.binding.lockingBytecode, 'REFUND').catch(() => undefined),
        getTxStatus(deposit.txid)
          .then(status => depositReadyAt(status))
          .catch(() => undefined)
      ])
      // On an EVM chain THORChain's own report fills the gap after a while; elsewhere it names the
      // outbound from the start. Either way the payout is checked on the destination chain.
      const reportedNow = !isEvmChain(destinationChainOf(reverse.buyAsset)) || Date.now() - (deposit.signedAt ?? 0) > REPORTED_PAYOUT_AFTER_MS
      const reported = !found?.payout && reportedNow ? await confirmReportedPayout(op).catch(() => undefined) : undefined
      if (reported) return update(tx.uid, current => ({ stage: 'completed', reverse: { ...current.reverse!, payout: reported } }))
      if (found?.payout) {
        return update(tx.uid, current => ({
          stage: 'completed',
          reverse: { ...current.reverse!, payout: found.payout, deposit: { ...current.reverse!.deposit!, scannedBlock: found.scannedBlock } }
        }))
      }
      if (refund?.kind === 'ok') {
        return update(tx.uid, current => ({
          stage: 'refunded',
          reverse: { ...current.reverse!, refund: { txid: refund.outputs[0].txid, amountSats: refund.total } }
        }))
      }
      const scannedBlock = found?.scannedBlock ?? deposit.scannedBlock
      if (scannedBlock !== deposit.scannedBlock || (readyAt !== undefined && readyAt !== deposit.readyAt)) {
        update(tx.uid, current => ({
          reverse: { ...current.reverse!, deposit: { ...current.reverse!.deposit!, scannedBlock, readyAt: readyAt ?? current.reverse!.deposit!.readyAt } }
        }))
      }
      return
    }
  }
}

// --- Form button ---------------------------------------------------------------------------------

interface ButtonState {
  text: string
  spinner: boolean
  accent: boolean
  onClick?: () => void
}

export const ReverseSwapButton = ({ onShowBridge }: { onShowBridge: () => void }) => {
  const t = useTranslations('swap')
  const tReverse = useTranslations('bridge.reverse')
  const asset = useAssetFrom()
  const account = useConnectedAccount(asset?.chain)
  const setExternalWalletMode = useSetExternalWalletMode()
  const token = useSwapStore(state => state.bchToken)
  const amount = useSwapStore(state => state.amountFrom)
  const bchWallet = useBchWallet()
  const activeBridge = useActiveBridge()
  const { quote, isLoading, minimum, error } = useQuote()
  const balance = useBchSideBalance(token)
  const { openDialog } = useDialog()

  const units = (() => {
    try {
      return amount ? toBaseUnits(amount, token ? token.decimals : 8) : 0n
    } catch {
      return undefined
    }
  })()

  const getState = (): ButtonState => {
    if (!bchWallet.binding) {
      const connecting = bchWallet.state === 'connecting' || bchWallet.state === 'reconnecting'
      return {
        text: bchWallet.mismatch ? t('button.connectBoundBch') : t('button.connectBch'),
        spinner: connecting && !bchWallet.reconnectStalled,
        accent: true,
        onClick: bchWallet.reconnectStalled || bchWallet.mismatch || bchWallet.state === 'connected' ? bchWallet.pairAgain : connecting ? undefined : bchWallet.connect
      }
    }
    if (!asset) return { text: '', spinner: true, accent: false }
    if (!account) {
      return {
        text: t('button.connectWallet', { chain: chainLabel(asset.chain) }),
        spinner: false,
        accent: true,
        onClick: () => {
          setExternalWalletMode(false)
          openDialog(ConnectWallet, { chain: asset.chain })
        }
      }
    }
    if (activeBridge) return { text: t('button.viewBridge'), spinner: false, accent: true, onClick: onShowBridge }
    if (units === undefined) return { text: t('button.noValidQuotes'), spinner: false, accent: false }
    if (units === 0n) return { text: t('button.enterAmount'), spinner: false, accent: false }
    if (isLoading) return { text: t('button.quoting'), spinner: true, accent: false }
    if (!quote && minimum) return { text: t('button.minimum', { amount: minimum, ticker: 'BCH' }), spinner: false, accent: false }
    if (!quote) return { text: token && error ? tReverse('noTokenRoute', { ticker: token.ticker }) : t('button.noValidQuotes'), spinner: false, accent: false }
    if (balance.isLoading) return { text: t('button.checkingBalance'), spinner: true, accent: false }
    if (balance.units === undefined) return { text: t('button.balanceUnavailable'), spinner: false, accent: false, onClick: () => balance.refetch() }
    if (balance.units < units + (token ? 0n : DEPOSIT_FEE_RESERVE)) return { text: t('button.insufficientBalance'), spinner: false, accent: false }
    return { text: t('button.send'), spinner: false, accent: true, onClick: () => openDialog(ReverseConfirmDialog, {}) }
  }

  const state = getState()
  return (
    <AnimatedButton
      aria-label={state.text || t('button.enterAmount')}
      colorType={state.accent ? 'accent' : 'default'}
      className="bridge-primary w-full"
      onClick={state.onClick}
      disabled={!state.onClick}
      loading={state.spinner}
    >
      {state.text}
    </AnimatedButton>
  )
}

// --- Confirm dialog ------------------------------------------------------------------------------

// Where a BCH-wallet signature stands: preparing the transaction, waiting for the wallet app,
// sending what it signed. 'idle' is ready to (re)try.
export type SignPhase = 'idle' | 'preparing' | 'signing' | 'sending'

// A prepared transaction is used for signing only while this fresh; it is rebuilt in the background.
const PREPARED_TTL_MS = 30_000

interface Prepared {
  sale?: ReviewedSwap
  deposit?: PreparedDeposit
}

// The grey line under a button that waits on the BCH wallet: what to do in the wallet app while the
// request is out (with Cancel), and afterwards what happened (declined, timed out, not delivered).
export const SignHint = ({
  phase,
  walletName,
  note,
  onCancel,
  dark = false
}: {
  phase: SignPhase
  walletName: string
  note?: string
  onCancel: () => void
  dark?: boolean
}) => {
  const t = useTranslations('bridge.reverse')
  const className = `bridge-sign-hint${dark ? ' is-dark' : ''}`
  if (phase === 'signing')
    return (
      <p className={className} role="status">
        {t('openWallet', { wallet: walletName })}{' '}
        <button type="button" className="bridge-sign-cancel" onClick={onCancel}>
          {t('cancel')}
        </button>
      </p>
    )
  if (phase === 'preparing' || phase === 'sending') return null
  return note ? (
    <p className={className} role="status">
      {note}
    </p>
  ) : null
}

const RouteSteps = ({ token, asset, thorMinutes, total }: { token: CauldronToken | null; asset: Asset; thorMinutes?: number; total: string }) => {
  const t = useTranslations('bridge.reverse')
  const tConfirm = useTranslations('bridge.confirm')
  const chain = chainLabel(asset.chain)
  return (
    <HoverCard
      label={
        <>
          <span>{token ? 2 : 1}</span>
          {token && <CauldronMark />}
          <ThorchainMark />
        </>
      }
    >
      <span className="bridge-tip-row bridge-tip-head">
        <span>{tConfirm('routeTransactions', { count: token ? 2 : 1 })}</span>
        <span className="bridge-tip-label">{total}</span>
      </span>
      <span className="bridge-tip-sep" />
      {token ? (
        <span className="bridge-tip-steps">
          <span className="bridge-tip-step">
            <CauldronMark size={22} />
            <span>
              <strong>{t('routeSwap', { from: token.ticker })}</strong>
              <span className="bridge-tip-label">{t('routeSwapDetail', { minutes: formatMinutes(PUSD_LEG_SECONDS) })}</span>
            </span>
          </span>
          <span className="bridge-tip-step">
            <ThorchainMark size={22} />
            <span>
              <strong>{t('routeBridge', { to: asset.ticker })}</strong>
              <span className="bridge-tip-label">{t('routeBridgeDetail', { chain, minutes: thorMinutes ?? '—' })}</span>
            </span>
          </span>
        </span>
      ) : (
        <span className="bridge-tip-label">{t('routeSingle', { to: asset.ticker, chain })}</span>
      )}
    </HoverCard>
  )
}

export const ReverseConfirmDialog = ({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) => {
  const t = useTranslations('bridge.confirm')
  const tReverse = useTranslations('bridge.reverse')
  const tBridge = useTranslations('bridge')
  const tSwap = useTranslations('swap')
  const asset = useAssetFrom()
  const account = useConnectedAccount(asset?.chain)
  const token = useSwapStore(state => state.bchToken)
  const amount = useSwapStore(state => state.amountFrom)
  const setAmountFrom = useSwapStore(state => state.setAmountFrom)
  const slippage = useSwapStore(state => state.slippage)
  const wallet = useBchWallet()
  const update = useUpdateBridge()
  const live = useQuote().quote
  const sale = useTokenSale(token, amount)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<SignPhase>('idle')
  const [note, setNote] = useState<string>()
  const submitting = phase !== 'idle'
  // One request at a time, whatever the button sees: state updates land a render late.
  const inFlight = useRef(false)
  const abort = useRef<AbortController | undefined>(undefined)
  // Closing the dialog withdraws a request still waiting in the wallet.
  useEffect(() => () => abort.current?.abort(), [])
  const walletName = wallet.walletName ?? tBridge('wallet.yourWallet')
  const destination = account?.address
  const binding = wallet.binding
  const units = useMemo(() => {
    try {
      return amount ? toBaseUnits(amount, token ? token.decimals : 8) : undefined
    } catch {
      return undefined
    }
  }, [amount, token])
  // The transaction is prepared while the dialog is open and kept fresh, so Confirm goes straight
  // to the wallet. Nothing is refreshed while a request is out.
  const prepared = useQuery({
    queryKey: ['reverse-prepared', token?.category ?? 'BCH', units?.toString(), asset?.identifier, destination, binding?.pubkey],
    queryFn: async (): Promise<Prepared> =>
      token
        ? { sale: await prepareSale(token, units!, binding!) }
        : { deposit: await prepareBchDeposit({ amountSats: units!, binding: binding!, buyAsset: asset!.identifier, shortCode: asset!.shortCode, destination: destination!, slippage: slippage ?? 1 }) },
    enabled: isOpen && !submitting && !!binding && !!destination && !!asset && !!units && units > 0n,
    staleTime: PREPARED_TTL_MS,
    refetchInterval: PREPARED_TTL_MS,
    gcTime: 0,
    retry: 1
  })
  // The form refreshes its quote on a timer, and a refreshing quote reads as none: the dialog keeps
  // the last one it showed (the deposit itself is always quoted again right before signing).
  const [quote, setQuote] = useState(live)
  useEffect(() => {
    if (live && !submitting) setQuote(live)
  }, [live, submitting])

  const identifiers = useMemo(() => [...new Set([BridgeConfig.buyAsset, ...(asset ? [asset.identifier] : []), ...(quote?.fees.map(f => f.asset) ?? [])])].sort(), [asset, quote])
  const { rates } = useRates(identifiers, quote?.providers[0])
  const bchUsd = toNumber(rates[BridgeConfig.buyAsset])
  const outUsd = asset ? toNumber(rates[asset.identifier]) : undefined
  const fees = quote ? resolveFees(quote, rates) : undefined

  if (!asset || !quote) return null
  const chain = chainLabel(asset.chain)
  const sentAmount = Number(amount)
  const sentBch = token ? (sale.quote ? Number(sale.quote.output) / 1e8 : undefined) : sentAmount
  const sentUsd = sentBch !== undefined && bchUsd ? sentBch * bchUsd : undefined
  const received = Number(quote.expectedBuyAmount)
  const receivedUsd = outUsd ? received * outUsd : undefined
  const thorSeconds = quote.estimatedTime?.total
  const seconds = thorSeconds ? thorSeconds + (token ? PUSD_LEG_SECONDS : 0) : undefined
  const minutes = seconds ? t('minutes', { minutes: formatMinutes(seconds) }) : '—'
  // BCH network fees: the sale's miner fee (from its local build) and the deposit's, at most the reserve.
  const bchGas = (Number(sale.quote?.minerFeeSats ?? 0n) + Number(DEPOSIT_FEE_RESERVE)) / 1e8
  const gasUsd = bchUsd ? bchGas * bchUsd : undefined
  // Value lost from what is sent to what arrives, BCH network fees aside.
  // A token is valued at what it is worth at the pools' spot price, before Cauldron's fee and impact.
  const sentValueUsd = token ? (!sale.error && sale.quote && bchUsd ? (sale.quote.spotOutput / 1e8) * bchUsd : undefined) : sentUsd
  const { impactUsd, impactPercent } = valueImpact(sentValueUsd, receivedUsd)
  const cauldronFeeUsd = token && sale.quote && bchUsd ? (Number(sale.quote.tradeFeeSats) / 1e8) * bchUsd : undefined
  const thorFeeUsd = fees ? toNumber(fees.included) : undefined
  const ticker = token?.ticker ?? 'BCH'

  const onConfirm = async () => {
    if (inFlight.current || !binding || !wallet.manager || !destination || !units) return
    inFlight.current = true
    const controller = new AbortController()
    abort.current = controller
    setNote(undefined)
    let uid: string | undefined
    try {
      setPhase('preparing')
      const fresh = prepared.data && Date.now() - prepared.dataUpdatedAt < PREPARED_TTL_MS
      const ready = fresh ? prepared.data! : (await prepared.refetch({ throwOnError: true })).data!
      if (controller.signal.aborted) throw new SignCancelled('Cancelled')
      const record = {
        provider: ProviderName.THORCHAIN,
        chainId: getChainConfig(Chain.BitcoinCash).chainId,
        timestamp: new Date(),
        estimatedTime: thorSeconds,
        assetFrom: token ? tokenAsset(token) : bchAsset(),
        assetTo: asset,
        amountFrom: amount,
        amountTo: quote.expectedBuyAmount,
        addressFrom: binding.cashAddress,
        addressTo: destination
      }
      const reverse = { buyAsset: asset.identifier, destination }
      if (token && ready.sale) {
        const reviewed = ready.sale
        uid = await startReverseOperation(record, {
          stage: 'first_leg_signing',
          destinationAsset: 'TOKEN',
          token,
          binding,
          walletName: wallet.walletName ?? undefined,
          reverse: {
            ...reverse,
            sale: {
              attempt: generateId(),
              sellTokens: reviewed.tokensSold.toString(),
              minOutput: reviewed.minOutput.toString(),
              bchOut: reviewed.output.toString(),
              minerFeeSats: reviewed.minerFeeSats.toString()
            }
          }
        })
        setPhase('signing')
        const { txid, signedHex } = await signInWallet(
          wallet.manager,
          binding,
          reviewed,
          `Swap ${formatBaseUnits(reviewed.tokensSold, token.decimals)} ${token.ticker} for at least ${formatBch(reviewed.minOutput)} BCH`,
          { signal: controller.signal }
        )
        setPhase('sending')
        const id = uid
        update(id, op => ({
          stage: 'first_leg_pending',
          hash: txid,
          reverse: { ...op.reverse!, sale: { ...op.reverse!.sale!, txid, signedHex, outputs: reviewed.bchOutputs.map(o => ({ txid, vout: o.vout, value: o.value.toString() })) } }
        }))
        await broadcastSale(id, signedHex, txid, update)
      } else if (!token && ready.deposit) {
        uid = await startReverseOperation(record, { stage: 'first_leg_signing', destinationAsset: 'BCH', binding, walletName: wallet.walletName ?? undefined, reverse })
        setPhase('signing')
        await sendDeposit(uid, ready.deposit, update, wallet, controller.signal)
      } else {
        throw new Error(tReverse('prepareFailed'))
      }
      toast.success(tSwap('toast.transactionSubmitted'))
      setAmountFrom('')
      onOpenChange(false)
    } catch (error) {
      // Nothing was signed: the record goes, and a fresh transaction is prepared for the next try.
      if (uid) {
        const id = uid
        const op = transactionStore.getState().transactions.find(x => x.uid === id)
        if (op && op.kind !== 'send' && op.bridge?.stage === 'first_leg_signing') transactionStore.getState().removeTransaction(id)
      }
      if (error instanceof SignCancelled) setNote(tReverse('signCancelled'))
      else if (error instanceof SignDeclined) setNote(tReverse('signDeclined', { wallet: walletName }))
      else if (error instanceof SignTimedOut) setNote(tReverse('signTimedOut', { wallet: walletName }))
      else if (error instanceof SignUndelivered) setNote(tReverse('signUndelivered', { wallet: walletName }))
      else {
        console.warn('Reverse bridge failed to start', error)
        setNote(error instanceof ReverseBlocked ? error.message : readableError(error, tSwap('toast.errorSubmitting')))
      }
      void prepared.refetch()
    } finally {
      inFlight.current = false
      abort.current = undefined
      setPhase('idle')
    }
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="bridge-confirm-dialog flex h-auto max-h-5/6 flex-col md:max-w-[620px]">
        <CredenzaHeader>
          <CredenzaTitle>{t('title')}</CredenzaTitle>
          <CredenzaDescription className="sr-only">{t('transfer')}</CredenzaDescription>
        </CredenzaHeader>
        <ScrollArea className="relative flex min-h-0 flex-1 px-4 md:px-7" classNameViewport="flex-1 h-auto">
          <div className="bridge-confirm">
            <section className="bridge-confirm-transfer" aria-label={t('transfer')}>
              <div className="bridge-confirm-wallets">
                <span className="bridge-confirm-wallet" title={wallet.binding?.cashAddress}>
                  <img src="/networks/bch.svg" width={22} height={22} alt="" />
                  {wallet.binding ? shortBridgeAddress(wallet.binding.cashAddress) : 'Bitcoin Cash'}
                </span>
                <span className="bridge-confirm-arrow" aria-hidden="true">
                  <ArrowRight size={18} />
                </span>
                <span className="bridge-confirm-wallet" title={account?.address}>
                  <img src={`/networks/${asset.chain.toLowerCase()}.svg`} width={22} height={22} alt="" />
                  {account ? shortBridgeAddress(account.address) : chain}
                </span>
              </div>
              <div className="bridge-confirm-amounts">
                <div>
                  <div className="bridge-confirm-amount">
                    <span className="bridge-confirm-token">{token ? <TokenMark token={token} /> : <BchMark />}</span>
                    <strong>{formatAmount(sentAmount)}</strong>
                  </div>
                  <span>
                    {t('on', { ticker, chain: 'Bitcoin Cash' })}
                    {sentUsd !== undefined ? ` · ${formatUsd(sentUsd)}` : ''}
                  </span>
                </div>
                <div className="bridge-confirm-received">
                  <div className="bridge-confirm-amount">
                    <strong>≈ {formatAmount(received)}</strong>
                    <span className="bridge-confirm-token">
                      <AssetIcon asset={asset} showNetworkIcons={false} />
                    </span>
                  </div>
                  <span>
                    {t('on', { ticker: asset.ticker, chain })}
                    {receivedUsd !== undefined ? ` · ${formatUsd(receivedUsd)}` : ''}
                  </span>
                </div>
              </div>
            </section>

            <section className="bridge-confirm-details">
              <button type="button" className="bridge-confirm-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
                <span className="bridge-confirm-rate">
                  {sentAmount > 0 ? t('rate', { from: ticker, amount: formatAmount(received / sentAmount), to: asset.ticker }) : t('details')}
                </span>
                <span className="bridge-confirm-chip">
                  <Fuel size={16} aria-hidden="true" />
                  <span className="sr-only">{t('gas')}</span>
                  {usdText(gasUsd) ?? '—'}
                </span>
                <span className="bridge-confirm-chip">
                  <Clock size={16} aria-hidden="true" />
                  <span className="sr-only">{t('time')}</span>
                  {minutes}
                </span>
                <ChevronDown size={18} className="bridge-confirm-chevron" aria-hidden="true" />
              </button>
              {open && (
                <dl className="bridge-confirm-rows">
                  <div>
                    <dt>
                      <Route size={16} aria-hidden="true" />
                      {t('route')}
                    </dt>
                    <dd>
                      <RouteSteps token={token} asset={asset} thorMinutes={thorSeconds ? formatMinutes(thorSeconds) : undefined} total={minutes} />
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Clock size={16} aria-hidden="true" />
                      {t('time')}
                    </dt>
                    <dd>{minutes}</dd>
                  </div>
                  <div>
                    <dt>
                      <Wallet size={16} aria-hidden="true" />
                      {t('minimumReceived')}
                    </dt>
                    <dd>{quote.expectedBuyAmountMaxSlippage ? `${formatAmount(Number(quote.expectedBuyAmountMaxSlippage))} ${asset.ticker}` : '—'}</dd>
                  </div>
                  <div>
                    <dt>
                      <Fuel size={16} aria-hidden="true" />
                      {t('gas')}
                    </dt>
                    <dd>
                      <HoverCard label={usdText(gasUsd) ?? '—'}>
                        <span className="bridge-tip-row bridge-tip-head">
                          <span>{t('gasTotal')}</span>
                          <span>{usdText(gasUsd) ?? '—'}</span>
                        </span>
                        <span className="bridge-tip-sep" />
                        <span className="bridge-tip-row">
                          <span className="bridge-tip-label">{tReverse('gasBch')}</span>
                          <span>{formatAmount(bchGas)} BCH</span>
                        </span>
                      </HoverCard>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <TrendingDown size={16} aria-hidden="true" />
                      {t('priceImpact')}
                    </dt>
                    <dd>
                      <HoverCard label={impactPercent === undefined ? '—' : formatPercent(impactPercent)}>
                        <span className="bridge-tip-row bridge-tip-head">
                          <span>{t('impactTotal')}</span>
                          <span className="bridge-tip-label">
                            {impactUsd === undefined ? '—' : `${formatUsd(impactUsd)} (${formatPercent(impactPercent ?? 0)})`}
                          </span>
                        </span>
                        <span className="bridge-tip-sep" />
                        <span className="bridge-tip-row">
                          <span className="bridge-tip-label">{t('thorFee')}</span>
                          <span>{usdText(thorFeeUsd === undefined ? undefined : -thorFeeUsd) ?? '—'}</span>
                        </span>
                        {token && (
                          <span className="bridge-tip-row">
                            <span className="bridge-tip-label">{t('cauldronFee')}</span>
                            <span>{usdText(cauldronFeeUsd === undefined ? undefined : -cauldronFeeUsd) ?? '—'}</span>
                          </span>
                        )}
                      </HoverCard>
                    </dd>
                  </div>
                </dl>
              )}
            </section>
          </div>
        </ScrollArea>
        <div className="space-y-3 p-4 pt-2 md:px-7 md:pb-7">
          <GenericButton colorType="3" size="large" className="w-full" onClick={onConfirm} disabled={submitting || !wallet.manager || wallet.state !== 'connected'}>
            {submitting && <LoaderCircle size={20} className="animate-spin" />}
            <span>
              {phase === 'signing'
                ? tReverse('waitingWallet', { wallet: walletName })
                : phase === 'preparing'
                  ? tReverse('preparing')
                  : phase === 'sending'
                    ? tReverse('sending')
                    : token
                      ? tReverse('swapFirst', { amount: formatAmount(sentAmount), ticker })
                      : t('send', { amount: formatAmount(sentAmount), ticker })}
            </span>
          </GenericButton>
          <SignHint
            phase={phase}
            walletName={walletName}
            note={note ?? (wallet.state !== 'connected' ? tReverse('walletAway') : undefined)}
            onCancel={() => abort.current?.abort()}
          />
        </div>
      </CredenzaContent>
    </Credenza>
  )
}

// --- Progress screen -----------------------------------------------------------------------------

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// Step 2 of a token operation, ready to sign: the deposit freshly quoted and built on the BCH the
// sale paid, its figures shown, then signed in the BCH wallet.
const useDepositStep = (tx: BridgeTx) => {
  const t = useTranslations('bridge')
  const update = useUpdateBridge()
  const wallet = useBchWallet()
  const slippage = useSwapStore(state => state.slippage)
  const [phase, setPhase] = useState<SignPhase>('idle')
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const inFlight = useRef(false)
  const abort = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => abort.current?.abort(), [])
  const op = tx.bridge
  const outputs = op.reverse?.sale?.outputs ?? []
  const fundingKey = outputs.map(o => `${o.txid}:${o.vout}:${o.value}`).join('|')
  const walletMatches = wallet.state === 'connected' && !!wallet.binding && wallet.binding.pubkey === op.binding.pubkey
  const walletName = wallet.walletName ?? op.walletName ?? t('wallet.yourWallet')

  // Quoted and built in the background and kept fresh, so the button goes straight to the wallet.
  const prepared = useQuery({
    queryKey: ['reverse-deposit', tx.uid, fundingKey],
    queryFn: () =>
      prepareDeposit({
        funding: outputs,
        payAll: true,
        binding: op.binding,
        buyAsset: op.reverse!.buyAsset,
        shortCode: tx.assetTo.shortCode,
        destination: op.reverse!.destination,
        slippage: slippage ?? 1
      }),
    enabled: op.stage === 'bch_ready' && outputs.length > 0 && !!op.reverse && phase === 'idle',
    refetchInterval: PREPARED_TTL_MS,
    retry: 1,
    staleTime: PREPARED_TTL_MS
  })

  const sign = async () => {
    if (inFlight.current || !walletMatches) return
    inFlight.current = true
    const controller = new AbortController()
    abort.current = controller
    setError(undefined)
    setNote(undefined)
    try {
      setPhase('preparing')
      const fresh = prepared.data && Date.now() - prepared.dataUpdatedAt < PREPARED_TTL_MS
      const ready = fresh ? prepared.data! : (await prepared.refetch({ throwOnError: true })).data!
      if (controller.signal.aborted) throw new SignCancelled('Cancelled')
      const done = await withLock(`bch-bridge-sign-${tx.uid}`, async () => {
        const current = await freshOperation(tx.uid)
        if (current?.bridge.stage !== 'bch_ready') throw new Error(t('second.movedOn'))
        setPhase('signing')
        await sendDeposit(tx.uid, ready, update, wallet, controller.signal)
        return true
      })
      if (done === undefined) throw new Error(t('second.otherTab'))
    } catch (e) {
      if (e instanceof SignCancelled) setNote(t('reverse.signCancelled'))
      else if (e instanceof SignDeclined) setNote(t('reverse.signDeclined', { wallet: walletName }))
      else if (e instanceof SignTimedOut) setNote(t('reverse.signTimedOut', { wallet: walletName }))
      else if (e instanceof SignUndelivered) setNote(t('reverse.signUndelivered', { wallet: walletName }))
      else setError(readableError(e, t('reverse.prepareFailed')))
      void prepared.refetch()
    } finally {
      inFlight.current = false
      abort.current = undefined
      setPhase('idle')
    }
  }

  const keep = () => update(tx.uid, current => (current.stage === 'bch_ready' ? { stage: 'kept_bch' } : {}))
  const prepError = !prepared.data && prepared.error instanceof Error ? prepared.error.message : undefined
  return {
    prepared: prepared.data,
    preparing: !prepared.data && prepared.isFetching,
    error: error ?? prepError,
    note,
    phase,
    walletName,
    cancel: () => abort.current?.abort(),
    sign,
    keep,
    walletMatches,
    retry: () => prepared.refetch()
  }
}

const DepositQuoteBlock = ({ route, amountSats, minerFeeSats, ticker, bchUsd }: { route: QuoteResponseRoute; amountSats: bigint; minerFeeSats: bigint; ticker: string; bchUsd?: number }) => {
  const t = useTranslations('bridge.reverse')
  const tProgress = useTranslations('bridge.progress')
  const [open, setOpen] = useState(true)
  const bch = Number(amountSats) / 1e8
  const out = Number(route.expectedBuyAmount)
  const fee = Number(minerFeeSats) / 1e8
  return (
    <section className="bridge-confirm-details bridge-flow-quote">
      <button type="button" className="bridge-confirm-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="bridge-confirm-rate">{t('depositRate', { amount: formatAmount(out / bch), ticker })}</span>
        <ChevronDown size={18} className="bridge-confirm-chevron" aria-hidden="true" />
      </button>
      {open && (
        <dl className="bridge-confirm-rows">
          <div>
            <dt>{t('deposit')}</dt>
            <dd>{formatAmount(bch, 8)} BCH</dd>
          </div>
          <div>
            <dt>{tProgress('networkFee')}</dt>
            <dd>
              {formatAmount(fee)} BCH{bchUsd ? ` (${formatUsd(fee * bchUsd)})` : ''}
            </dd>
          </div>
          <div>
            <dt>{t('expected')}</dt>
            <dd>
              ≈ {formatAmount(out)} {ticker}
            </dd>
          </div>
          {route.expectedBuyAmountMaxSlippage && (
            <div>
              <dt>{tProgress('minimum')}</dt>
              <dd>
                {formatAmount(Number(route.expectedBuyAmountMaxSlippage))} {ticker}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  )
}

export const ReverseOperationPanel = ({ uid, onClose }: { uid?: string; onClose: () => void }) => {
  const t = useTranslations('bridge')
  const tx = useTransaction(uid)
  const { openDialog } = useDialog()
  const [dismissed, setDismissed] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!uid) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [uid])

  const bridgeTx = tx && tx.kind !== 'send' && tx.bridge ? (tx as BridgeTx) : undefined
  const op = bridgeTx?.bridge
  const { rates } = useRates(bridgeTx ? [bridgeTx.assetTo.identifier, BridgeConfig.buyAsset].sort() : [])

  if (!bridgeTx || !op?.reverse) return null
  const active = bridgeTx
  const reverse = op.reverse
  const token = operationToken(op)
  const target = active.assetTo
  const terminal = isBridgeTerminal(op)
  const keptSats = (reverse.sale?.outputs ?? []).reduce((sum, output) => sum + BigInt(output.value), 0n)
  const keptBch = op.stage === 'kept_bch' && keptSats > 0n && !op.error
  const completed = op.stage === 'completed' || keptBch
  const saleDone = !!token && !['first_leg_signing', 'first_leg_pending', 'first_leg_unknown'].includes(op.stage) && !!reverse.sale?.txid
  const depositing = ['second_leg_signed', 'second_leg_unknown', 'second_leg_pending'].includes(op.stage)
  const ready = op.stage === 'bch_ready' && !!token
  const stage: FlowStage = completed ? 'done' : terminal ? 'ended' : ready ? 'ready' : token ? (depositing ? 'swapping' : 'bridging') : 'plain'

  const eta = (time: ReturnType<typeof stepTime>) => {
    const label = formatStepTime(time)
    return label.key === 'minutes'
      ? t('progress.minutes', { minutes: label.value })
      : label.key === 'seconds'
        ? t('progress.seconds', { seconds: label.value })
        : t('progress.elapsedTime', { time: label.value })
  }
  const start = new Date(active.timestamp).getTime()
  const depositStart = reverse.deposit?.signedAt ?? op.updatedAt
  // THORNode's own countdown (it can wait for several BCH blocks) replaces the quote's estimate.
  const bridgeSeconds = reverse.deposit?.readyAt ? Math.max(1, Math.round((reverse.deposit.readyAt - depositStart) / 1000)) : active.estimatedTime
  // Each bar opens its step's transaction: the sale on the BCH explorer; the deposit on THORChain's
  // explorer (which follows the swap to the payout), then the payout on the destination chain's.
  const saleHref = reverse.sale?.txid ? chainTxUrl(Chain.BitcoinCash, reverse.sale.txid) : undefined
  const bridgeHref = reverse.payout
    ? chainTxUrl(target.chain, reverse.payout.hash)
    : reverse.deposit?.txid
      ? thorchainTxUrl(reverse.deposit.txid)
      : undefined
  const bridgeBar = (): FlowBar =>
    completed
      ? { fill: 1, done: true, href: bridgeHref }
      : depositing
        ? {
            fill: bridgeSeconds ? Math.min(0.95, Math.max(0.05, (now - depositStart) / (bridgeSeconds * 1000))) : 0.5,
            eta: eta(stepTime(now, depositStart, bridgeSeconds)),
            live: op.stage !== 'second_leg_unknown',
            href: bridgeHref
          }
        : { fill: 0, eta: active.estimatedTime ? t('progress.minutes', { minutes: formatMinutes(active.estimatedTime) }) : undefined, href: bridgeHref }
  const firstBar: FlowBar = token
    ? saleDone
      ? { fill: 1, done: true, href: saleHref }
      : { fill: 0.6, live: !terminal && op.stage !== 'first_leg_unknown', eta: eta(stepTime(now, start, PUSD_LEG_SECONDS)), href: saleHref }
    : bridgeBar()
  const secondBar = token ? bridgeBar() : undefined

  const rateOf = (id: string) => (rates[id] ? Number(rates[id].toSignificant(12)) : undefined)
  const bchUsd = rateOf(BridgeConfig.buyAsset)
  const targetUsd = rateOf(target.identifier)
  const bchSats = reverse.deposit ? BigInt(reverse.deposit.amountSats) : reverse.sale ? BigInt(reverse.sale.bchOut) : toBaseUnitsSafe(active.amountFrom)
  const bchAmount = bchSats === undefined ? undefined : Number(bchSats) / 1e8
  const outAmount = reverse.payout?.amount ? Number(reverse.payout.amount) / 10 ** target.decimals : Number(reverse.deposit?.expectedOut ?? active.amountTo)

  const icon = (node: ReactNode) => <span className="bridge-flow-icon">{node}</span>
  const sent: FlowToken = token
    ? { amount: formatAmount(Number(active.amountFrom), 6), ticker: token.ticker, icon: <TokenMark token={token} size={30} /> }
    : { amount: formatAmount(Number(active.amountFrom), 8), ticker: 'BCH', usd: usdText(bchAmount !== undefined && bchUsd ? bchAmount * bchUsd : undefined), icon: <BchMark size={30} /> }
  const bch: FlowToken = {
    amount: bchAmount === undefined ? '—' : `${saleDone ? '' : '≈ '}${formatAmount(bchAmount, saleDone ? 8 : 4)}`,
    ticker: 'BCH',
    usd: usdText(bchAmount !== undefined && bchUsd ? bchAmount * bchUsd : undefined),
    icon: <BchMark size={30} />
  }
  const out: FlowToken = {
    amount: Number.isFinite(outAmount) ? `${completed ? '' : '≈ '}${formatAmount(outAmount, 6)}` : '—',
    ticker: target.ticker,
    usd: usdText(Number.isFinite(outAmount) && targetUsd ? outAmount * targetUsd : undefined),
    icon: icon(<AssetIcon asset={target} showNetworkIcons={false} />)
  }

  const toasts: FlowToast[] = [
    ...(reverse.sale?.txid ? [{ id: `sale:${reverse.sale.txid}`, title: t('reverse.toastSwap', { ticker: token?.ticker ?? '' }), hash: reverse.sale.txid, chain: Chain.BitcoinCash, time: timeOf(start) }] : []),
    ...(reverse.deposit?.txid ? [{ id: `deposit:${reverse.deposit.txid}`, title: t('reverse.toastDeposit'), hash: reverse.deposit.txid, chain: Chain.BitcoinCash }] : []),
    ...(reverse.payout ? [{ id: `payout:${reverse.payout.hash}`, title: t('reverse.toastPayout', { ticker: target.ticker }), hash: reverse.payout.hash, chain: target.chain }] : []),
    ...(reverse.refund ? [{ id: `refund:${reverse.refund.txid}`, title: t('reverse.toastRefund'), hash: reverse.refund.txid, chain: Chain.BitcoinCash }] : [])
  ]
    .filter(item => !dismissed.includes(item.id))
    .reverse()

  const common = {
    reverse: true,
    sourceChain: target.chain,
    sourceAddress: reverse.destination,
    bchAddress: op.binding.cashAddress,
    sent,
    bch: token ? bch : out,
    final: token ? out : undefined,
    firstBar,
    secondBar,
    completion: {
      received: keptBch
        ? { amount: formatBaseUnits(keptSats, 8), ticker: 'BCH', icon: <BchMark size={48} /> }
        : { amount: reverse.payout?.amount === undefined ? '—' : formatBaseUnits(reverse.payout.amount, target.decimals), ticker: target.ticker, icon: <AssetIcon asset={target} showNetworkIcons={false} /> },
      transactions: bridgeCompletionTransactions(active),
      liquidityCategory: keptBch ? PUSD_TOKEN.category : undefined
    },
    toasts,
    onDismissToast: (id: string) => setDismissed(list => [...list, id]),
    onHistory: () => openDialog(TransactionHistoryDialog, {}),
    onClose,
    animateCollapse: true
  }

  const error = op.error && !completed ? <SwapError error={new Error(op.error)} /> : null
  const details = (
    <>
      {terminal && !completed && <p className="bridge-flow-message">{t(`reverse.stage.${op.stage}`)}</p>}
      {error}
    </>
  )
  const actions = depositing ? (
    <ResendDeposit tx={active} />
  ) : op.stage === 'first_leg_unknown' ? (
    <ResendSale tx={active} />
  ) : terminal ? (
    <GenericButton className="bridge-flow-primary is-active w-full" onClick={onClose}>
      {t(completed ? 'progress.newTransfer' : 'progress.done')}
    </GenericButton>
  ) : null

  const title = completed ? t('progress.completeTitle') : ready ? t('reverse.readyTitle') : t('progress.processing')

  return (
    <Dialog
      open={!!uid}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="bridge-flow-layer" showCloseButton={false}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{t('reverse.description', { to: target.ticker })}</DialogDescription>
        {ready ? (
          <ReverseReadyStage key={active.uid} tx={active} bchUsd={bchUsd} common={common} />
        ) : (
          <BridgeFlow stage={stage} title={title} {...common} details={details} actions={actions} />
        )}
      </DialogContent>
    </Dialog>
  )
}

const toBaseUnitsSafe = (amount: string) => {
  try {
    return toBaseUnits(amount, 8)
  } catch {
    return undefined
  }
}

type CommonProps = Omit<Parameters<typeof BridgeFlow>[0], 'stage' | 'title' | 'details' | 'actions'>

const ReverseReadyStage = ({ tx, bchUsd, common }: { tx: BridgeTx; bchUsd?: number; common: CommonProps }) => {
  const t = useTranslations('bridge')
  const step = useDepositStep(tx)
  const { reconnectStalled, pairAgain } = useBchWallet()
  const prepared = step.prepared
  const final = common.final && prepared ? { ...common.final, amount: `≈ ${formatAmount(Number(prepared.route.expectedBuyAmount), 6)}` } : common.final
  const bch = prepared ? { ...common.bch, amount: formatAmount(Number(prepared.built.amountSats) / 1e8, 8) } : common.bch

  return (
    <BridgeFlow
      stage="ready"
      title={t('reverse.readyTitle')}
      {...common}
      bch={bch}
      final={final}
      details={
        <>
          {prepared && (
            <DepositQuoteBlock
              route={prepared.route}
              amountSats={prepared.built.amountSats}
              minerFeeSats={prepared.built.minerFeeSats}
              ticker={tx.assetTo.ticker}
              bchUsd={bchUsd}
            />
          )}
          {!step.walletMatches && (
            <p className="bridge-flow-message">
              {t('progress.reconnectBch')}
              {reconnectStalled && (
                <>
                  {' '}
                  <button type="button" className="cursor-pointer underline" onClick={pairAgain}>
                    {t('wallet.pairAgain')}
                  </button>
                </>
              )}
            </p>
          )}
          {step.error && <SwapError error={new Error(step.error)} />}
        </>
      }
      actions={
        <>
          <GenericButton
            className="bridge-flow-primary is-active w-full"
            colorType="3"
            onClick={step.sign}
            disabled={step.phase !== 'idle' || step.preparing || !step.walletMatches}
          >
            {(step.phase !== 'idle' || step.preparing) && <LoaderCircle size={18} className="animate-spin" />}
            {step.phase === 'signing'
              ? t('reverse.waitingWallet', { wallet: step.walletName })
              : step.phase === 'sending'
                ? t('reverse.sending')
                : step.phase === 'preparing' || step.preparing
                  ? t('reverse.preparing')
                  : t('reverse.bridgeAction', { ticker: tx.assetTo.ticker })}
          </GenericButton>
          <SignHint dark phase={step.phase} walletName={step.walletName} note={step.note} onCancel={step.cancel} />
          {!prepared && !step.preparing && step.error && (
            <button type="button" className="bridge-flow-link" onClick={step.retry}>
              {t('progress.retry')}
            </button>
          )}
          <button type="button" className="bridge-flow-link" onClick={step.keep} disabled={step.phase !== 'idle'}>
            {t('progress.keepBch')}
          </button>
        </>
      }
    />
  )
}

// Re-sending the same signed bytes is safe: it is one transaction, it cannot pay twice.
const ResendSale = ({ tx }: { tx: BridgeTx }) => {
  const t = useTranslations('bridge')
  const update = useUpdateBridge()
  const [busy, setBusy] = useState(false)
  const sale = tx.bridge.reverse?.sale
  if (!sale?.txid || !sale.signedHex) return null
  return (
    <div className="bridge-progress-offer">
      <p className="bridge-progress-note">{t('second.unknownExplain')}</p>
      <GenericButton
        className="bridge-progress-primary w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await withLock(`bch-bridge-sign-${tx.uid}`, () => broadcastSale(tx.uid, sale.signedHex!, sale.txid!, update))
          setBusy(false)
        }}
      >
        {busy && <LoaderCircle size={16} className="animate-spin" />}
        {t('second.resend')}
      </GenericButton>
    </div>
  )
}

const ResendDeposit = ({ tx }: { tx: BridgeTx }) => {
  const t = useTranslations('bridge')
  const update = useUpdateBridge()
  const [busy, setBusy] = useState(false)
  const deposit = tx.bridge.reverse?.deposit
  const pending = tx.bridge.stage === 'second_leg_pending'
  if (!deposit?.txid) return null
  return (
    <div className="bridge-progress-offer">
      {deposit.error && !pending && <SwapError error={new Error(deposit.error)} />}
      {!pending && <p className="bridge-progress-note">{t('second.unknownExplain')}</p>}
      <GenericButton
        className="bridge-progress-primary w-full"
        disabled={busy || pending}
        onClick={async () => {
          if (!deposit.signedHex) return
          setBusy(true)
          await withLock(`bch-bridge-sign-${tx.uid}`, () => broadcastDeposit(tx.uid, deposit.signedHex!, deposit.txid!, update))
          setBusy(false)
        }}
      >
        {(busy || pending) && <LoaderCircle size={16} className="animate-spin" />}
        {pending ? t('reverse.bridging', { ticker: tx.assetTo.ticker }) : t('second.resend')}
      </GenericButton>
    </div>
  )
}
