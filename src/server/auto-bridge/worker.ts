import { binToHex, binsAreEqual, hexToBin, type Output, type Transaction } from '@bitauth/libauth'
import type { TxStatusResponse } from '@/lib/api'
import { addressToLockingBytecode, checkOutbound, checkPayment, decodeTx, isTxid, normalizeTxid, opReturnText, txidOf, type VerifiedOutput } from '@/lib/bch'
import { inboundMatchesBinding, interpretTxStatus } from '@/lib/bridge'
import { BroadcastRejected, buildTokenTrade, type BuildIntent, type BuildResult } from '@/lib/cauldron'
import { checkInbound, type InboundAddress } from '@/lib/thorchain-deposit'
import { interpretNearStatus, NEAR_BCH, type NearStatusResponse } from '@/lib/near-intents'
import { SALE_ROUTE_DEPOSIT_MS, saleRouteProblem } from '@/server/auto-bridge/sale-route'
import { OrderStore } from '@/server/auto-bridge/store'
import { isTerminal, orderCategory, type Attempt, type Order, type SaleCoin } from '@/server/auto-bridge/types'
import { orderMinimum, orderUnlockBytes, WorkerWallet } from '@/server/auto-bridge/wallet'
import { sourceIdFromMemo, sourceTransactionId, sameSourceTransaction } from '@/lib/source-transaction'
import { MIN_ORDER_COIN_SATS, settlingCoin } from '@/lib/router-contract'

export interface Gateway {
  history(script: string): Promise<string[]>
  raw(txid: string): Promise<string | undefined>
  tip(): Promise<number>
  coin(txid: string, vout: number): Promise<{ output: Output; confirmations: number } | undefined>
  thorStatus(inbound: string): Promise<TxStatusResponse | undefined>
  observe(txid: string): Promise<{ seen: boolean; confirmations: number }>
  broadcast(attempt: Attempt): Promise<void>
  // THORNode's inbound addresses; sale orders deposit only while their vault is current and trading is open.
  inbound?(): Promise<InboundAddress[]>
  // 1Click's status of a NEAR Intents deposit address; undefined when 1Click does not know it.
  nearStatus?(depositAddress: string): Promise<NearStatusResponse | undefined>
}
export interface Policy {
  minConfirmations: number
  zeroConfMaxSats: bigint
  maxWaitMs: number
}
export type TradeBuilder = (order: Order) => Promise<{ build: BuildResult; intent: BuildIntent }>

// Sells as much of the order's BCH as pays for the trade's own miner fee and dust; no reserve is held back.
export const buildOrderTrade: TradeBuilder = async order =>
  buildTokenTrade({
    category: orderCategory(order),
    side: 'buy',
    funding: order.funding,
    lockingBytecode: order.binding.lockingBytecode,
    payout: { tokenScript: order.recipientScript, changeScript: order.refundScript },
    tokenAddress: order.recipientAddress,
    cashAddress: order.refundAddress,
    sell: order.funding.reduce((sum, coin) => sum + BigInt(coin.value), 0n),
    minOutput: orderMinimum(order),
    ownUnlockBytes: orderUnlockBytes(order)
  })

// Recheck actual prevouts from the validating node after construction; indexer metadata is not evidence.
export const assertInputsLive = async (gateway: Gateway, hex: string, sources: Output[], order?: Order, depth = 0) => {
  const tx = decodeTx(hex)
  if (sources.length !== tx.inputs.length) throw new Error('Source output mismatch')
  for (let index = 0; index < tx.inputs.length; index++) {
    const input = tx.inputs[index],
      expected = sources[index]
    const actual = await gateway.coin(binToHex(input.outpointTransactionHash), input.outpointIndex)
    if (
      actual &&
      order?.funding.some(coin => coin.txid === binToHex(input.outpointTransactionHash) && coin.vout === input.outpointIndex) &&
      actual.confirmations < depth
    )
      throw new Error('Funding confirmation depth decreased')
    if (
      !actual ||
      actual.output.valueSatoshis !== expected.valueSatoshis ||
      !binsAreEqual(actual.output.lockingBytecode, expected.lockingBytecode) ||
      !!actual.output.token !== !!expected.token ||
      (expected.token &&
        (!actual.output.token ||
          !binsAreEqual(actual.output.token.category, expected.token.category) ||
          actual.output.token.amount !== expected.token.amount ||
          actual.output.token.nft ||
          expected.token.nft))
    )
      throw new Error('Transaction input is unavailable or changed')
  }
}

// A swap whose pool input went to another trade while every funding coin stays unspent can never confirm.
// Without this an uncertain first broadcast would be resent forever and the order would never reach its fallback.
async function conflicted(gateway: Gateway, order: Order, attempt: Attempt) {
  if (attempt.kind !== 'swap') return false
  let poolSpent = false
  for (const input of decodeTx(attempt.hex).inputs) {
    const txid = binToHex(input.outpointTransactionHash),
      own = order.funding.some(coin => coin.txid === txid && coin.vout === input.outpointIndex)
    const live = await gateway.coin(txid, input.outpointIndex)
    if (own && !live) return false
    if (!own && !live) poolSpent = true
  }
  return poolSpent && !(await gateway.observe(attempt.txid)).seen
}

// Without the browser's source hint, a discovered inbound must come from the order's own sender, chain and asset.
// Only the sender is unforgeable; the amount is left out (six significant digits against THORChain's 1e8 units). A mismatch waits for the hint or an operator.
export const matchesSourceIntent = (status: TxStatusResponse, source?: Order['source']) => {
  if (!source) return true
  const same = (a?: string, b?: string) => !!a && !!b && a.toUpperCase() === b.toUpperCase()
  return same(status.tx?.chain, source.chain) && same(status.tx?.from_address, source.address) && !!status.tx?.coins?.some(coin => same(coin.asset, source.asset))
}

// The recorded reason of a failure, for the log: these are our own fixed messages, never a URL or credential.
export const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'unknown error').replace(/\s+/g, ' ').slice(0, 160)

// Definite refusals of a resent attempt, each in its own pass, before it counts as rejected.
export const FINAL_REFUSALS = 3

// Broadcasts saved bytes and records what the network said: accepted, unknown, or (finally) rejected.
async function send(store: OrderStore, gateway: Gateway, attempt: Attempt): Promise<Attempt['status']> {
  // Durable before the first network write: a crash here must leave acceptance unknown.
  const firstSend = store.beginBroadcast(attempt.txid)
  try {
    await gateway.broadcast(attempt)
    store.attemptStatus(attempt.txid, 'accepted')
    return 'accepted'
  } catch (error) {
    // After a lost first answer one refusal proves nothing (a node may have taken it meanwhile), but
    // every RPC refusing the same bytes several times running means no node holds them: the attempt
    // ends and the order goes on to a rebuild or the BCH fallback, still spending the same funding.
    const refused = error instanceof BroadcastRejected
    const rejected = refused && (firstSend || store.noteRefusal(attempt.txid) >= FINAL_REFUSALS)
    store.attemptStatus(attempt.txid, rejected ? 'rejected' : 'unknown')
    return rejected ? 'rejected' : 'unknown'
  }
}

async function submit(store: OrderStore, gateway: Gateway, order: Order, attempt: Attempt, clock: () => number) {
  const status = await send(store, gateway, attempt)
  const current = store.get(order.id)!
  if (isTerminal(current.state)) return
  if (status === 'accepted') store.update(order.id, current.version, { state: 'submitted', payoutTxid: attempt.txid, error: undefined }, clock())
  else {
    const rejected = status === 'rejected'
    store.update(
      order.id,
      current.version,
      {
        state: rejected ? 'retrying' : 'broadcasting',
        error: rejected ? 'Transaction rejected; rechecking the order inputs.' : 'Broadcast answer unavailable; reconciling the saved transaction.'
      },
      clock()
    )
  }
}

export async function processOrder(
  store: OrderStore,
  gateway: Gateway,
  signer: WorkerWallet,
  original: Order,
  policy: Policy,
  build: TradeBuilder = buildOrderTrade,
  clock: () => number = Date.now
) {
  store.assertWritable()
  let order = store.get(original.id)
  if (!order) return
  if (isTerminal(order.state)) {
    if (order.payoutTxid) {
      const observed = await gateway.observe(order.payoutTxid)
      store.update(order.id, order.version, { observation: { txid: order.payoutTxid, ...observed },
        ...(!observed.seen && { error: 'The final payout needs operator verification; no replacement will be signed.' }) }, clock())
      order = store.get(order.id)!
    }
    await observeDeposit(store, gateway, order, undefined, clock())
    order = store.get(order.id)!
    if (order.contract && order.state !== 'manual_review') await returnLeftovers(gateway, signer, order)
    if (order.inboundHash) {
      const status = await gateway.thorStatus(order.inboundHash)
      if (status && sameSourceTransaction(status.tx?.id, order.inboundHash) && inboundMatchesBinding(status, order.binding.lockingBytecode)) {
        const view = interpretTxStatus(status, order.binding.lockingBytecode)
        if ('refunds' in view) store.update(order.id, order.version, { sourceRefunds: view.refunds.map(r => ({ ...r, evidence: 'thorchain' as const })) }, clock())
      }
    }
    return
  }
  const attempts = store.attempts(order.id)
  // Every previously signed variant remains tracked, even after a known pool rejection.
  for (const attempt of attempts) {
    const observed = await gateway.observe(attempt.txid)
    if (observed.seen) {
      store.attemptStatus(attempt.txid, 'accepted')
      // Keep observation and custody accounting active through shallow payout reorgs.
      store.update(
        order.id,
        order.version,
        {
          payoutTxid: attempt.txid,
          observation: { txid: attempt.txid, seen: true, confirmations: observed.confirmations },
          ...(observed.confirmations >= Math.max(policy.minConfirmations, 6) && {
            observedFunding: (order.observedFunding ?? []).filter(coin => !order!.funding.some(f => f.txid === coin.txid && f.vout === coin.vout))
          }),
          state:
            observed.confirmations >= Math.max(policy.minConfirmations, 6) ? (attempt.kind === 'refund' ? 'refunded' : 'completed') : 'submitted',
          error: undefined
        },
        clock()
      )
      return
    }
  }
  const history = new Set((await gateway.history(order.binding.lockingBytecode)).map(normalizeTxid))
  if (order.contract && (await externalSettlement(store, gateway, order, history, attempts, clock))) return
  const unresolved = [...attempts].reverse().find(attempt => attempt.status !== 'rejected')
  if (unresolved && (await conflicted(gateway, order, unresolved))) {
    // Every attempt spends the order's funding, so a replacement can never pay out twice.
    store.attemptStatus(unresolved.txid, 'rejected', true)
    store.update(order.id, order.version, { state: 'retrying', error: 'A pool input was spent by another trade; rebuilding the swap.' }, clock())
    return
  }
  if (unresolved) {
    // A swap whose broadcast answer was lost and which no node has shown since is resent with the
    // same bytes; past the fallback deadline it stops there for the operator instead of forever,
    // since a node may keep refusing it for a reason this worker cannot tell from a lost answer.
    const deadline = order.deadline ?? (order.receivedAt ?? Infinity) + Math.min(order.maxWaitMs, policy.maxWaitMs)
    if (unresolved.kind !== 'refund' && unresolved.status === 'unknown' && clock() >= deadline) {
      store.update(
        order.id,
        order.version,
        { state: 'manual_review', error: 'The swap was never seen on the network after its broadcast answer was lost; an operator returns the BCH.' },
        clock()
      )
      return
    }
    store.update(order.id, order.version, { observation: { txid: unresolved.txid, seen: false, confirmations: 0 } }, clock())
    order = store.get(order.id)!
    await submit(store, gateway, order, unresolved, clock)
    return
  }

  await observeDeposit(store, gateway, order, history, clock())
  order = store.get(order.id)!
  if (store.isDepositScript(order.recipientScript) || store.isDepositScript(order.refundScript)) {
    store.update(order.id, order.version, { state: 'manual_review', error: 'A customer destination is a service deposit address; operator verification is required.' }, clock())
    return
  }
  const found =
    (order.contract && (await contractFunding(gateway, order))) ||
    (order.nearDepositAddress ? await nearFunding(store, gateway, order, clock) : await thorchainFunding(store, gateway, order, history, clock))
  if (!found) return
  const { received, evidence } = found
  const funding = [...new Map(received.map(coin => [`${coin.txid}:${coin.vout}`, coin])).values()]
  if (!funding.length) return
  if (funding.some(coin => !coin.unspent)) {
    store.update(order.id, order.version, { state: 'manual_review', error: 'Order BCH was spent by an unrecognized transaction.' }, clock())
    return
  }
  const total = funding.reduce((sum, coin) => sum + BigInt(coin.value), 0n)
  const depth = Math.max(policy.minConfirmations, total > policy.zeroConfMaxSats ? 1 : 0)
  if (
    !store.update(
      order.id,
      order.version,
      {
        funding,
        ...evidence,
        receivedAt: order.receivedAt ?? clock(),
        deadline: Math.min(order.deadline ?? Infinity, (order.receivedAt ?? clock()) + Math.min(order.maxWaitMs, policy.maxWaitMs)),
        state: funding.every(coin => coin.confirmations >= depth) ? 'ready' : 'awaiting_confirmations'
      },
      clock()
    )
  )
    return
  order = store.get(order.id)!
  if (order.state !== 'ready') return
  if (pageSettles(order) && clock() < order.receivedAt! + PAGE_FIRST_MS) return
  try {
    const deadline = order.deadline ?? order.receivedAt! + Math.min(order.maxWaitMs, policy.maxWaitMs)
    let trade: Awaited<ReturnType<TradeBuilder>> | undefined
    // A contract pays each coin's swap at the coin's own index, so a contract order that got two coins goes back as BCH.
    const swappable = !order.contract || order.funding.length === 1
    if (swappable && clock() < deadline && total <= store.limits.maxOrderSats && store.exposure() <= store.limits.maxPendingSats) {
      trade = await build(order)
      const { sourcesOf, reviewBuild } = await import('@/lib/cauldron')
      const reviewed = reviewBuild(trade.build, {
        ...trade.intent,
        funding: order.funding,
        lockingBytecode: order.binding.lockingBytecode,
        category: orderCategory(order),
        side: 'buy',
        payout: { tokenScript: order.recipientScript, changeScript: order.refundScript },
        minOutput: orderMinimum(order)
      })
      await assertInputsLive(gateway, reviewed.unsignedHex, sourcesOf(reviewed), order, depth)
    }
    let attempt: Attempt
    // Construction and input checks can outlast the fallback deadline.
    if (trade && clock() < deadline) {
      attempt = signer.signSwap(order, trade.build, trade.intent.sell)
    } else {
      attempt = signer.signRefund(order)
      await assertInputsLive(
        gateway,
        attempt.hex,
        funding.map(coin => ({ lockingBytecode: hexToBin(order!.binding.lockingBytecode), valueSatoshis: BigInt(coin.value) })),
        order,
        depth
      )
    }
    const prior = attempts.find(previous => previous.txid === attempt.txid)
    if (prior) {
      await submit(store, gateway, order, prior, clock)
      return
    }
    if (store.saveAttempt(order, attempt, clock())) await submit(store, gateway, store.get(order.id)!, attempt, clock)
  } catch (error) {
    console.warn(`Order ${order.id.slice(0, 8)} trade attempt failed: ${reasonOf(error)}`)
    const current = store.get(order.id)!
    if (current.version === order.version)
      store.update(
        order.id,
        current.version,
        { state: 'retrying', error: 'A trade meeting the original minimum is unavailable; retrying before the BCH fallback deadline.' },
        clock()
      )
  }
}

type Funding = { received: VerifiedOutput[]; evidence: Pick<Order, 'inboundHash' | 'sourceRefunds'> }

// How long the Router leaves a coin to the page that holds the order's second key before it settles the coin itself.
export const PAGE_FIRST_MS = 12_000
const pageSettles = (order: Order) => order.contract?.version === 2 && !!order.contract.pageKey && order.contract.pageKey !== order.binding.pubkey

// A contract pays its coin only to the customer, so a coin there is settled the moment the node shows it (mempool
// included), before THORChain or 1Click call the swap done; their status still decides an order with no coin yet.
async function contractFunding(gateway: Gateway, order: Order): Promise<Funding | undefined> {
  const received: VerifiedOutput[] = []
  for (const coin of order.observedFunding ?? []) {
    // A CashToken sent to the contract is no BCH to swap; it stays in custody accounting.
    const live = await gateway.coin(coin.txid, coin.vout)
    if (live && !live.output.token) received.push(coin)
  }
  // A stranger's coin or a second payout never blocks the swap or sends the order back; it goes back once it is done.
  const coin = settlingCoin(received, order.expectedBchSats)
  if (!coin) return
  // THORChain's outbound names its inbound in an OUT memo: the scanner's link and the later refund lookup.
  let inboundHash = order.inboundHash
  const hex = !inboundHash && !order.nearDepositAddress ? await gateway.raw(coin.txid) : undefined
  for (const output of hex ? decodeTx(hex).outputs : []) {
    const memo = opReturnText(output.lockingBytecode)
    inboundHash ??= memo ? sourceIdFromMemo(memo) : undefined
  }
  return { received: [coin], evidence: inboundHash ? { inboundHash } : {} }
}

// A coin that reached a settled order's contract besides the one it settled (a bridge paying twice) goes back as BCH.
// Anyone may send it back after the refund time; the Router does it now, and the contract pays it only to the customer.
// shortcut: the give-back is not saved as an attempt, so the order page and the scanner do not list it; save it once
// such coins show up in practice.
async function returnLeftovers(gateway: Gateway, signer: WorkerWallet, order: Order) {
  const left: VerifiedOutput[] = []
  for (const coin of order.observedFunding ?? []) {
    if (BigInt(coin.value) < MIN_ORDER_COIN_SATS || order.funding.some(f => f.txid === coin.txid && f.vout === coin.vout)) continue
    const live = await gateway.coin(coin.txid, coin.vout)
    if (live && !live.output.token) left.push(coin)
  }
  if (!left.length) return
  try {
    await gateway.broadcast(signer.signRefund({ ...order, funding: left }))
  } catch (error) {
    console.warn(`Order ${order.id.slice(0, 8)} leftover give-back failed: ${reasonOf(error)}`)
  }
}

// A contract coin spent by a transaction the Router did not sign: the page's own settlement, or a refund anyone may
// send after the refund time. The node accepted it and the contract lets it pay only the customer, so it is the payout.
async function externalSettlement(store: OrderStore, gateway: Gateway, order: Order, history: Set<string>, attempts: Attempt[], clock: () => number) {
  const txs = new Map<string, { hex: string; tx: Transaction }>()
  for (const id of history) {
    if (!isTxid(id)) continue
    const hex = await gateway.raw(id)
    if (!hex) continue
    if (txidOf(hex) !== id) throw new Error('BCH transaction hash mismatch')
    txs.set(id, { hex, tx: decodeTx(hex) })
  }
  const coins = new Map<string, VerifiedOutput>()
  for (const [txid, { tx }] of txs)
    tx.outputs.forEach((output, vout) => {
      if (binToHex(output.lockingBytecode) === order.binding.lockingBytecode)
        coins.set(`${txid}:${vout}`, { txid, vout, value: output.valueSatoshis.toString(), confirmations: 0, unspent: false })
    })
  for (const [txid, { hex, tx }] of txs) {
    if (attempts.some(attempt => attempt.txid === txid)) continue
    const spent = tx.inputs.flatMap((input, index) => {
      const coin = coins.get(`${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)
      return coin ? [{ coin, paid: tx.outputs[index] }] : []
    })
    if (!spent.length) continue
    const swap = spent.every(({ paid }) => paid?.token && !paid.token.nft && binToHex(paid.token.category) === orderCategory(order))
    const pusdOut = swap ? spent.reduce((sum, { paid }) => sum + paid.token!.amount, 0n).toString() : '0'
    return store.recordSettlement(order, { txid, hex, kind: swap ? 'swap' : 'refund', pusdOut, status: 'accepted' }, spent.map(({ coin }) => coin), clock())
  }
  return false
}

// The order-address outputs of `tx` that the node still holds unspent, as the receipt checks read them.
async function orderUtxos(gateway: Gateway, order: Order, txid: string, tx: Transaction, tip: number) {
  const utxos = []
  for (let vout = 0; vout < tx.outputs.length; vout++) {
    const output = tx.outputs[vout]
    if (binToHex(output.lockingBytecode) !== order.binding.lockingBytecode) continue
    const coin = await gateway.coin(txid, vout)
    if (coin && binsAreEqual(coin.output.lockingBytecode, output.lockingBytecode))
      utxos.push({
        txid,
        vout,
        value: coin.output.valueSatoshis,
        hasToken: !!coin.output.token,
        height: coin.confirmations > 0 ? tip - coin.confirmations + 1 : 0
      })
  }
  return utxos
}

// The THORChain first leg: the order's inbound (from the browser's hint, else from OUT memos at the address), and
// its BCH outbounds as THORChain lists them, each checked on the BCH node.
async function thorchainFunding(store: OrderStore, gateway: Gateway, order: Order, history: Set<string>, clock: () => number): Promise<Funding | undefined> {
  // A known source settles only itself: another inbound to the same address stays in observed funding for recovery.
  const known = sourceTransactionId(order.inboundHash ?? order.sourceHash)
  const inboundIds = new Set<string>(known ? [known] : [])
  for (const id of known ? [] : history) {
    if (!isTxid(id)) continue
    const hex = await gateway.raw(id)
    if (!hex) continue
    if (txidOf(hex) !== id) throw new Error('BCH node returned another transaction')
    const tx = decodeTx(hex)
    if (!tx.outputs.some(output => binToHex(output.lockingBytecode) === order!.binding.lockingBytecode)) continue
    for (const output of tx.outputs) {
      // Source transaction IDs can use non-hex alphabets; preserve all existing source routes.
      const memo = opReturnText(output.lockingBytecode)
      const source = memo && sourceIdFromMemo(memo)
      if (source) inboundIds.add(source)
    }
  }
  const candidates: { id: string; status: TxStatusResponse }[] = []
  for (const id of inboundIds) {
    const status = await gateway.thorStatus(id)
    if (
      status?.tx?.id &&
      sameSourceTransaction(status.tx.id, id) &&
      inboundMatchesBinding(status, order.binding.lockingBytecode) &&
      (known || matchesSourceIntent(status, order.source))
    )
      candidates.push({ id, status })
  }
  if (candidates.length === 0) return
  if (candidates.length > 1) {
    store.update(order.id, order.version, { state: 'manual_review', error: 'Multiple THORChain inbounds paid a one-use order address.' }, clock())
    return
  }
  const { id: inboundHash, status } = candidates[0]
  const view = interpretTxStatus(status, order.binding.lockingBytecode)
  if (view.kind === 'invalid') {
    store.update(order.id, order.version, { state: 'manual_review', error: view.reason }, clock())
    return
  }
  if (view.kind === 'refunded') {
    store.update(order.id, order.version, { state: 'source_refunded', inboundHash, sourceRefunds: view.refunds.map(r => ({ ...r, evidence: 'thorchain' as const })) }, clock())
    return
  }
  if (view.kind !== 'outbound' || status.stages?.swap_finalised?.completed !== true || status.stages.swap_status?.pending === true) {
    store.update(order.id, order.version, { state: 'streaming', inboundHash }, clock())
    return
  }
  const outs = new Map<string, string>()
  for (const out of view.outbound) {
    if (!isTxid(out.txid) || !/^[1-9]\d*$/.test(out.amountSats) || (outs.has(out.txid) && outs.get(out.txid) !== out.amountSats))
      throw new Error('Invalid THORChain outbound list')
    outs.set(out.txid, out.amountSats)
  }
  if (outs.size < (status.planned_out_txs ?? []).filter(planned => !planned.refund).length) {
    store.update(order.id, order.version, { state: 'streaming', inboundHash }, clock())
    return
  }
  const tip = await gateway.tip(),
    received: VerifiedOutput[] = []
  for (const [outTxid, amount] of outs) {
    const hex = await gateway.raw(outTxid)
    if (!hex) return
    if (txidOf(hex) !== outTxid) throw new Error('BCH transaction hash mismatch')
    const tx = decodeTx(hex),
      utxos = await orderUtxos(gateway, order, outTxid, tx, tip)
    const receipt = checkOutbound(
      { hex, tx },
      { inboundHash, lockingBytecode: order.binding.lockingBytecode, expectedSats: BigInt(amount) },
      { tip, utxos }
    )
    if (receipt.kind !== 'ok') {
      store.update(order.id, order.version, { state: 'manual_review', error: 'BCH outbound failed order verification.' }, clock())
      return
    }
    received.push(...receipt.outputs)
  }
  return { received, evidence: { inboundHash, sourceRefunds: view.refunds.map(r => ({ ...r, evidence: 'thorchain' as const })) } }
}

// The NEAR Intents first leg. 1Click's status for the order's deposit address is only a pointer: its signed quote must
// pay native BCH to this order's own address, and each payout it names is read from the BCH node and checked there.
async function nearFunding(store: OrderStore, gateway: Gateway, order: Order, clock: () => number): Promise<Funding | undefined> {
  const status = await gateway.nearStatus?.(order.nearDepositAddress!)
  if (!status) return
  const review = (error: string) => void store.update(order.id, order.version, { state: 'manual_review', error }, clock())
  const { quoteRequest: request, quote } = status.quoteResponse ?? {}
  const minimum = quote?.minAmountOut ?? ''
  if (
    quote?.depositAddress !== order.nearDepositAddress ||
    request?.destinationAsset !== NEAR_BCH ||
    !request.recipient ||
    addressToLockingBytecode(request.recipient) !== order.binding.lockingBytecode ||
    !/^\d{1,16}$/.test(minimum)
  )
    return review('The NEAR Intents quote does not pay this order address.')
  const view = interpretNearStatus(status)
  if (view.kind === 'failed') return review(view.reason)
  if (view.kind === 'refunded') {
    const refunds = view.amount ? [{ asset: order.source?.asset ?? request.originAsset ?? '', amount: view.amount, pending: false, evidence: 'near_intents' as const }] : []
    store.update(order.id, order.version, { state: 'source_refunded', sourceRefunds: refunds }, clock())
    return
  }
  if (view.kind === 'pending') {
    if (status.status !== 'PENDING_DEPOSIT' && order.state !== 'streaming') store.update(order.id, order.version, { state: 'streaming' }, clock())
    return
  }
  const tip = await gateway.tip(),
    received: VerifiedOutput[] = []
  for (const txid of new Set(view.txids.map(normalizeTxid))) {
    if (!isTxid(txid)) return review('NEAR Intents reported a BCH payout that is not a transaction id.')
    const hex = await gateway.raw(txid)
    if (!hex) return
    if (txidOf(hex) !== txid) throw new Error('BCH transaction hash mismatch')
    const tx = decodeTx(hex)
    const receipt = checkPayment({ hex, tx }, order.binding.lockingBytecode, { tip, utxos: await orderUtxos(gateway, order, txid, tx, tip) })
    if (receipt.kind !== 'ok') return review('BCH payout failed order verification.')
    received.push(...receipt.outputs)
  }
  if (received.reduce((sum, coin) => sum + BigInt(coin.value), 0n) < BigInt(minimum))
    return review('NEAR Intents paid less BCH than its quote promised.')
  return { received, evidence: {} }
}

// Custody discovery never authorizes a spend. It also runs for terminal and quarantined orders.
export async function observeDeposit(store: OrderStore, gateway: Gateway, original: Order, knownHistory?: Set<string>, now = Date.now()) {
  const order = store.get(original.id)
  if (!order) return
  const history = knownHistory ?? new Set((await gateway.history(order.binding.lockingBytecode)).map(normalizeTxid))
  const ids = new Set([...history, ...(order.observedFunding ?? []).map(coin => coin.txid), ...order.funding.map(coin => coin.txid)])
  const observed = []
  for (const id of ids) {
    if (!isTxid(id)) continue
    const hex = await gateway.raw(id)
    if (!hex) throw new Error('Deposit history is incomplete; retaining custody accounting')
    if (txidOf(hex) !== id) throw new Error('BCH transaction hash mismatch')
    const tx = decodeTx(hex)
    for (let vout = 0; vout < tx.outputs.length; vout++) {
      const output = tx.outputs[vout]
      if (binToHex(output.lockingBytecode) !== order.binding.lockingBytecode) continue
      const coin = await gateway.coin(id, vout)
      if (!coin) continue
      if (!binsAreEqual(coin.output.lockingBytecode, output.lockingBytecode) || coin.output.valueSatoshis !== output.valueSatoshis)
        throw new Error('Deposit UTXO does not match the raw transaction')
      observed.push({ txid: id, vout, value: coin.output.valueSatoshis.toString(), confirmations: coin.confirmations, unspent: true })
    }
  }
  store.update(order.id, order.version, { observedFunding: observed }, now)
}

// --- Sale orders (back from BCH, contracts/router-sale.cash) ------------------------------------------------
// The customer sends the tokens to the order's contract. The Router sells them on Cauldron back into the contract and
// deposits that BCH, alone, to THORChain's vault with the order memo; both are signed and saved before either is sent.
// Anything else at the contract (a second coin, a THORChain refund, coins after the deadline) goes back to the customer.

export type SaleBuilder = (order: Order) => Promise<{ build: BuildResult; intent: BuildIntent }>

export const buildSaleTrade: SaleBuilder = async order => {
  const [coin] = order.funding as SaleCoin[]
  return buildTokenTrade({
    category: order.sale!.category,
    side: 'sell',
    funding: [{ txid: coin.txid, vout: coin.vout, value: coin.value, token: { category: coin.token!.category, amount: coin.token!.amount } }],
    lockingBytecode: order.binding.lockingBytecode,
    tokenAddress: order.binding.tokenAddress,
    cashAddress: order.binding.cashAddress,
    sell: BigInt(coin.token!.amount),
    minOutput: BigInt(order.minPusd),
    ownUnlockBytes: orderUnlockBytes(order)
  })
}

// The unspent coins at the contract, as the node reports them (a coin spent in its mempool is not listed).
async function contractCoins(gateway: Gateway, order: Order): Promise<SaleCoin[]> {
  const coins: SaleCoin[] = []
  for (const id of new Set((await gateway.history(order.binding.lockingBytecode)).map(normalizeTxid))) {
    if (!isTxid(id)) continue
    const hex = await gateway.raw(id)
    if (!hex) throw new Error('Deposit history is incomplete')
    if (txidOf(hex) !== id) throw new Error('BCH transaction hash mismatch')
    const tx = decodeTx(hex)
    for (let vout = 0; vout < tx.outputs.length; vout++) {
      if (binToHex(tx.outputs[vout].lockingBytecode) !== order.binding.lockingBytecode) continue
      const coin = await gateway.coin(id, vout)
      if (!coin) continue
      if (!binsAreEqual(coin.output.lockingBytecode, tx.outputs[vout].lockingBytecode) || coin.output.valueSatoshis !== tx.outputs[vout].valueSatoshis)
        throw new Error('Deposit UTXO does not match the raw transaction')
      const token = coin.output.token
      coins.push({
        txid: id,
        vout,
        value: coin.output.valueSatoshis.toString(),
        confirmations: coin.confirmations,
        unspent: true,
        ...(token && {
          token: {
            category: binToHex(token.category),
            amount: token.amount.toString(),
            ...(token.nft && { nft: { capability: token.nft.capability, commitment: binToHex(token.nft.commitment) } })
          }
        })
      })
    }
  }
  return coins
}

// The fee rate for the deposit while THORChain takes BCH at the order's vault and pays the asked chain, or while a
// routed sale's NEAR Intents address still waits for it with time to count it; else undefined.
// How long a sale's THORChain memo, quoted when the order opened, may still be deposited.
export const THORCHAIN_QUOTE_MS = 10 * 60_000

async function depositFeeRate(gateway: Gateway, order: Order, now: number) {
  if (order.sale!.route) {
    const status = await gateway.nearStatus?.(order.sale!.vaultAddress).catch(() => undefined)
    return saleRouteProblem(status, order.sale!, { refundScript: order.refundScript, minSats: BigInt(order.minPusd) }, now + SALE_ROUTE_DEPOSIT_MS) ? undefined : 1n
  }
  try {
    const inbounds = await gateway.inbound?.()
    return inbounds ? checkInbound(inbounds, order.sale!.vaultAddress, order.sale!.buyAsset.split('.')[0].toUpperCase()).feeRate : undefined
  } catch {
    return undefined
  }
}

export async function processSale(
  store: OrderStore,
  gateway: Gateway,
  signer: WorkerWallet,
  original: Order,
  policy: Policy,
  build: SaleBuilder = buildSaleTrade,
  clock: () => number = Date.now
) {
  store.assertWritable()
  let order = store.get(original.id)
  if (!order?.sale) return
  // A stranger's BCH dust at the contract is no coin of the order: it can neither be sold nor given back.
  const coins = (await contractCoins(gateway, order)).filter(coin => coin.token || BigInt(coin.value) >= MIN_ORDER_COIN_SATS)
  const set = (patch: Parameters<OrderStore['update']>[2]) => {
    store.update(order!.id, order!.version, patch, clock())
    order = store.get(order!.id)!
  }
  set({ observedFunding: coins })
  const attempts = store.attempts(order.id)
  const seen = new Map<string, { seen: boolean; confirmations: number }>()
  for (const attempt of attempts) {
    const observed = await gateway.observe(attempt.txid)
    if (!observed.seen) continue
    seen.set(attempt.txid, observed)
    if (attempt.status !== 'accepted') store.attemptStatus(attempt.txid, 'accepted')
  }
  const terminal = isTerminal(order.state)
  const progress = (patch: Parameters<OrderStore['update']>[2]) => !terminal && set(patch)

  // The coins back to the customer, resending the same give-back while it covers exactly these coins.
  const giveBack = async (error?: string) => {
    const attempt = signer.signGiveBack(order!, coins)
    const prior = attempts.find(previous => previous.txid === attempt.txid)
    if (!prior && !store.saveAttempt(order!, attempt, clock())) return
    order = store.get(order!.id)!
    const status = await send(store, gateway, prior ?? attempt)
    progress({ state: status === 'rejected' ? 'retrying' : 'submitted', error: error ?? 'Returning the coins to the customer.' })
  }

  const deposit = attempts.find(attempt => attempt.kind === 'deposit' && seen.has(attempt.txid))
  if (deposit) {
    // THORChain has the BCH; what comes back to the contract is its refund.
    set({ payoutTxid: deposit.txid, observation: { txid: deposit.txid, ...seen.get(deposit.txid)! } })
    if (order.sale.route) {
      // NEAR Intents refunds straight to the customer, so anything at the contract now is a stray coin.
      if (coins.length) return giveBack('Returning a coin sent to the contract after the deposit.')
      // shortcut: 1Click's status only decides when the order stops; the page proves the payout on the destination chain.
      const status = await gateway.nearStatus?.(order.sale.vaultAddress).catch(() => undefined)
      const view = status && interpretNearStatus(status)
      if (view?.kind === 'paid') progress({ state: 'completed', error: undefined })
      else if (view?.kind === 'refunded') progress({ state: 'refunded', error: undefined })
      else if (view?.kind === 'failed') progress({ state: 'manual_review', error: view.reason })
      else progress({ state: 'streaming', error: undefined })
      return
    }
    if (coins.length) return giveBack('THORChain returned the BCH; sending it back to the customer.')
    // shortcut: THORNode's status only decides when the order stops; the page proves the payout on the destination chain.
    const status = await gateway.thorStatus(deposit.txid).catch(() => undefined)
    const outs = status?.out_txs ?? []
    const settled = status?.stages?.swap_status?.pending !== true
    const memo = (prefix: string) => outs.some(out => out.memo?.toUpperCase().startsWith(prefix))
    // A refund paid to the contract is done once given back; one paid to the memo's refund address is done already.
    const refundedHere = outs.some(out => out.memo?.toUpperCase().startsWith('REFUND:') && !!out.to_address && addressToLockingBytecode(out.to_address) === order!.binding.lockingBytecode)
    const givenBack = attempts.some(a => a.kind === 'refund' && seen.has(a.txid))
    if (settled && memo('OUT:')) progress({ state: 'completed', error: undefined })
    else if (settled && memo('REFUND:') && !(status?.planned_out_txs ?? []).some(out => !out.refund) && (!refundedHere || givenBack))
      progress({ state: 'refunded', error: undefined })
    else progress({ state: 'streaming', error: undefined })
    return
  }

  const sale = [...attempts].reverse().find(attempt => attempt.kind === 'swap' && attempt.status !== 'rejected')
  const child = sale && attempts.find(attempt => attempt.kind === 'deposit' && attempt.parent === sale.txid)
  if (sale && seen.has(sale.txid)) {
    // Sold: deposit that BCH while THORChain still takes it at the order's vault, else give it back.
    const feeRate = terminal ? undefined : await depositFeeRate(gateway, order, clock())
    if (feeRate === undefined) return coins.length ? giveBack('The bridge is not taking the deposit; returning the BCH.') : undefined
    let next = child
    if (!next) {
      // Signed with the sale, unless the worker stopped between saving the two.
      next = signer.signDeposit(order, sale, feeRate)
      if (!store.saveAttempt(order, next, clock())) return
      order = store.get(order.id)!
    }
    await send(store, gateway, next)
    progress({ state: 'submitted', payoutTxid: next.txid, error: undefined })
    return
  }
  if (sale && !terminal) {
    if (await conflicted(gateway, order, sale)) {
      store.attemptStatus(sale.txid, 'rejected', true)
      if (child) store.attemptStatus(child.txid, 'rejected', true)
      progress({ state: 'retrying', error: 'A pool input was spent by another trade; rebuilding the sale.' })
      return
    }
    if ((await send(store, gateway, sale)) !== 'rejected' && child) await send(store, gateway, child)
    return
  }

  const returned = attempts.find(attempt => attempt.kind === 'refund' && seen.has(attempt.txid))
  if (!coins.length) {
    // Nothing left at the contract: given back by the Router or, after the refund time, by anyone.
    if (returned || order.funding.length) progress({ state: returned && seen.get(returned.txid)!.confirmations < 1 ? 'submitted' : 'refunded', error: undefined })
    return
  }
  if (terminal) return giveBack()

  const now = clock()
  if (!order.receivedAt) set({ receivedAt: now, deadline: now + Math.min(order.maxWaitMs, policy.maxWaitMs) })
  // The coin with the ordered tokens is sold; another coin (a stranger's BCH) goes back to the customer after the deposit.
  const terms = order.sale
  const coin = coins.find(c => c.token?.category === terms.category && !c.token.nft && BigInt(c.token.amount) >= BigInt(terms.tokenAmount))
  set({ funding: coin ? [coin] : coins })
  // THORChain: "Quotes should only be considered valid for 10 minutes" and "Do not send funds after the expiry".
  const quoted = !!terms.route || now < order.createdAt + THORCHAIN_QUOTE_MS
  const open = !!coin && quoted && now < order.deadline!
  const feeRate = open ? await depositFeeRate(gateway, order, now) : undefined
  if (feeRate === undefined)
    return giveBack(open ? 'The bridge is not taking BCH at this deposit address; returning the tokens.' : coin && !quoted ? 'The THORChain quote expired before the tokens arrived; returning them.' : undefined)
  try {
    const trade = await build(order)
    const { reviewBuild, sourcesOf } = await import('@/lib/cauldron')
    const reviewed = reviewBuild(trade.build, { ...trade.intent, lockingBytecode: order.binding.lockingBytecode, side: 'sell', minOutput: BigInt(order.minPusd) })
    await assertInputsLive(gateway, reviewed.unsignedHex, sourcesOf(reviewed))
    const sold = signer.signSale(order, trade.build)
    const deposited = signer.signDeposit(order, sold, feeRate)
    if (clock() >= order.deadline!) return giveBack()
    if (!store.saveAttempt(order, sold, now)) return
    order = store.get(order.id)!
    if (!store.saveAttempt(order, deposited, now)) return
    order = store.get(order.id)!
    if ((await send(store, gateway, sold)) === 'rejected') return progress({ state: 'retrying', error: 'The sale was rejected; rebuilding it.' })
    await send(store, gateway, deposited)
    progress({ state: 'submitted', payoutTxid: deposited.txid, error: undefined })
  } catch (error) {
    console.warn(`Order ${order.id.slice(0, 8)} sale attempt failed: ${reasonOf(error)}`)
    progress({ state: 'retrying', error: 'A sale meeting the original minimum is unavailable; retrying before the deadline, then the tokens go back.' })
  }
}
