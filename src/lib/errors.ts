export const translateError = (message: string): string => {
  if (
    message.includes('failed to simulate swap') &&
    message.includes('fail to add outbound tx') &&
    message.includes('not enough asset to pay for fees')
  ) {
    return 'Insufficient asset returned to pay for outbound fee'
  }

  if (message.includes('prepare outbound tx not successful') && message.includes('not enough asset to pay for fees'))
    return 'Insufficient withdrawal to pay for outbound fee'

  if (message.includes('failed to simulate swap: failed to simulate handler') && message.includes('insufficient funds')) return 'Invalid swap'

  if (message.includes('spendable balance') && message.includes('is smaller than') && message.includes('insufficient funds')) {
    return 'Insufficient funds'
  }

  // The aggregator could not fund the deposit from the wallet's UTXOs (amount + network fee).
  if (message.includes('toolbox_utxo_insufficient_balance')) return 'Insufficient balance to cover the network fee'

  // The UTXO data providers (Blockchair, then Esplora for BTC/LTC) could not be reached.
  if (message.includes('toolbox_utxo_api_error')) return 'Could not load wallet UTXOs. Try again shortly'

  if (message.includes('swap Source and Target cannot be the same')) return 'Source and Target cannot be the same'

  if (message.includes('user rejected action')) return 'Transaction Cancelled'

  // Rabby refuses a transaction whose `from` is not the account currently selected in the wallet.
  if (message.includes('from should be same as current address')) {
    return 'The wallet has a different account selected. Switch back to the connected address or reconnect the wallet'
  }

  if (message.includes('insufficient funds') || message.includes('missing revert data')) return 'Insufficient Funds'

  if (message.includes(`Invalid \\\"to\\\" address.`)) return `Invalid \"to\" address`

  if (message.includes('account sequence mismatch')) return 'Pending Transaction. Try again shortly'

  if (message.includes('outbound amount does not meet requirements')) {
    return 'Insufficient return amount'
  }

  if (message.includes('failed to simulate swap: emit asset')) {
    return 'Slippage tolerance exceeded'
  }
  if (message.includes('amount cannot be zero')) return 'Amount cannot be zero'
  if (message.includes('Invalid Tick Size')) return 'Invalid Price'
  if (message.includes('Swap contract not found')) return 'Missing Configuration in Entry Adapter'
  if (/Insufficient ?Return expected/.test(message)) {
    return 'Insufficient on-chain liquidity for one of the underlying assets. Try increasing the slippage tolerance.'
  }

  const evmErr = message.match(/execution reverted: "([^"]+)"/)
  if (evmErr) return evmErr[0]

  return message
}

// Wallet errors reach us as a wall of serialised RPC payload - ethers inlines the whole request in
// the message - so only a message short enough to read is shown, and the rest falls back to generic
// copy. translateError runs first because it turns the known ones (a rejected signature, insufficient
// funds) into exactly that kind of short message. The cap sits above the longest sentence
// translateError produces and far below a serialised payload, so it separates the two cleanly.
const MAX_READABLE_LENGTH = 160

export const readableError = (error: unknown, fallback: string): string => {
  const message = translateError((error as { message?: string })?.message || '')

  if (message.length > 0 && message.length <= MAX_READABLE_LENGTH) return message

  // The generic copy alone hides which step failed, so it carries the short error code when there is
  // one: the SDK's error key (`toolbox_evm_...`) or the wallet/ethers code (`NETWORK_ERROR`, 4001).
  const code = errorCode(error)
  return code ? `${fallback} (${code})` : fallback
}

const errorCode = (error: unknown): string | undefined => {
  const e = error as { name?: string; message?: string; code?: unknown }
  const sdkKey = e?.name === 'USwapError' ? e.message?.match(/^[a-z0-9_]+/)?.[0] : undefined
  const code = sdkKey ?? (typeof e?.code === 'string' || typeof e?.code === 'number' ? String(e.code) : undefined)
  return code && code.length <= 64 ? code : undefined
}

// A halted chain reports it in prose, e.g. "failed to simulate swap: trading is halted, can't
// process swap", so the wording is all the aggregator gives us to go on.
export const isTradingHaltedError = (message: string): boolean => message.includes('trading is halted')

// THORChain reaches the aggregator wrapped in a JSON envelope, e.g.
// {"code":2,"message":"amount less than dust threshold","details":[]}, so unwrap it before the
// message is matched on or shown - the envelope is noise to both.
const unwrapProviderError = (message: string): string => {
  if (!message.startsWith('{')) return message

  try {
    const parsed = JSON.parse(message)
    return typeof parsed?.message === 'string' ? parsed.message : message
  } catch {
    return message
  }
}

// A provider that does not list one of the assets answers "Token with identifier BASE.ETH not found".
const isAssetMissingError = (message: string): boolean => message.includes('not found')

// The aggregator answers a failed quote with one error per provider, and only one of them explains
// why the swap the user asked for cannot be routed:
//   - a provider that never listed the asset says "not found" and explains nothing, so it goes last;
//   - a halt explains the failure only when every other provider is in that "not found" group. A
//     provider that did list the asset and failed for another reason (dust, slippage, liquidity)
//     wins over it, otherwise Maya being halted surfaces as "trading is halted" on a swap that
//     THORChain declined for an entirely different - and fixable - reason.
const errorRank = (message: string): number => (isAssetMissingError(message) ? 2 : isTradingHaltedError(message) ? 1 : 0)

// The user declined in the wallet: EIP-1193 4001, ethers' ACTION_REJECTED, or the wallets' own wording.
// Nothing was signed, so nothing can have been sent.
export const isUserRejection = (error: unknown): boolean => {
  for (let e: any = error, depth = 0; e && depth < 5; e = e.cause ?? e.error ?? e.info?.error, depth++) {
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true
    const message = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (/user rejected|user denied|rejected by user|user cancel+ed|request rejected/.test(message)) return true
  }
  return false
}

// An amount under THORChain's minimum swap is an expected answer, not a failure: it carries the
// minimum (in asset units) and, unlike USwapError, is not logged to the console.
export class BelowMinimumError extends Error {
  constructor(readonly minimum: string) {
    super(`amount less than min swap amount (${minimum})`)
    this.name = 'BelowMinimumError'
  }
}

// THORChain's "amount less than min swap amount (recommended_min_amount_in: 36045)", in 1e8 units.
export const minimumFromProviderErrors = (errorData: unknown): string | undefined => {
  const providerErrors: { message?: string; error?: string }[] = (errorData as any)?.providerErrors ?? []
  for (const e of providerErrors) {
    const message = e.message || e.error || ''
    if (!message.includes('min swap amount')) continue
    const match = message.match(/recommended_min_amount_in:\s*(\d+)/)
    if (match) return (Number(match[1]) / 1e8).toFixed(8).replace(/\.?0+$/, '')
  }
}

export const resolveQuoteError = (error: unknown): Error => {
  const cause = (error as any)?.cause
  const providerErrors: { message?: string; error?: string }[] | undefined = cause?.errorData?.providerErrors

  if (providerErrors?.length) {
    const messages = providerErrors.map(e => unwrapProviderError(e.message || e.error || ''))
    return new Error(messages.reduce((best, message) => (errorRank(message) < errorRank(best) ? message : best)))
  }

  if (cause?.errorData?.error) return new Error(cause.errorData.error)

  return error as Error
}
