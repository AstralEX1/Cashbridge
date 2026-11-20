import { EVMChains, USwapNumber, type EVMChain } from '@tcswap/core'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { ProviderName } from '@tcswap/helpers'
import { getNetworkQuotes, getTxStatus, isNetworkRoute, type TxStatusResponse } from '@/lib/api'
import { BridgeBlocked, FirstLegRejected, withLock } from '@/lib/bridge-first-leg'
import { isUserRejection } from '@/lib/errors'
import { generateId } from '@/lib/utils'
import { toBaseUnits } from '@/lib/bridge'
import { sameAddress } from '@/lib/payout-chains'
import { sameSourceTransaction, sourceTransactionId } from '@/lib/source-transaction'
import { getNearQuote, getNearStatus, isNearRoute, nearSlippageBps, submitNearDeposit } from '@/lib/near-intents'
import { getShapeShiftQuote, getShapeShiftStatus, isShapeShiftRoute, SHAPESHIFT_PROVIDER } from '@/lib/shapeshift'
import { type SwapTransaction, transactionStore } from '@/store/transaction-store'

// Save before opening the wallet: a lost answer or closed tab must never look like an unsent swap.
export const startNetworkSwap = async ({ base, route, execute }: {
  base: Omit<SwapTransaction, 'uid' | 'status' | 'bridge' | 'hash'>
  route: QuoteResponseRoute
  execute: () => Promise<string>
}) => {
  const sameSource = (address?: string) => !!address && !!base.addressFrom &&
    (EVMChains.includes(base.assetFrom.chain as EVMChain) ? address.toLowerCase() === base.addressFrom.toLowerCase() : address === base.addressFrom)
  // A ShapeShift or NEAR Intents route is a plain deposit to the address it quoted, for the pair and destination asked for.
  const shapeshift = isShapeShiftRoute(route) ? route.shapeshift : undefined
  const near = isNearRoute(route) ? route.near : undefined
  const depositAddress = shapeshift?.depositAddress ?? near?.quote.depositAddress
  const matches = shapeshift || near
    ? (!shapeshift || !!shapeshift.quoteId) && !!depositAddress && route.inboundAddress === depositAddress &&
      route.sellAsset === base.assetFrom.identifier && route.buyAsset === base.assetTo.identifier &&
      !!base.addressTo && !!route.destinationAddress && sameAddress(route.destinationAddress, base.addressTo)
    : isNetworkRoute(route, { sellAsset: base.assetFrom.identifier, buyAsset: base.assetTo.identifier, buyAssetShortCode: base.assetTo.shortCode, sellAmount: base.amountFrom, destinationAddress: base.addressTo })
  if (!matches ||
    !new USwapNumber(route.sellAmount).eq(base.amountFrom) ||
    (route.sourceAddress && !sameSource(route.sourceAddress)) ||
    (route.expiration && Number(route.expiration) * 1000 <= Date.now())) {
    throw new Error('The prepared swap no longer matches this transfer. Request a fresh quote.')
  }
  const result = await withLock('cashbridge-network-swap', async () => {
    await transactionStore.persist.rehydrate()
    const unresolved = transactionStore.getState().transactions.some(tx => tx.kind !== 'send' && !tx.bridge &&
      tx.status === 'unknown' && !tx.hash && !tx.qrCodeData && tx.assetFrom.chain === base.assetFrom.chain && sameSource(tx.addressFrom))
    if (unresolved) throw new BridgeBlocked('An earlier wallet request has an unknown outcome. Resolve it in transaction history before sending again.')
    const uid = generateId()
    const { setTransaction, removeTransaction } = transactionStore.getState()
    const minOutput = toBaseUnits(route.expectedBuyAmountMaxSlippage ?? route.expectedBuyAmount, base.assetTo.decimals).toString()
    if (BigInt(minOutput) <= 0n) throw new Error('The quote has no positive minimum payout')
    setTransaction({
      ...base,
      uid,
      status: 'unknown',
      networkSwap: {
        minOutput,
        memo: route.memo,
        ...(shapeshift && { shapeshift: { quoteId: shapeshift.quoteId!, depositAddress: shapeshift.depositAddress! } }),
        ...(near && { near: { depositAddress: depositAddress! } })
      }
    })
    let hash: string
    try {
      hash = await execute()
      if (!hash) throw new Error('The wallet returned no transaction hash. Check its activity before sending again.')
    } catch (error) {
      if (isUserRejection(error)) {
        removeTransaction(uid)
        throw new FirstLegRejected('Transaction cancelled in wallet', { cause: error })
      }
      throw error
    }
    try {
      transactionStore.setState(state => ({ transactions: state.transactions.map(tx => tx.uid === uid ? { ...tx, hash, status: 'pending' } : tx) }))
    } catch {
      // Broadcast succeeded: an exhausted browser store must not invite another send.
      console.error('Failed to persist the submitted swap in history')
    }
    return hash
  })
  if (result === undefined) throw new BridgeBlocked('Another tab is submitting a swap')
  if (near) void submitNearDeposit(depositAddress!, result)
  return result
}

// The executable free-pair quote from the route the form chose: THORChain through the aggregator, or a deposit address
// from NEAR Intents' 1Click or ShapeShift (refunds go to the source wallet).
export const getNetworkRoutes = async (
  provider: string,
  json: Parameters<typeof getNetworkQuotes>[0] & { sellDecimals: number; buyDecimals: number; percentSlippage?: number },
  abortController?: AbortController
): Promise<QuoteResponseRoute[]> => {
  const { sellAsset, buyAsset, sellAmount, sourceAddress, destinationAddress, refundAddress } = json
  if (provider === ProviderName.NEAR) {
    const route = await getNearQuote({
      sellAsset,
      buyAsset: buyAsset!,
      sellAmount,
      sourceAddress,
      recipient: destinationAddress,
      refundTo: refundAddress ?? sourceAddress,
      dry: false,
      slippageBps: nearSlippageBps(json.percentSlippage)
    })
    return route ? [route] : []
  }
  if (provider === SHAPESHIFT_PROVIDER) {
    if (!sourceAddress || !destinationAddress) return []
    const route = await getShapeShiftQuote(
      { sellAsset, buyAsset: buyAsset!, sellAmount, sellDecimals: json.sellDecimals, buyDecimals: json.buyDecimals, slippage: json.percentSlippage, sourceAddress, destinationAddress },
      abortController?.signal
    )
    return route ? [route] : []
  }
  return getNetworkQuotes(json, abortController)
}

export const networkIntentMatches = (tx: SwapTransaction, deposit: TxStatusResponse['tx']) => {
  try {
    return !!tx.addressFrom && !!tx.networkSwap?.memo && deposit?.chain === tx.assetFrom.chain &&
      !!deposit.from_address && sameAddress(deposit.from_address, tx.addressFrom) && deposit.memo === tx.networkSwap.memo &&
      deposit.coins?.length === 1 && deposit.coins[0].asset.toUpperCase() === tx.assetFrom.identifier.toUpperCase() &&
      BigInt(deposit.coins[0].amount) === toBaseUnits(tx.amountFrom, 8)
  } catch { return false }
}

export const resumeNetworkSwap = async (tx: SwapTransaction, hash: string) => {
  if (!sourceTransactionId(hash)) throw new Error('Enter the source transaction hash from your wallet')
  const nearAddress = tx.networkSwap?.near?.depositAddress
  if (nearAddress) {
    // 1Click lists the deposits it has seen at the address: the hash entered must be one of them.
    const seen = await getNearStatus(nearAddress)
    if (!(seen.swapDetails?.originChainTxHashes ?? []).some(t => sameSourceTransaction(t.hash, hash)))
      throw new Error('NEAR Intents has not seen this transaction for the saved transfer. Check the hash and retry later.')
    transactionStore.setState(state => ({ transactions: state.transactions.map(current => current.uid === tx.uid && current.status === 'unknown' && !current.hash ? { ...current, hash: hash.trim(), status: 'pending' } : current) }))
    return
  }
  const quoteId = tx.networkSwap?.shapeshift?.quoteId
  if (quoteId) {
    // ShapeShift fills in the deposit's hash once it sees it: it must be the one entered.
    const seen = await getShapeShiftStatus(quoteId)
    if (!sameSourceTransaction(seen.txHash, hash)) throw new Error('ShapeShift has not seen this transaction for the saved transfer. Check the hash and retry later.')
    transactionStore.setState(state => ({ transactions: state.transactions.map(current => current.uid === tx.uid && current.status === 'unknown' && !current.hash ? { ...current, hash: hash.trim(), status: 'pending' } : current) }))
    return
  }
  const status = await getTxStatus(hash)
  if (!sameSourceTransaction(status.tx?.id, hash) || !networkIntentMatches(tx, status.tx)) {
    throw new Error('This transaction has not been observed matching the saved transfer. Check the hash and retry later.')
  }
  transactionStore.setState(state => ({ transactions: state.transactions.map(current => current.uid === tx.uid && current.status === 'unknown' && !current.hash ? { ...current, hash: hash.trim(), status: 'pending' } : current) }))
}
