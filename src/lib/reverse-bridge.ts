import { Chain, EVMChain, getChainConfig, UTXOChain } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { getProvider } from '@tcswap/toolboxes/evm'
import type { Asset } from '@/components/swap/asset'
import { BridgeConfig } from '@/config'
import { getInboundAddresses, getQuotes, getTxStatus, isBridgeRoute, type TxStatusResponse } from '@/lib/api'
import { type BchBinding, listWalletCoins, type ScriptUtxo } from '@/lib/bch'
import { formatBaseUnits, minOutputFor } from '@/lib/bridge'
import { withLock } from '@/lib/bridge-first-leg'
import { prepareTokenTrade } from '@/lib/cauldron'
import type { CauldronToken } from '@/lib/cauldron-tokens'
import { buildDeposit, type BuiltDeposit, checkDepositMemo, checkInbound, DepositError, type InboundAddress, matchPayout, TRANSFER_OUT_TOPIC } from '@/lib/thorchain-deposit'
import { cosmosPayout, type ChainPayout, solanaPayout, thorchainPayout, tronPayout, utxoPayout, xrpPayout } from '@/lib/payout-check'
import { isEvmChain } from '@/lib/payout-chains'
import { BLOCKCHAIR_CHAINS } from '@/lib/blockchair'
import { postJson, rpcBase, XRPL_RPC_URL } from '@/lib/transfer-status'
import { generateId } from '@/lib/utils'
import { blockchairProxyUrl, getUSwap } from '@/lib/wallets'
import { type BridgeOperation, getActiveBridge, type SwapTransaction, transactionStore } from '@/store/transaction-store'

// The reverse bridge: (token -> BCH on Cauldron, step 1) then a BCH deposit to THORChain paying an
// THORChain asset's address (step 2). Both transactions are built here, checked, signed in the bound BCH wallet
// without broadcasting, checked again, saved, and only then broadcast by this app.

export class ReverseBlocked extends Error {}

export const bchAsset = (): Asset => ({
  chain: Chain.BitcoinCash,
  chainId: getChainConfig(Chain.BitcoinCash).chainId,
  decimals: 8,
  identifier: BridgeConfig.buyAsset,
  ticker: 'BCH',
  name: 'Bitcoin Cash',
  logoURI: '/networks/bch.svg',
  providers: []
})

// A Cauldron token as the history's asset record (identified by its category, never its ticker).
export const tokenAsset = (token: CauldronToken): Asset => ({
  ...bchAsset(),
  decimals: token.decimals,
  identifier: `BCH.${token.ticker}-${token.category}`,
  ticker: token.ticker,
  name: token.name,
  logoURI: token.icon
})

export const destinationChainOf = (buyAsset: string) => buyAsset.split('.')[0].toUpperCase()

export { signInWallet, type Signable } from '@/lib/bch-signing'

// --- Step 1: the Cauldron sale -------------------------------------------------------------------

// Largest first, until `need` is covered.
const pick = <T,>(coins: T[], amountOf: (c: T) => bigint, need: bigint) => {
  const chosen: T[] = []
  let total = 0n
  for (const coin of [...coins].sort((a, b) => (amountOf(b) > amountOf(a) ? 1 : amountOf(b) < amountOf(a) ? -1 : 0))) {
    if (total >= need) break
    chosen.push(coin)
    total += amountOf(coin)
  }
  return total >= need ? chosen : undefined
}

// A fresh, reviewed sale of `sellUnits` of `token` from the bound address, ready to sign.
export const prepareSale = async (token: CauldronToken, sellUnits: bigint, binding: BchBinding, slippageBps = BridgeConfig.pusdSlippageBps) => {
  const { utxos } = await listWalletCoins(binding.lockingBytecode)
  const tokenCoins = utxos.filter(u => u.token?.category === token.category && !u.token.nft)
  const coins = pick(tokenCoins, u => u.token!.amount, sellUnits)
  if (!coins) throw new DepositError(`The BCH wallet holds less ${token.ticker} than this amount at the connected address`)
  return prepareTokenTrade(
    {
      category: token.category,
      side: 'sell',
      funding: coins.map(u => ({ txid: u.txid, vout: u.vout, value: u.value.toString(), token: { category: token.category, amount: u.token!.amount.toString() } })),
      lockingBytecode: binding.lockingBytecode,
      tokenAddress: binding.tokenAddress,
      cashAddress: binding.cashAddress
    },
    sellUnits,
    output => minOutputFor(output, slippageBps)
  )
}

// --- Step 2: the THORChain deposit ---------------------------------------------------------------

export interface PreparedDeposit {
  built: BuiltDeposit
  route: QuoteResponseRoute
  router?: string
}

const pickRoute = (routes: QuoteResponseRoute[]) =>
  routes.find(r => r.providers[0] === ProviderName.THORCHAIN_STREAMING) ?? routes.find(r => r.providers[0] === ProviderName.THORCHAIN)

// A fresh THORChain quote for the BCH being deposited, its memo and vault checked against the asked
// asset and address and THORNode's own inbound addresses, and the deposit transaction built on it.
// `payAll` deposits every satoshi of `funding` but the fee (a sale's proceeds); otherwise exactly
// `amountSats` with change back to the wallet.
export const prepareDeposit = async ({
  funding,
  payAll,
  amountSats,
  binding,
  buyAsset,
  shortCode,
  destination,
  slippage
}: {
  funding: { txid: string; vout: number; value: string }[]
  payAll: boolean
  amountSats?: bigint
  binding: BchBinding
  buyAsset: string
  // The asset's THORChain short code, which a memo may use in its place.
  shortCode?: string
  destination: string
  slippage: number
}): Promise<PreparedDeposit> => {
  const inbounds = (await getInboundAddresses()) as unknown as InboundAddress[]
  const chain = destinationChainOf(buyAsset)
  const bchVault = inbounds.find(i => i.chain === 'BCH')?.address
  if (!bchVault) throw new DepositError('THORChain has no BCH vault right now')
  const { feeRate } = checkInbound(inbounds, bchVault, chain)
  // Sized with the longest memo THORChain reads: the real memo can only make the fee smaller.
  const sizing = buildDeposit({ funding, lockingBytecode: binding.lockingBytecode, vaultScript: binding.lockingBytecode, memo: 'x'.repeat(80), payAll, amountSats, feeRate })
  const amount = sizing.amountSats

  const routes = await getQuotes({
    sellAsset: BridgeConfig.buyAsset,
    buyAsset,
    sellAmount: formatBaseUnits(amount, 8),
    slippage,
    providers: [ProviderName.THORCHAIN],
    sourceAddress: binding.cashAddress,
    destinationAddress: destination,
    refundAddress: binding.cashAddress
  })
  const route = pickRoute(routes)
  if (!route || !route.memo || !route.inboundAddress) throw new DepositError('THORChain has no route for this amount right now')
  if (!isBridgeRoute(route, { sellAsset: BridgeConfig.buyAsset, buyAsset, destinationAddress: destination })) throw new DepositError('The quote is not for this bridge')
  checkDepositMemo(route.memo, { buyAsset, destination, shortCode })
  const { vaultScript, router } = checkInbound(inbounds, route.inboundAddress, chain)
  const built = buildDeposit({ funding, lockingBytecode: binding.lockingBytecode, vaultScript, memo: route.memo, amountSats: amount, feeRate })
  return { built, route, router }
}

// Token-free BCH of the bound address covering `amountSats` and the deposit's fee.
export const pickBchFunding = (utxos: ScriptUtxo[], amountSats: bigint) => {
  const coins = pick(
    utxos.filter(u => !u.hasToken),
    u => u.value,
    amountSats + 2_000n
  )
  if (!coins) throw new DepositError('The BCH wallet holds less BCH than this amount and its fee at the connected address')
  return coins.map(u => ({ txid: u.txid, vout: u.vout, value: u.value.toString() }))
}

// A plain BCH deposit of `amountSats` from the bound address, quoted and built, ready to sign.
export const prepareBchDeposit = async (args: { amountSats: bigint; binding: BchBinding; buyAsset: string; shortCode?: string; destination: string; slippage: number }) => {
  const { utxos } = await listWalletCoins(args.binding.lockingBytecode)
  return prepareDeposit({ ...args, funding: pickBchFunding(utxos, args.amountSats), payAll: false })
}

// Where the payout search starts on an EVM chain; other chains are looked up by THORNode's outbound hash.
export const blockHeight = async (chain: string) => (isEvmChain(chain) ? (await getProvider(chain as EVMChain)).getBlockNumber() : undefined)

// --- Recording -----------------------------------------------------------------------------------

// Records a reverse operation before anything is signed. One operation at a time per browser.
export const startReverseOperation = async (
  record: Omit<SwapTransaction, 'uid' | 'status' | 'bridge' | 'hash'>,
  bridge: Omit<BridgeOperation, 'id' | 'updatedAt' | 'direction' | 'firstLeg'>
) => {
  const uid = await withLock('bch-bridge-first-leg', async () => {
    await transactionStore.persist.rehydrate()
    if (getActiveBridge()) throw new ReverseBlocked('Finish or close the current bridge operation first')
    const id = generateId()
    transactionStore.getState().setTransaction({
      ...record,
      uid: id,
      status: 'not_started',
      bridge: { ...bridge, id, direction: 'reverse', firstLeg: { result: 'pending' }, updatedAt: Date.now() }
    })
    return id
  })
  if (uid === undefined) throw new ReverseBlocked('Another tab is starting a bridge operation')
  return uid
}

// --- Payout --------------------------------------------------------------------------------------

const PAYOUT_SCAN_CHUNK = 1_000
const PAYOUT_SCAN_CHUNKS_PER_POLL = 10

// Looks for the router's TransferOut paying the destination for the deposit, from the deposit's
// start block onwards; reports how far it has looked so the next poll resumes there.
export const findPayout = async (op: BridgeOperation) => {
  const reverse = op.reverse
  const deposit = reverse?.deposit
  if (!reverse || !deposit?.txid || !deposit.router) return undefined
  const provider = await getProvider(destinationChainOf(reverse.buyAsset) as EVMChain)
  const head = await provider.getBlockNumber()
  let from = deposit.scannedBlock ?? deposit.startBlock ?? Math.max(0, head - PAYOUT_SCAN_CHUNK)
  const recipient = `0x${'0'.repeat(24)}${reverse.destination.toLowerCase().replace(/^0x/, '')}`
  for (let i = 0; i < PAYOUT_SCAN_CHUNKS_PER_POLL && from <= head; i++) {
    const to = Math.min(head, from + PAYOUT_SCAN_CHUNK - 1)
    const logs = await provider.getLogs({ address: deposit.router, topics: [TRANSFER_OUT_TOPIC, null, recipient], fromBlock: from, toBlock: to })
    const match = matchPayout(
      logs.map(l => ({ topics: [...l.topics], data: l.data, transactionHash: l.transactionHash, blockNumber: l.blockNumber })),
      { destination: reverse.destination, depositTxid: deposit.txid }
    )
    if (match) return { payout: { hash: match.hash, amount: match.amount }, scannedBlock: to }
    from = to + 1
  }
  return { scannedBlock: from }
}

// THORChain swaps and pays out about this long after the deposit is final on BCH.
const SWAP_AND_PAYOUT_SECONDS = 60

// When the payout is expected, from THORNode's own countdown: the BCH confirmations it still waits
// for (it may need several blocks, more than the quote's estimate), any outbound delay, then the
// swap and the payout. Timing only: the payout itself is always seen on the destination chain.
export const depositReadyAt = (status: TxStatusResponse, nowMs = Date.now()) => {
  const stages = status.stages
  if (!stages?.inbound_observed?.completed) return undefined
  const confirming = stages.inbound_confirmation_counted?.completed === false ? (stages.inbound_confirmation_counted.remaining_confirmation_seconds ?? 0) : 0
  const delayed = stages.outbound_delay?.completed === false ? (stages.outbound_delay.remaining_delay_seconds ?? 0) : 0
  const seconds = confirming + delayed + SWAP_AND_PAYOUT_SECONDS
  return Number.isFinite(seconds) ? nowMs + seconds * 1000 : undefined
}

// The outbound THORNode names, looked up on its own chain (see payout-check.ts). A lookup that fails
// is no payout yet; the next poll asks again.
const nonEvmPayout = async (chain: string, out: OutTx, expect: { destination: string; depositTxid: string; buyAsset: string }): Promise<ChainPayout | undefined> => {
  if (chain === Chain.THORChain) return thorchainPayout(out, expect)
  // The SDK config is what points getRPCUrl at our Solana proxy rather than the public node.
  getUSwap()
  const hash = out.id
  const slug = BLOCKCHAIR_CHAINS[chain as UTXOChain]
  if (slug) {
    const res = await fetch(`${blockchairProxyUrl()}/${slug}/dashboards/transaction/${encodeURIComponent(hash.toLowerCase())}`)
    if (!res.ok) throw new Error(`Blockchair answered ${res.status}`)
    return utxoPayout(await res.json(), hash.toLowerCase(), expect)
  }
  if (chain === Chain.Ripple) {
    const { result } = await postJson(XRPL_RPC_URL, { method: 'tx', params: [{ transaction: hash }] })
    return xrpPayout(result, hash, expect)
  }
  if (chain === Chain.Solana) {
    const { result } = await postJson(await rpcBase(Chain.Solana), {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [hash, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]
    })
    return solanaPayout(result, hash, expect)
  }
  if (chain === Chain.Tron) {
    const base = await rpcBase(Chain.Tron)
    const id = hash.replace(/^0x/i, '').toLowerCase()
    const [tx, info] = await Promise.all([postJson(`${base}/wallet/gettransactionbyid`, { value: id }), postJson(`${base}/wallet/gettransactioninfobyid`, { value: id })])
    return tronPayout(tx, info, id, expect)
  }
  if (chain === Chain.Cosmos) {
    const res = await fetch(`${await rpcBase(Chain.Cosmos)}/tx?hash=0x${hash.replace(/^0x/i, '')}`)
    const { result } = await res.json()
    return result ? cosmosPayout(result, hash, expect) : undefined
  }
  return undefined
}

type OutTx = NonNullable<TxStatusResponse['out_txs']>[number]

// THORNode names the payout's hash, and it counts only once the destination chain's own node shows
// it paying the destination for this deposit: on an EVM chain a successful receipt whose TransferOut
// matches (a gap filler when the log search finds nothing: a router that changed, an RPC that limits
// log queries); elsewhere the chain's own transaction, the only evidence those chains have.
export const confirmReportedPayout = async (op: BridgeOperation) => {
  const reverse = op.reverse
  const depositTxid = reverse?.deposit?.txid
  if (!reverse || !depositTxid) return undefined
  const chain = destinationChainOf(reverse.buyAsset)
  const status = await getTxStatus(depositTxid)
  const outs = (status.out_txs ?? []).filter(o => o.chain?.toUpperCase() === chain && o.memo?.toUpperCase().startsWith('OUT:'))
  if (outs.length === 0) return undefined
  if (!isEvmChain(chain)) {
    for (const out of outs) {
      const found = await nonEvmPayout(chain, out, { destination: reverse.destination, depositTxid, buyAsset: reverse.buyAsset }).catch(() => undefined)
      if (found) return found
    }
    return undefined
  }
  const provider = await getProvider(chain as EVMChain)
  for (const out of outs) {
    const receipt = await provider.getTransactionReceipt(out.id.startsWith('0x') ? out.id : `0x${out.id}`)
    if (!receipt || receipt.status !== 1) continue
    const match = matchPayout(
      receipt.logs.map(l => ({ topics: [...l.topics], data: l.data, transactionHash: receipt.hash, blockNumber: receipt.blockNumber })),
      { destination: reverse.destination, depositTxid }
    )
    if (match) return { hash: match.hash, amount: match.amount }
  }
  return undefined
}
