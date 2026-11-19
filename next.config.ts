import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    // The asset picker still writes pair URLs; serve the same bridge on reload or a shared link.
    return [{ source: '/sell-:sell-buy-:buy', destination: '/bridge' }]
  },
  async redirects() {
    // The bridge lived at / before the landing page; its old query links still open it.
    return ['private', 'bridgeFlowPreview'].map(key => ({
      source: '/',
      has: [{ type: 'query' as const, key }],
      destination: '/bridge',
      permanent: false
    }))
  }
}

export default withNextIntl(nextConfig)
