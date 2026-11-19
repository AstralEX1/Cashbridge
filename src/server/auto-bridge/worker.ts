import { binToHex, binsAreEqual, hexToBin, type Output } from '@bitauth/libauth'
import type { TxStatusResponse } from '@/lib/api'
import { checkOutbound, decodeTx, isTxid, normalizeTxid, opReturnText, txidOf } from '@/lib/bch'
import { inboundMatchesBinding, interpretTxStatus } from '@/lib/bridge'
import { BroadcastRejected, buildTokenTrade, type BuildIntent, type BuildResult } from '@/lib/cauldron'
import { OrderStore } from '@/server/auto-bridge/store'
import { isTerminal, orderCategory, type Attempt, type Order } from '@/server/auto-bridge/types'
import { orderUnlockBytes, WorkerWallet } from '@/server/auto-bridge/wallet'
import { sourceIdFromMemo, sourceTransactionId, sameSourceTransaction } from '@/lib/source-transaction'

export interface Gateway {
  history(script: string): Promise<string[]>
  raw(txid: string): Promise<string | undefined>
  tip(): Promise<number>
  coin(txid: string, vout: number): Promise<{ output: Output; confirmations: number } | undefined>
  thorStatus(inbound: string): Promise<TxStatusResponse | undefined>
  observe(txid: string): Promise<{ seen: boolean; confirmations: number }>
  broadcast(attempt: Attempt): Promise<void>
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
    minOutput: BigInt(order.minPusd),
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

// The recorded reason of a failure, for the log: these are our own fixed messages, never a URL or credential.
export const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'unknown error').replace(/\s+/g, ' ').slice(0, 160)

// Definite refusals of a resent attempt, each in its own pass, before it counts as rejected.
export const FINAL_REFUSALS = 3

async function submit(store: OrderStore, gateway: Gateway, order: Order, attempt: Attempt, clock: () => number) {
  // Durable before the first network write: a crash here must leave acceptance unknown.
  const firstSend = store.beginBroadcast(attempt.txid)
  try {
    await gateway.broadcast(attempt)
    store.attemptStatus(attempt.txid, 'accepted')
    const current = store.get(order.id)!
    if (isTerminal(current.state)) return
    store.update(order.id, current.version, { state: 'submitted', payoutTxid: attempt.txid, error: undefined }, clock())
  } catch (error) {
    // After a lost first answer one refusal proves nothing (a node may have taken it meanwhile), but
    // every RPC refusing the same bytes several times running means no node holds them: the attempt
    // ends and the order goes on to a rebuild or the BCH fallback, still spending the same funding.
    const refused = error instanceof BroadcastRejected
    const rejected = refused && (firstSend || store.noteRefusal(attempt.txid) >= FINAL_REFUSALS)
    store.attemptStatus(attempt.txid, rejected ? 'rejected' : 'unknown')
    const current = store.get(order.id)!
    if (isTerminal(current.state)) return
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

  const history = new Set((await gateway.history(order.binding.lockingBytecode)).map(normalizeTxid))
  await observeDeposit(store, gateway, order, history, clock())
  order = store.get(order.id)!
  if (store.isDepositScript(order.recipientScript) || store.isDepositScript(order.refundScript)) {
    store.update(order.id, order.version, { state: 'manual_review', error: 'A customer destination is a service deposit address; operator verification is required.' }, clock())
    return
  }
  const inboundIds = new Set<string>([order.inboundHash, order.sourceHash].map(sourceTransactionId).filter((value): value is string => !!value))
  for (const id of history) {
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
    if (status?.tx?.id && sameSourceTransaction(status.tx.id, id) && inboundMatchesBinding(status, order.binding.lockingBytecode))
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
    received = []
  for (const [outTxid, amount] of outs) {
    const hex = await gateway.raw(outTxid)
    if (!hex) return
    if (txidOf(hex) !== outTxid) throw new Error('BCH transaction hash mismatch')
    const tx = decodeTx(hex),
      utxos = []
    for (let vout = 0; vout < tx.outputs.length; vout++) {
      const output = tx.outputs[vout]
      if (binToHex(output.lockingBytecode) !== order.binding.lockingBytecode) continue
      const coin = await gateway.coin(outTxid, vout)
      if (coin && binsAreEqual(coin.output.lockingBytecode, output.lockingBytecode))
        utxos.push({
          txid: outTxid,
          vout,
          value: coin.output.valueSatoshis,
          hasToken: !!coin.output.token,
          height: coin.confirmations > 0 ? tip - coin.confirmations + 1 : 0
        })
    }
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
        inboundHash,
        sourceRefunds: view.refunds.map(r => ({ ...r, evidence: 'thorchain' as const })),
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
        minOutput: BigInt(order.minPusd)
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
