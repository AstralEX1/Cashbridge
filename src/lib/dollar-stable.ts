// Dollar-pegged stables are always quoted at $1. Pool and Midgard USD prices for them drift
// (ETH.USDT at $0.85, BSC.USDT at $0.58 on 2026-11-19) and would skew route impact.

// Ticker from a THORChain-style id (`BASE.USDC-0X…`, `ETH-USDC-0X…`, `SOL.USDC-EPjF…`) or a bare ticker.
export const dollarTicker = (identifier: string) => {
  const id = identifier.trim()
  if (!id) return ''
  const upper = id.toUpperCase()
  const sep = upper.includes('.') ? upper.indexOf('.') : upper.includes('~') ? upper.indexOf('~') : upper.includes('-') ? upper.indexOf('-') : -1
  const body = sep >= 0 ? upper.slice(sep + 1) : upper
  return body.split('-')[0] || ''
}

// USDC, USDT, PUSD, MUSD, DAI, and any ticker that carries "USD".
export const isDollarStable = (tickerOrId: string) => {
  const ticker = dollarTicker(tickerOrId)
  return ticker === 'DAI' || ticker.includes('USD')
}
