import { useQuery } from '@tanstack/react-query'
import { AssetValue, EVMChains, type EVMChain, type USwapNumber } from '@tcswap/core'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { getProvider } from '@tcswap/toolboxes/evm'
import { Contract } from 'ethers'
import { useRates } from '@/hooks/use-rates'
import { useAssetFrom } from '@/hooks/use-swap'
import { useConnectedAccount } from '@/hooks/use-wallets'
import { toBaseUnits } from '@/lib/bridge'
import { gasCost, routeGasUnits, type SourceGas } from '@/lib/source-gas'
import { useSwapStore } from '@/store/swap-store'

const usd = (rate?: USwapNumber) => (rate ? Number(rate.toSignificant(12)) : undefined)
const baseUnits = (amount: string, decimals: number) => {
  try { return toBaseUnits(amount, decimals) } catch { return undefined }
}

// What each route's deposit costs in gas on the paying chain, live: the chain's gas price from its RPC, the wallet's
// allowance for a route that would approve first, and USD prices for the native coin and the bought asset. EVM chains
// only; elsewhere every bridge's deposit is one transfer of the same size, so routes come back without a cost.
export const useSourceGas = <K extends string>(routes: Partial<Record<K, QuoteResponseRoute>> | undefined): Partial<Record<K, SourceGas>> => {
  const assetFrom = useAssetFrom()
  const openNetworks = useSwapStore(state => state.openNetworks)
  const quoted = Object.entries(routes ?? {}).filter((entry): entry is [K, QuoteResponseRoute] => !!entry[1] && typeof entry[1] === 'object')
  const sample = quoted[0]?.[1]
  // Back from BCH the wallet pays on BCH; only a route that sells the form's own asset is priced.
  const asset = sample && assetFrom && sample.sellAsset.toLowerCase() === assetFrom.identifier.toLowerCase() ? assetFrom : undefined
  const chain = asset && EVMChains.includes(asset.chain as EVMChain) ? (asset.chain as EVMChain) : undefined
  const native = chain ? AssetValue.from({ chain, value: 0 }) : undefined
  const nativeId = native ? `${chain}.${native.ticker}` : undefined
  const { rates } = useRates(nativeId && sample ? [nativeId, sample.buyAsset] : [])
  const account = useConnectedAccount(chain, openNetworks)
  const spender = quoted.map(([, route]) => route.meta?.approvalAddress).find(Boolean)
  const token = !!asset?.address
  const amount = sample && asset && token ? baseUnits(sample.sellAmount, asset.decimals) : undefined

  const { data: gasPrice } = useQuery({
    queryKey: ['source-gas-price', chain],
    queryFn: async () => {
      const fees = await (await getProvider(chain!)).getFeeData()
      return (fees.gasPrice ?? fees.maxFeePerGas)?.toString() ?? null
    },
    enabled: !!chain,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1
  })
  // Without a wallet (or while it is read) the route is priced with its approval: a first transfer signs one.
  const { data: approved } = useQuery({
    queryKey: ['source-gas-allowance', chain, asset?.address, spender, account?.address, amount?.toString()],
    queryFn: async () => {
      const erc20 = new Contract(asset!.address!, ['function allowance(address owner, address spender) view returns (uint256)'], await getProvider(chain!))
      return (await erc20.allowance(account!.address, spender)) >= amount!
    },
    enabled: !!(chain && token && spender && account?.address && amount),
    staleTime: 30_000,
    retry: false
  })

  const costs: Partial<Record<K, SourceGas>> = {}
  if (!gasPrice || !nativeId || !sample) return costs
  for (const [key, route] of quoted) {
    const cost = gasCost(routeGasUnits(route, { token, approved: !!approved }), BigInt(gasPrice), usd(rates[nativeId]), usd(rates[sample.buyAsset]))
    if (cost) costs[key] = cost
  }
  return costs
}
