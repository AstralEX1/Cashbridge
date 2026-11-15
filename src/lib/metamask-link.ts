// A phone or tablet browser (iPadOS reports itself as a Mac with touch). There is no MetaMask
// extension there, but MetaMask's app opens a page in its own browser, where it is injected.
export const isMobileBrowser = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

// MetaMask's universal link: opens this same page (host, path and query) in the MetaMask app, or its
// store page when the app is missing.
export const metaMaskAppLink = (location: Pick<Location, 'host' | 'pathname' | 'search'>) =>
  `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}`
