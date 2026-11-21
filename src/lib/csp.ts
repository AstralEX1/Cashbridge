// The site's Content Security Policy. A script runs only when the server rendered it with this request's nonce, or a
// script that did loaded it ('strict-dynamic'), so markup injected into a page cannot run code in this origin: it can
// neither read the one-use order keys kept in this browser nor swap an address on the screen. Wallets, RPCs, relays and
// token logos live on many hosts, so connections, images and frames stay open to any https host. `https:` and
// 'unsafe-inline' in script-src only serve browsers too old for nonces; newer ones ignore them next to a nonce.
// WebAssembly (libauth's secp256k1) needs 'wasm-unsafe-eval'; React's dev build needs eval.
export const contentSecurityPolicy = (nonce: string, dev = false) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https: 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    `connect-src 'self' https: wss:${dev ? ' ws:' : ''}`,
    "frame-src 'self' https: blob: data:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')

// The nonce of this page, for code that adds an inline script of its own (NEAR Connect's wallet frames).
export const pageNonce = () =>
  typeof document === 'undefined' ? undefined : document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || undefined
