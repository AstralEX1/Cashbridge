const mocked = new Set([
  '@/lib/wallets',
  '@/lib/ton-wallet',
  '@/lib/near-connect-wallet',
  '@/hooks/use-wallets',
  '@/hooks/use-swap',
  '@/hooks/use-balance',
  '@/hooks/use-quote',
  '@/components/bch-wallet',
  '@/components/connect-wallet/connect-wallet',
  '@/components/connect-wallet/config',
  '@/components/connect-wallet/browser-wallet',
  '@/components/connect-wallet/ledger',
  '@/components/connect-wallet/trezor',
  '@/components/ui/credenza',
  '@/components/ui/scroll-area',
  '@/components/wallet-icon',
  '@/components/icons',
  '@/components/global-dialog',
  '@/components/tooltip',
  '@wizardconnect/react',
  '@tanstack/react-query',
  'sonner',
  '@/lib/toast',
  'next/image',
  'next-intl'
])

export async function resolve(specifier, context, next) {
  if (mocked.has(specifier)) return next(new URL('./wallet-mocks.mjs', import.meta.url).href, context)
  return next(specifier, context)
}
