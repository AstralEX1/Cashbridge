import { randomBytes, randomUUID } from 'node:crypto'
import { USwapNumber, getChainConfig } from '@tcswap/core'
import { EVMChains, ProviderName, type Chain } from '@tcswap/helpers'
import type { QuoteRequest, QuoteResponseRoute } from '@tcswap/helpers/api'
import { Interface, ZeroAddress, getAddress, isAddress } from 'ethers'
import { AppConfig, BridgeConfig } from '@/config'
import { getInboundAddresses, getMidgardPools, getQuotes, getTxStatus, type TxStatusResponse } from '@/lib/api'
import type { OrderIntent, OrderState, PublicOrder } from '@/lib/auto-bridge-contract'
import { checkOrder } from '@/lib/auto-bridge-order'
import { bchAddressProblem, bindingFromAddress } from '@/lib/bch'
import { formatBaseUnits, minOutputFor, secondLegSellAmount, toBaseUnits } from '@/lib/bridge'
import { quoteToken } from '@/lib/cauldron'
import { FEATURED_TOKENS, fetchCauldronTokens, readTokenSlug, searchCauldronTokens, type CauldronToken } from '@/lib/cauldron-tokens'
import { resolveQuoteError } from '@/lib/errors'
import { getNearQuote, getNearStatus, interpretNearStatus, isNearChain, nearExplorerUrl, nearSlippageBps, submitNearDeposit, type NearRoute, type NearQuoteRequest } from '@/lib/near-intents'
import { sourceTransactionId } from '@/lib/source-transaction'
import { DEPOSIT_FEE_RESERVE, checkDepositMemo, checkInbound, type InboundAddress } from '@/lib/thorchain-deposit'
import { callWorker } from '@/server/auto-bridge/proxy'

// The tools the Cash Bridge MCP endpoint offers to AI agents. None of them holds a key or signs: quotes are read-only,
// and prepare_bridge hands back the unsigned transaction or deposit instructions for the user's own wallet to sign.

// What a failing tool tells the agent; it reads the message and can correct its call.
export class ToolError extends Error {}

export interface ToolContext {
  ip: string
  // Charges `cost` against the caller's write quota; false once it is spent.
  allowWrite: () => boolean
}

type Args = Record<string, unknown>
type Tool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean | string>
  run: (args: Args, context: ToolContext) => Promise<unknown>
}

const QUOTE_TIMEOUT_MS = 20_000
const BCH_SIDE_HINT = 'One side must be BCH.BCH or a Cauldron token (PUSD, MUSD, a ticker from list_supported_assets, or a 64-hex category id); the other a THORChain asset such as BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913.'

const text = (args: Args, key: string, required = true) => {
  const value = args[key]
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError(`"${key}" is required`)
    return undefined
  }
  if (typeof value !== 'string' || value.length > 256) throw new ToolError(`"${key}" must be a string`)
  return value.trim()
}

const decimalAmount = (args: Args) => {
  const amount = text(args, 'amount')!
  if (!/^\d+(?:\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) throw new ToolError('"amount" must be a positive decimal string such as "25" or "0.015"')
  return amount
}

// The aggregator's own slippage, in percent, as the page sends it (1% by default).
const slippage = (args: Args) => {
  const value = args.slippage_percent ?? 1
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0.1 || parsed > 5) throw new ToolError('"slippage_percent" must be between 0.1 and 5')
  return parsed
}

// --- Assets ---------------------------------------------------------------------------------------

type BchSide = { token?: CauldronToken }

// BCH.BCH, a pinned ticker or a category id; undefined for anything else (an asset on the other side).
const bchSide = async (asset: string): Promise<BchSide | undefined> => {
  const slug = readTokenSlug(asset)
  if (!slug) return undefined
  if ('token' in slug) return { token: slug.token ?? undefined }
  const token = (await searchCauldronTokens(slug.category)).find(t => t.category === slug.category)
  if (!token) throw new ToolError(`Cauldron lists no liquid token with category ${slug.category}`)
  return { token }
}

const tokenInfo = (token: CauldronToken) => ({ asset: token.ticker, category: token.category, name: token.name, decimals: token.decimals })

const pair = async (args: Args) => {
  const from = text(args, 'from_asset')!
  const to = text(args, 'to_asset')!
  const [fromBch, toBch] = await Promise.all([bchSide(from), bchSide(to)])
  if (!!fromBch === !!toBch) throw new ToolError(BCH_SIDE_HINT)
  if (!fromBch && !/^[A-Z0-9]+\.[A-Z0-9]/i.test(from)) throw new ToolError(`"${from}" is not a THORChain asset. ${BCH_SIDE_HINT}`)
  if (!toBch && !/^[A-Z0-9]+\.[A-Z0-9]/i.test(to)) throw new ToolError(`"${to}" is not a THORChain asset. ${BCH_SIDE_HINT}`)
  return toBch ? { reverse: false as const, external: from, side: toBch } : { reverse: true as const, external: to, side: fromBch! }
}

// --- THORChain leg --------------------------------------------------------------------------------

const thorchainRoute = async (request: Omit<QuoteRequest, 'providers'>) => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), QUOTE_TIMEOUT_MS)
  try {
    const routes = await getQuotes({ ...request, providers: AppConfig.providers }, abort)
    // As on the page: the streaming swap when THORChain offers it, the plain one otherwise.
    const route = routes.find(r => r.providers[0] === ProviderName.THORCHAIN_STREAMING) ?? routes.find(r => r.providers[0] === ProviderName.THORCHAIN)
    if (!route) throw new ToolError('THORChain has no route for this pair and amount right now')
    return route
  } catch (error) {
    if (error instanceof ToolError) throw error
    throw new ToolError(resolveQuoteError(error).message)
  } finally {
    clearTimeout(timer)
  }
}

const legOf = (route: QuoteResponseRoute) => ({
  provider: 'THORChain',
  sell: `${route.sellAmount} ${route.sellAsset}`,
  buy: `${route.expectedBuyAmount} ${route.buyAsset}`,
  fees: route.fees.map(f => ({ type: f.type, amount: f.amount, asset: f.asset })),
  estimated_seconds: route.estimatedTime?.total,
  warnings: route.warnings?.map(w => w.display)
})

const tokenQuote = async (category: string, side: 'buy' | 'sell', amount: bigint) => {
  try {
    return await quoteToken({ category, side, amount })
  } catch (error) {
    throw new ToolError(`Cauldron: ${error instanceof Error ? error.message : 'no quote'}`)
  }
}

// --- NEAR Intents leg (plain BCH, either direction) ------------------------------------------------

const nearAvailable = (asset: string) => BridgeConfig.nearIntents && isNearChain(asset.split('.')[0])

const nearQuote = async (request: NearQuoteRequest & { sourceAddress?: string }) => {
  try {
    return await getNearQuote(request, AbortSignal.timeout(QUOTE_TIMEOUT_MS))
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : 'NEAR Intents gave no quote')
  }
}

const unit = (asset: string) => (asset === BridgeConfig.buyAsset ? 'BCH' : asset)

const nearLeg = (route: NearRoute) => ({
  provider: 'NEAR Intents',
  sell: `${route.sellAmount} ${unit(route.sellAsset)}`,
  buy: `${route.expectedBuyAmount} ${unit(route.buyAsset)}`,
  minimum: `${route.expectedBuyAmountMaxSlippage} ${unit(route.buyAsset)}`,
  estimated_seconds: route.estimatedTime?.total
})

// --- list_supported_assets -----------------------------------------------------------------------

const listSupportedAssets = async (args: Args) => {
  const search = text(args, 'search', false)?.toLowerCase()
  const [pools, tokens] = await Promise.all([
    getMidgardPools().catch(() => undefined),
    (search ? searchCauldronTokens(search) : fetchCauldronTokens()).catch(() => (search ? [] : [...FEATURED_TOKENS]))
  ])
  const external = (pools ?? [])
    .filter(p => ((p as { status?: string }).status ?? 'available').toLowerCase() === 'available' && !p.asset.toUpperCase().startsWith('BCH.'))
    .filter(p => !search || p.asset.toLowerCase().includes(search))
    .map(p => ({ asset: p.asset, price_usd: Number(p.assetPriceUSD).toPrecision(6) }))
  return {
    bch_side: [
      ...(!search || 'bch bitcoin cash'.includes(search) ? [{ asset: BridgeConfig.buyAsset, name: 'Bitcoin Cash', decimals: 8, route: 'THORChain to or from your BCH address' }] : []),
      ...tokens.map(t => ({ ...tokenInfo(t), route: 'Cauldron, through the Cashbridge Router' }))
    ],
    other_side: external,
    other_side_error: pools ? undefined : 'THORChain pool list is unavailable right now',
    directions: {
      to_bch: 'Any other_side asset to BCH.BCH or to a bch_side token.',
      from_bch: 'BCH.BCH to any other_side asset. Selling a token back is only in the web app for now.',
      near_intents: 'Between BCH.BCH and assets on ARB, AVAX, BASE, BSC, BTC, DOGE, ETH, LTC, OP, POL, SOL, TRON and ZEC, both ways, NEAR Intents is quoted too; name them the same way (CHAIN.SYMBOL-CONTRACT).'
    }
  }
}

// --- get_bridge_quote ----------------------------------------------------------------------------

const getBridgeQuote = async (args: Args) => {
  const amount = decimalAmount(args)
  const { reverse, external, side } = await pair(args)
  const percent = slippage(args)
  const token = side.token
  if (!token) {
    // Plain BCH, either way: THORChain and NEAR Intents side by side, as the page shows them; either one quoting is enough.
    const [sellAsset, buyAsset] = reverse ? [BridgeConfig.buyAsset, external] : [external, BridgeConfig.buyAsset]
    const [thor, near] = await Promise.allSettled([
      thorchainRoute({ sellAsset, buyAsset, sellAmount: amount, slippage: percent }),
      nearAvailable(external) ? nearQuote({ sellAsset, buyAsset, sellAmount: amount, dry: true, slippageBps: nearSlippageBps(percent) }) : Promise.resolve(undefined)
    ])
    const routes = [
      ...(thor.status === 'fulfilled' ? [{ route: 'thorchain', expected_output: thor.value.expectedBuyAmount, estimated_seconds: thor.value.estimatedTime?.total, legs: [legOf(thor.value)] }] : []),
      ...(near.status === 'fulfilled' && near.value
        ? [{ route: 'near_intents', expected_output: near.value.expectedBuyAmount, minimum_output: near.value.expectedBuyAmountMaxSlippage, estimated_seconds: near.value.estimatedTime?.total, legs: [nearLeg(near.value)] }]
        : [])
    ]
    if (!routes.length) throw thor.status === 'rejected' ? thor.reason : new ToolError('No route for this pair and amount right now')
    const best = routes.reduce((a, b) => (Number(b.expected_output) > Number(a.expected_output) ? b : a))
    return {
      from: { asset: sellAsset, amount },
      to: reverse ? { asset: external } : { asset: BridgeConfig.buyAsset, decimals: 8 },
      best: best.route,
      expected_output: best.expected_output,
      routes,
      unavailable: [
        ...(thor.status === 'rejected' ? [{ route: 'thorchain', reason: thor.reason instanceof Error ? thor.reason.message : 'no quote' }] : []),
        ...(near.status === 'rejected' ? [{ route: 'near_intents', reason: near.reason instanceof Error ? near.reason.message : 'no quote' }] : [])
      ],
      cash_bridge_fee: '0',
      next_step: 'Show the routes to the user. If they agree, call prepare_bridge with the same assets and amount, the sending address as source_address (their BCH address when BCH is sold), the receiving address as destination_address, and route set to the one they chose (best by default).'
    }
  }
  if (!reverse) {
    const route = await thorchainRoute({ sellAsset: external, buyAsset: BridgeConfig.buyAsset, sellAmount: amount, slippage: percent })
    const legs: unknown[] = [legOf(route)]
    // A CashToken: THORChain, then the Cashbridge Router buys the token on Cauldron (the page's automatic mode).
    const token = side.token!
    const sale = await tokenQuote(token.category, 'buy', secondLegSellAmount(toBaseUnits(route.expectedBuyAmount, 8)))
    const output = formatBaseUnits(sale.output, token.decimals)
    legs.push({ provider: 'Cauldron, through the Cashbridge Router', sell: `${formatBaseUnits(sale.sell, 8)} BCH`, buy: `${output} ${token.ticker}`, pool_fee_sats: sale.tradeFeeSats.toString() })
    return {
      from: { asset: external, amount },
      to: tokenInfo(token),
      route: 'THORChain, then Cauldron through the Cashbridge Router',
      expected_output: output,
      // The Router fixes its own minimum from a fresh pool quote when the order is created (prepare_bridge).
      minimum_output_estimate: formatBaseUnits(minOutputFor(sale.output), token.decimals),
      estimated_seconds: route.estimatedTime?.total,
      legs,
      cash_bridge_fee: '0',
      next_step: 'Show this to the user. If they agree, call prepare_bridge with the same assets and amount plus their source and destination addresses.'
    }
  }
  // A token back from BCH: first sold for BCH on Cauldron, then the BCH goes through THORChain.
  const sale = await tokenQuote(token.category, 'sell', toBaseUnits(amount, token.decimals))
  if (sale.output <= DEPOSIT_FEE_RESERVE) throw new ToolError('This amount sells for too little BCH to bridge')
  const route = await thorchainRoute({ sellAsset: BridgeConfig.buyAsset, buyAsset: external, sellAmount: formatBaseUnits(sale.output - DEPOSIT_FEE_RESERVE, 8), slippage: percent })
  return {
    from: { ...tokenInfo(token), amount },
    to: { asset: external },
    route: 'Cauldron, then THORChain',
    expected_output: route.expectedBuyAmount,
    estimated_seconds: route.estimatedTime?.total,
    legs: [{ provider: 'Cauldron', sell: `${formatBaseUnits(sale.sell, token.decimals)} ${token.ticker}`, buy: `${formatBaseUnits(sale.output, 8)} BCH`, pool_fee_sats: sale.tradeFeeSats.toString() }, legOf(route)],
    cash_bridge_fee: '0',
    next_step: `Selling ${token.ticker} back is not prepared through this endpoint yet; send the user to ${AppConfig.baseUrl}.`
  }
}

// --- prepare_bridge --------------------------------------------------------------------------------

const DEPOSIT_ABI = new Interface(['function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration)'])
const APPROVE_ABI = new Interface(['function approve(address spender, uint256 amount)'])

const inboundList = async () => {
  const inbounds = (await getInboundAddresses().catch(() => undefined)) as InboundAddress[] | undefined
  if (!inbounds?.length) throw new ToolError('THORChain did not list its inbound addresses; try again shortly')
  return inbounds
}

// The source chain's vault a forward deposit pays, open for trading.
const freshInbound = (inbounds: InboundAddress[], chain: string, vault: string) => {
  const inbound = inbounds.find(i => i.chain === chain)
  if (!inbound) throw new ToolError(`THORChain has no ${chain} inbound address right now`)
  if (inbound.halted || inbound.chain_trading_paused || inbound.global_trading_paused) throw new ToolError(`THORChain has paused ${chain} trading`)
  if (inbound.address.toLowerCase() !== vault.toLowerCase()) throw new ToolError(`The quoted vault is not THORChain's current ${chain} vault; ask for a new quote`)
  return inbound
}

// The aggregator's unsigned EVM transaction, checked against THORChain itself before it is handed out: it calls the
// chain's THORChain router, pays the current vault, carries the quoted memo and moves the quoted asset.
const evmTransactions = (route: QuoteResponseRoute, chain: string, inbound: InboundAddress) => {
  const tx = route.tx as { to?: string; from?: string; data?: string; value?: string } | undefined
  if (!tx || typeof tx !== 'object' || typeof tx.data !== 'string' || !tx.to) throw new ToolError('THORChain gave no transaction for this quote; ask for a new one')
  const call = (() => {
    try {
      return DEPOSIT_ABI.parseTransaction({ data: tx.data, value: tx.value ?? '0' })
    } catch {
      return null
    }
  })()
  const token = route.sellAsset.split('-')[1]?.toLowerCase()
  const asset = token && isAddress(token) ? getAddress(token) : ZeroAddress
  if (
    !call ||
    !inbound.router ||
    tx.to.toLowerCase() !== inbound.router.toLowerCase() ||
    String(call.args.vault).toLowerCase() !== inbound.address.toLowerCase() ||
    call.args.memo !== route.memo ||
    getAddress(String(call.args.asset)) !== asset
  )
    throw new ToolError('The prepared transaction does not match its quote, so it is not handed out; ask for a new quote')
  const chainId = Number(getChainConfig(chain as Chain).chainId)
  const deposit = { step: 'deposit', to: tx.to, from: tx.from, data: tx.data, value: tx.value ?? '0', chain_id: chainId }
  if (asset === ZeroAddress) return [deposit]
  return [
    {
      step: 'approve',
      description: `Let the THORChain router take ${route.sellAmount} of the token. Skip it when the allowance already covers this amount.`,
      to: asset,
      from: tx.from,
      data: APPROVE_ABI.encodeFunctionData('approve', [inbound.router, call.args.amount]),
      value: '0',
      chain_id: chainId
    },
    deposit
  ]
}

const HOW_TO_SEND: Record<string, string> = {
  UTXO: 'Send exactly the amount to inbound_address in one transaction that also has an OP_RETURN output carrying the memo. Send from source_address: THORChain refunds to the first input.',
  COSMOS: 'Send exactly the amount to inbound_address with the memo in the transaction memo field.',
  OTHER: 'Send exactly the amount to inbound_address with the memo, the way THORChain documents deposits for this chain.'
}

// Forward routes reach here with their memo already checked to pay the BCH destination (getQuotes keeps only those).
const depositOf = async (route: QuoteResponseRoute, destination: string, reverse: boolean) => {
  const chain = route.sellAsset.split('.')[0].toUpperCase()
  if (!route.memo || !route.inboundAddress) throw new ToolError('THORChain gave no deposit address for this quote; ask for a new one')
  const inbounds = await inboundList()
  let inbound: InboundAddress
  if (reverse) {
    try {
      checkDepositMemo(route.memo, { buyAsset: route.buyAsset, destination })
      checkInbound(inbounds, route.inboundAddress, route.buyAsset.split('.')[0].toUpperCase())
    } catch (error) {
      throw new ToolError(`${error instanceof Error ? error.message : 'The deposit does not match its quote'}; ask for a new quote`)
    }
    inbound = inbounds.find(i => i.chain === 'BCH')!
  } else inbound = freshInbound(inbounds, chain, route.inboundAddress)
  const evm = (EVMChains as readonly string[]).includes(chain)
  const kind = evm ? 'EVM' : ['BTC', 'LTC', 'DOGE', 'BCH', 'DASH', 'ZEC'].includes(chain) ? 'UTXO' : chain === 'GAIA' ? 'COSMOS' : 'OTHER'
  return {
    deposit: {
      chain,
      asset: route.sellAsset,
      amount: route.sellAmount,
      inbound_address: route.inboundAddress,
      memo: route.memo,
      ...(inbound.router && { router: inbound.router }),
      expires_at: /^\d{9,11}$/.test(route.expiration ?? '') ? new Date(Number(route.expiration) * 1000).toISOString() : route.expiration,
      how_to_send: evm ? 'Sign and send the transactions below in order from source_address.' : HOW_TO_SEND[kind]
    },
    ...(evm && { transactions: evmTransactions(route, chain, inbound) })
  }
}

const SAFETY = 'Show the user the amounts, the destination and the deposit before they sign. Never ask for a seed phrase or private key. Do not reuse this deposit after expires_at: prepare a new one.'

const plainBchAddress = (address: string, field = 'destination_address') => {
  if (bchAddressProblem(address, false)) throw new ToolError(`"${field}" must be a mainnet Bitcoin Cash address (bitcoincash:q… or z…)`)
  return bindingFromAddress(address)!.cashAddress
}

const routerCall = async (method: 'GET' | 'POST', path: string, capability: string, ip: string, body?: unknown) => {
  let response: { status: number; body: Buffer } | undefined
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${capability}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
    if (ip) headers['cf-connecting-ip'] = ip
    response = await callWorker(method, path, headers, body === undefined ? undefined : Buffer.from(JSON.stringify(body)))
  } catch {
    response = undefined
  }
  const result = (() => {
    try {
      return JSON.parse(response?.body.toString('utf8') ?? '')
    } catch {
      return undefined
    }
  })()
  if (!response || response.status >= 500) throw new ToolError(typeof result?.error === 'string' && response ? `Cashbridge Router: ${result.error}` : 'Cashbridge Router is unavailable right now; bridge to BCH.BCH instead, or try again later')
  if (response.status >= 400) throw new ToolError(`Cashbridge Router: ${typeof result?.error === 'string' ? result.error : `request failed (${response.status})`}`)
  return result as PublicOrder | undefined
}

const verified = (order: PublicOrder | undefined, id: string, intent?: OrderIntent) => {
  try {
    return checkOrder(order, id, intent)
  } catch (error) {
    throw new ToolError(`Cashbridge Router: ${error instanceof Error ? error.message : 'invalid order'}; nothing was sent, do not pay this order`)
  }
}

const prepareBridge = async (args: Args, context: ToolContext) => {
  const amount = decimalAmount(args)
  const { reverse, external, side } = await pair(args)
  const percent = slippage(args)
  const source = text(args, 'source_address')!
  const destination = text(args, 'destination_address')!
  const via = text(args, 'route', false) ?? 'thorchain'
  if (!['thorchain', 'near_intents'].includes(via)) throw new ToolError('"route" must be thorchain or near_intents')
  if (reverse) {
    if (side.token) throw new ToolError(`Selling ${side.token.ticker} back is not prepared through this endpoint yet; send the user to ${AppConfig.baseUrl}`)
    const from = plainBchAddress(source, 'source_address')
    if (via === 'near_intents') return prepareNear(BridgeConfig.buyAsset, external, amount, from, destination, percent)
    const route = await thorchainRoute({
      sellAsset: BridgeConfig.buyAsset,
      buyAsset: external,
      sellAmount: amount,
      slippage: percent,
      dry: false,
      sourceAddress: from,
      destinationAddress: destination,
      refundAddress: from
    })
    return { route: 'THORChain', ...(await depositOf(route, destination, true)), expected_output: `${route.expectedBuyAmount} ${route.buyAsset}`, destination_address: destination, refund_address: from, track: 'After sending, call get_bridge_status with source_tx set to the transaction id.', safety: SAFETY }
  }

  const sourceChain = external.split('.')[0].toUpperCase()
  if ((EVMChains as readonly string[]).includes(sourceChain) && !isAddress(source)) throw new ToolError(`"source_address" must be the ${sourceChain} address that sends the funds`)
  const executable = (to: string) =>
    thorchainRoute({ sellAsset: external, buyAsset: BridgeConfig.buyAsset, sellAmount: amount, slippage: percent, dry: false, sourceAddress: source, destinationAddress: to, refundAddress: source })

  if (via === 'near_intents') {
    if (side.token) throw new ToolError('NEAR Intents pays plain BCH only; use route thorchain for a CashToken')
    return prepareNear(external, BridgeConfig.buyAsset, amount, source, plainBchAddress(destination), percent)
  }

  if (!side.token) {
    const to = plainBchAddress(destination)
    const route = await executable(to)
    return { route: 'THORChain', ...(await depositOf(route, to, false)), expected_output: `${route.expectedBuyAmount} BCH`, destination_address: to, refund_address: source, track: 'After sending, call get_bridge_status with source_tx set to the transaction hash.', safety: SAFETY }
  }

  // A token goes through the Cashbridge Router: THORChain pays the BCH to the order's contract, which can only buy at
  // least the order's minimum of the token for the recipient or send the BCH back to them.
  const token = side.token
  const problem = bchAddressProblem(destination, true)
  if (problem) throw new ToolError(problem === 'notTokenAware' ? '"destination_address" must be a token-aware BCH address (bitcoincash:z…) to receive CashTokens' : '"destination_address" must be a mainnet Bitcoin Cash address')
  if (!context.allowWrite()) throw new ToolError('Too many orders from this client; wait a few minutes')
  const expected = await thorchainRoute({ sellAsset: external, buyAsset: BridgeConfig.buyAsset, sellAmount: amount, slippage: percent })
  const intent: OrderIntent = {
    recipientAddress: destination,
    refundAddress: destination,
    source: { chain: sourceChain, asset: external, amount, address: source },
    expectedBchSats: toBaseUnits(expected.expectedBuyAmount, 8).toString()
  }
  if (token.category !== BridgeConfig.pusd.category) intent.category = token.category
  const id = randomUUID()
  const capability = randomBytes(32).toString('hex')
  const order = verified(await routerCall('POST', '/orders', capability, context.ip, { id, ...intent }), id, intent)
  if (order.apiVersion !== 2 || order.recoveryRequired) throw new ToolError('Cashbridge Router is being updated; try again later')
  const route = await executable(order.depositAddress)
  if (!new USwapNumber(route.sellAmount).eqValue(amount)) throw new ToolError('THORChain quoted a different amount; ask for a new quote')
  return {
    route: 'THORChain, then Cauldron through the Cashbridge Router',
    ...(await depositOf(route, order.depositAddress, false)),
    order: {
      id: order.id,
      // The order's only key: whoever has it can read the order. Keep it with the transfer; it is not shown again.
      token: capability,
      deposit_address: order.depositAddress,
      contract: !!order.contract,
      recipient: order.recipientAddress,
      refund_address: order.refundAddress,
      minimum_output: `${formatBaseUnits(order.minPusd, token.decimals)} ${token.ticker}`,
      max_wait_seconds: order.maxWaitSeconds
    },
    expected_bch: `${route.expectedBuyAmount} BCH`,
    track: 'After sending, call report_source_transaction with the order id, token and transaction hash, then poll get_bridge_status.',
    safety: `${SAFETY} If the Router cannot buy at least minimum_output in time, it sends the BCH to refund_address.`
  }
}

const TRANSFER_ABI = new Interface(['function transfer(address to, uint256 amount)'])

// NEAR Intents, to or from plain BCH: a one-use deposit address on the source chain, paid by a plain transfer (no
// memo, no approval). 1Click pays plain BCH addresses only and refunds to the sending address.
const prepareNear = async (sellAsset: string, buyAsset: string, amount: string, source: string, to: string, percent: number) => {
  const external = sellAsset === BridgeConfig.buyAsset ? buyAsset : sellAsset
  if (!nearAvailable(external)) throw new ToolError(`NEAR Intents does not carry ${external.split('.')[0]} here; use route thorchain`)
  const route = await nearQuote({ sellAsset, buyAsset, sellAmount: amount, sourceAddress: source, recipient: to, refundTo: source, dry: false, slippageBps: nearSlippageBps(percent) })
  if (!route?.near.quote.depositAddress) throw new ToolError(`NEAR Intents does not list ${external}; use route thorchain`)
  const deposit = route.near.quote.depositAddress
  const chain = sellAsset.split('.')[0].toUpperCase()
  // Out of BCH, as the page checks: the deposit is a BCH address and the quote is for exactly the amount asked.
  if (chain === 'BCH' && (bchAddressProblem(deposit, false) || !new USwapNumber(route.sellAmount).eqValue(amount)))
    throw new ToolError('NEAR Intents quoted a deposit that does not match this transfer; nothing was sent, ask for a new quote')
  const units = BigInt(route.near.quote.amountIn)
  const token = sellAsset.split('-')[1]?.toLowerCase()
  const evm = (EVMChains as readonly string[]).includes(chain)
  const chainId = evm ? Number(getChainConfig(chain as Chain).chainId) : undefined
  return {
    route: 'NEAR Intents',
    deposit: {
      chain,
      asset: sellAsset,
      amount: route.sellAmount,
      amount_base_units: units.toString(),
      deposit_address: deposit,
      expires_at: route.near.quote.deadline,
      how_to_send: 'Send exactly the amount to deposit_address in a plain transfer from source_address: no memo, no OP_RETURN and no approval. The address is for this one transfer only.'
    },
    ...(evm && {
      transactions: [
        token && isAddress(token)
          ? { step: 'transfer', to: getAddress(token), from: source, data: TRANSFER_ABI.encodeFunctionData('transfer', [deposit, units]), value: '0', chain_id: chainId }
          : { step: 'transfer', to: deposit, from: source, data: '0x', value: units.toString(), chain_id: chainId }
      ]
    }),
    expected_output: `${route.expectedBuyAmount} ${unit(buyAsset)}`,
    minimum_output: `${route.expectedBuyAmountMaxSlippage} ${unit(buyAsset)}`,
    destination_address: to,
    refund_address: source,
    // 1Click asks integrators to keep these: the signature settles any dispute about the deposit address.
    near_quote: { correlation_id: route.near.correlationId, signature: route.near.signature, quoted_at: route.near.timestamp },
    explorer: nearExplorerUrl(deposit),
    track: 'After sending, call report_source_transaction with near_deposit_address and the transaction hash, then poll get_bridge_status with near_deposit_address.',
    safety: SAFETY
  }
}

// --- Status ----------------------------------------------------------------------------------------

const ORDER_STATES: Record<OrderState, string> = {
  awaiting_deposit: 'Waiting for THORChain to pay the BCH to the order address.',
  streaming: 'THORChain is still streaming the swap.',
  awaiting_confirmations: 'The BCH arrived; waiting for the confirmations the order needs.',
  ready: 'The BCH arrived; the Router is buying the token.',
  retrying: 'The Router is retrying the token purchase.',
  broadcasting: 'The Router is sending the payout.',
  submitted: 'The payout is in the BCH mempool.',
  completed: 'Done: the token was paid to the recipient.',
  refunded: 'The BCH was sent back to the refund address.',
  source_refunded: 'THORChain refunded the source transaction.',
  manual_review: 'Held for the operator to review. Do not send again.'
}

const orderCredentials = (args: Args) => {
  const id = text(args, 'order_id')!
  const capability = text(args, 'order_token')!
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ToolError('"order_id" is not an order id')
  if (!/^[a-f0-9]{64}$/.test(capability)) throw new ToolError('"order_token" is not an order token')
  return { id, capability }
}

const orderSummary = (order: PublicOrder) => ({
  order_id: order.id,
  state: order.state,
  meaning: ORDER_STATES[order.state] ?? order.state,
  deposit_address: order.depositAddress,
  recipient: order.recipientAddress,
  refund_address: order.refundAddress,
  received_sats: order.receivedSats,
  source_tx: order.sourceHash,
  thorchain_inbound: order.inboundHash,
  payout_txid: order.payoutTxid ?? order.settlement?.txid,
  settlement: order.settlement,
  source_refunds: order.sourceRefunds,
  deadline: order.deadline ? new Date(order.deadline).toISOString() : undefined,
  error: order.error
})

const sourceStatus = (hash: string, status: TxStatusResponse) => {
  const outs = (status.out_txs ?? []).map(o => ({ chain: o.chain, to: o.to_address, txid: o.id, coins: o.coins, refund: !!o.memo?.toUpperCase().startsWith('REFUND') }))
  const stages = status.stages ?? {}
  const planned = status.planned_out_txs ?? []
  const done = outs.length > 0 && outs.length >= planned.length && !stages.swap_status?.pending
  return {
    source_tx: hash,
    state: !stages.inbound_observed?.completed ? 'not_seen' : done ? (outs.every(o => o.refund) ? 'refunded' : 'completed') : 'pending',
    memo: status.tx?.memo,
    stages,
    outbound: outs,
    planned_outbound: planned,
    note: 'THORChain reports this state; check the payout transaction on its own chain before treating the transfer as done.'
  }
}

const getBridgeStatus = async (args: Args, context: ToolContext) => {
  if (args.order_id !== undefined) {
    const { id, capability } = orderCredentials(args)
    return orderSummary(verified(await routerCall('GET', `/orders/${id}`, capability, context.ip), id))
  }
  const near = text(args, 'near_deposit_address', false)
  if (near) {
    const status = await getNearStatus(near).catch(() => undefined)
    if (!status) throw new ToolError('NEAR Intents did not answer for this deposit address; try again shortly')
    return { near_deposit_address: near, status: status.status, ...interpretNearStatus(status), explorer: nearExplorerUrl(near), note: 'NEAR Intents reports this state; check the payout on the destination chain before treating the transfer as done.' }
  }
  const hash = sourceTransactionId(text(args, 'source_tx')!)
  if (!hash) throw new ToolError('"source_tx" is not a transaction hash')
  const status = await getTxStatus(hash).catch(() => undefined)
  if (!status) throw new ToolError('THORChain did not answer; try again shortly')
  return sourceStatus(hash, status)
}

const reportSourceTransaction = async (args: Args, context: ToolContext) => {
  const near = text(args, 'near_deposit_address', false)
  const raw = text(args, 'source_tx')!
  if (near) {
    if (!context.allowWrite()) throw new ToolError('Too many updates from this client; wait a few minutes')
    await submitNearDeposit(near, raw)
    return { near_deposit_address: near, source_tx: raw, reported: true }
  }
  const { id, capability } = orderCredentials(args)
  const hash = sourceTransactionId(raw)
  if (!hash) throw new ToolError('"source_tx" is not a transaction hash')
  if (!context.allowWrite()) throw new ToolError('Too many order updates from this client; wait a few minutes')
  return orderSummary(verified(await routerCall('POST', `/orders/${id}`, capability, context.ip, { sourceHash: hash }), id))
}

// --- Definitions -----------------------------------------------------------------------------------

const assetProps = {
  from_asset: { type: 'string', description: 'What the user sells: a THORChain asset (BASE.USDC-0X8335…, ETH.ETH, BTC.BTC) or, back from BCH, BCH.BCH.' },
  to_asset: { type: 'string', description: 'What the user receives: BCH.BCH, a Cauldron token (PUSD, MUSD or a category id), or, back from BCH, a THORChain asset.' },
  amount: { type: 'string', description: 'Amount of from_asset as a decimal string, e.g. "25" or "0.015".' },
  slippage_percent: { type: 'number', description: 'THORChain slippage tolerance in percent (0.1 to 5, default 1).' }
}

export const TOOLS: Tool[] = [
  {
    name: 'list_supported_assets',
    title: 'List supported assets',
    description: 'Lists what Cash Bridge can bridge: the BCH side (BCH.BCH and Cauldron CashTokens such as PUSD) and the assets on other chains that THORChain swaps to and from BCH.',
    inputSchema: { type: 'object', properties: { search: { type: 'string', description: 'Optional filter, e.g. "usdc", "base" or "pusd".' } } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    run: listSupportedAssets
  },
  {
    name: 'get_bridge_quote',
    title: 'Quote a bridge transfer',
    description: 'Quotes a transfer between another chain and Bitcoin Cash, either way (THORChain and NEAR Intents compared), or to a CashToken (THORChain, then Cauldron through the Cashbridge Router). Selling a CashToken back is priced too. Indicative only; nothing is reserved.',
    inputSchema: { type: 'object', properties: assetProps, required: ['from_asset', 'to_asset', 'amount'] },
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
    run: getBridgeQuote
  },
  {
    name: 'prepare_bridge',
    title: 'Prepare a bridge deposit',
    description:
      "Prepares a transfer for the user's own wallet to sign: an unsigned EVM transaction (with the token approval when needed) or deposit instructions (THORChain vault, amount and memo, or a NEAR Intents deposit address). For a CashToken it opens a Cashbridge Router order and returns its id and token. Never signs or sends anything.",
    inputSchema: {
      type: 'object',
      properties: {
        ...assetProps,
        source_address: { type: 'string', description: 'The address that sends the funds (a BCH address when BCH is sold); refunds go to it.' },
        destination_address: { type: 'string', description: 'Where the user receives: a BCH address (token-aware bitcoincash:z… for CashTokens), or the payout address back from BCH.' },
        route: { type: 'string', enum: ['thorchain', 'near_intents'], description: 'Plain BCH only, either way: which route to use, as get_bridge_quote compared them (default thorchain).' }
      },
      required: ['from_asset', 'to_asset', 'amount', 'source_address', 'destination_address']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: prepareBridge
  },
  {
    name: 'report_source_transaction',
    title: 'Report the source transaction',
    description: 'Tells the Cashbridge Router (order_id and order_token) or NEAR Intents (near_deposit_address) which transaction paid the deposit, so it is matched sooner.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'The order id from prepare_bridge.' },
        order_token: { type: 'string', description: 'The order token from prepare_bridge.' },
        near_deposit_address: { type: 'string', description: 'The NEAR Intents deposit address from prepare_bridge.' },
        source_tx: { type: 'string', description: 'The hash of the transaction the user sent.' }
      },
      required: ['source_tx']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: reportSourceTransaction
  },
  {
    name: 'get_bridge_status',
    title: 'Check a transfer',
    description: 'Shows where a transfer is: a Cashbridge Router order (order_id and order_token), a NEAR Intents deposit (near_deposit_address) or a THORChain swap by its source transaction hash.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Cashbridge Router order id, with order_token.' },
        order_token: { type: 'string', description: 'The order token from prepare_bridge.' },
        near_deposit_address: { type: 'string', description: 'The NEAR Intents deposit address from prepare_bridge.' },
        source_tx: { type: 'string', description: 'Source transaction hash, for a transfer without a Router order.' }
      }
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    run: getBridgeStatus
  }
]
