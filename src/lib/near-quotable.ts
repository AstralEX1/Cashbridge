import { Chain } from '@tcswap/helpers'
import { assetsFromNearTokens, findNearToken, NEAR_BCH, type OneClickToken } from '@/lib/near-intents'

// NEAR Intents lists tokens its solvers quote no route for against BCH (WETH, vault shares, thin meme coins). These are
// the picker rows to leave out, per direction. Only a plain "no route" answer counts: a timeout, a rate limit or a
// server error leaves a token listed, and so does a token without a price to size the probe by.
export type NearUnquotable = { forward: string[]; reverse: string[] }

const NO_ROUTE = /no liquidity|no_quote|not available/i
const PROBE_USD = 50
const PARALLEL = 12

type Quote = (sellAsset: string, buyAsset: string, sellAmount: string) => Promise<unknown>

export const findNearUnquotable = async (tokens: OneClickToken[], quote: Quote, deadline: number): Promise<NearUnquotable> => {
  const found: NearUnquotable = { forward: [], reverse: [] }
  const bchUsd = tokens.find(token => token.assetId === NEAR_BCH)?.price
  if (!bchUsd) return found
  const noRoute = async (sellAsset: string, buyAsset: string, sellAmount: string) =>
    Date.now() < deadline && quote(sellAsset, buyAsset, sellAmount).then(() => false, error => NO_ROUTE.test(String(error?.message ?? error)))
  const queue = assetsFromNearTokens(tokens).filter(asset => asset.chain !== Chain.BitcoinCash)
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) {
        const price = findNearToken(tokens, asset.identifier)?.price
        const amount = price && price > 0 ? (PROBE_USD / price).toFixed(Math.min(asset.decimals, 8)) : undefined
        if (amount && (await noRoute(asset.identifier, 'BCH.BCH', amount))) found.forward.push(asset.identifier)
        if (await noRoute('BCH.BCH', asset.identifier, (PROBE_USD / bchUsd).toFixed(8))) found.reverse.push(asset.identifier)
      }
    })
  )
  return found
}
