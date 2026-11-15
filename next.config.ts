import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    // The asset picker still writes pair URLs; serve the same bridge on reload or a shared link.
    return [{ source: '/sell-:sell-buy-:buy', destination: '/' }]
  }
}

export default withNextIntl(nextConfig)
