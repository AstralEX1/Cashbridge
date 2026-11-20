import { AssetValue, USwapError } from '@tcswap/helpers'
import type { QuoteResponseRoute } from '@tcswap/helpers/api'
import { createPlugin } from '@tcswap/plugins'
import { SHAPESHIFT_PROVIDER } from '@/lib/shapeshift'

// A ShapeShift route's deposit: a plain transfer of the quoted amount to the quote's deposit address. The SDK has no
// ShapeShift plugin, and `swap` finds one by the route's provider.
export const ShapeShiftPlugin = createPlugin({
  name: 'shapeshift',
  properties: { supportedUSwapProviders: [SHAPESHIFT_PROVIDER] },
  methods: ({ getWallet }) => ({
    async swap({ route }: { route: QuoteResponseRoute }) {
      if (!route.sellAsset || !route.buyAsset) throw new USwapError('core_swap_asset_not_recognized')
      if (!route.inboundAddress) throw new USwapError('core_swap_invalid_params', { missing: ['inboundAddress'] })
      const assetValue = await AssetValue.from({ asset: route.sellAsset, value: route.sellAmount })
      const wallet = getWallet(assetValue.chain as never) as
        | { address: string; transfer: (params: { assetValue: AssetValue; recipient: string; sender: string; isProgramDerivedAddress?: boolean }) => Promise<string> }
        | undefined
      if (!wallet) throw new USwapError('core_wallet_connection_not_found')
      return wallet.transfer({ assetValue, recipient: route.inboundAddress, sender: wallet.address, isProgramDerivedAddress: true })
    }
  })
})
