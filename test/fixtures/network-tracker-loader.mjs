export async function resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/src/lib/network-swap-tracker.ts') && ['@/lib/transfer-status', '@/lib/reverse-bridge'].includes(specifier)) {
    return next(new URL('./network-tracker-mocks.mjs', import.meta.url).href, context)
  }
  return next(specifier, context)
}
