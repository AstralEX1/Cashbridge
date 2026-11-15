import { Chain, EVMChain, getChainConfig } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { getProvider } from '@tcswap/toolboxes/evm'
import type { DappConnectionManager } from '@wizardconnect/dapp'
import type { Asset } from '@/components/swap/asset'
import { BridgeConfig } from '@/config'
import { getInboundAddresses, getQuotes, isBridgeRoute } from '@/lib/api'
import { type BchBinding, listWalletCoins, type ScriptUtxo } from '@/lib/bch'
import { formatBaseUnits, minOutputFor } from '@/lib/bridge'
import { withLock } from '@/lib/bridge-first-leg'
import { buildTokenTrade, checkPoolCovenants, checkPoolsLive, checkSigned, quoteToken, type ReviewedSwap, reviewBuild, sourcesOf } from '@/lib/cauldron'
import type { CauldronToken } from '@/lib/cauldron-tokens'
import { buildDeposit, type BuiltDeposit, checkDepositMemo, checkInbound, DepositError, type InboundAddress, matchPayout, TRANSFER_OUT_TOPIC } from '@/lib/thorchain-deposit'
import { generateId } from '@/lib/utils'
import { type BridgeOperation, getActiveBridge, type SwapTransaction, transactionStore } from '@/store/transaction-store'

// The reverse bridge: (token -> BCH on Cauldron, step 1) then a BCH deposit to THORChain paying an
// EVM address (step 2). Both transactions are built here, checked, signed in the bound BCH wallet
// without broadcasting, checked again, saved, and only then broadcast by this app.

const SIGN_TIMEOUT_MS = 5 * 60_000

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

// --- Signing ---------------------------------------------------------------------------------------

export interface Signable {
  unsignedHex: string
  sourceOutputs: ReviewedSwap['sourceOutputs']
  ownIndexes: number[]
}

// Asks the bound wallet to sign (never to broadcast) and checks that it only added signatures by the
// bound key to our own inputs, and that the result verifies.
export const signInWallet = async (manager: DappConnectionManager, binding: BchBinding, tx: Signable, prompt: string) => {
  const inputPaths = tx.ownIndexes.map(i => [i, binding.path, binding.addressIndex] as [number, string, number])
  const response = await manager.signTransaction(
    { transaction: { transaction: tx.unsignedHex, sourceOutputs: tx.sourceOutputs as never, broadcast: false, userPrompt: prompt }, inputPaths },
    { signal: AbortSignal.timeout(SIGN_TIMEOUT_MS) }
  )
  if (response.error || !response.signedTransaction) throw new Error(response.error || 'The wallet did not sign the transaction')
  const txid = checkSigned(tx.unsignedHex, response.signedTransaction, tx.ownIndexes, sourcesOf(tx), binding.pubkey)
  return { txid, signedHex: response.signedTransaction.toLowerCase() }
}

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
  const quote = await quoteToken({ category: token.category, side: 'sell', amount: sellUnits })
  const minOutput = minOutputFor(quote.output, slippageBps)
  const intent = {
    category: token.category,
    side: 'sell' as const,
    funding: coins.map(u => ({ txid: u.txid, vout: u.vout, value: u.value.toString(), token: { category: token.category, amount: u.token!.amount.toString() } })),
    lockingBytecode: binding.lockingBytecode,
    tokenAddress: binding.tokenAddress,
    cashAddress: binding.cashAddress,
    sell: quote.sell,
    minOutput
  }
  const reviewed = reviewBuild(await buildTokenTrade(intent), intent)
  checkPoolCovenants(reviewed)
  await checkPoolsLive(reviewed)
  return reviewed
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
  destination,
  slippage
}: {
  funding: { txid: string; vout: number; value: string }[]
  payAll: boolean
  amountSats?: bigint
  binding: BchBinding
  buyAsset: string
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
  checkDepositMemo(route.memo, { buyAsset, destination })
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

export const blockHeight = async (chain: string) => (await getProvider(chain as EVMChain)).getBlockNumber()

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
