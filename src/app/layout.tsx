import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Noto_Sans_Runic } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from '@/components/ui/sonner'
import { WebMcpTools } from '@/components/webmcp-tools'
import { ChatwootWidget } from '@/components/chatwoot-widget'
import { ReactQueryProvider } from '@/components/react-query/react-query-provider'
import { WalletStoreHydration } from '@/components/wallet-store-hydration'
import { ReferralCapture } from '@/components/referral-capture'
import { AppConfig } from '@/config'
import { BchWalletProvider } from '@/components/bch-wallet'
import { BridgeTracker } from '@/components/swap/pusd-swap'
import { getLangDir, type Locale } from '@/i18n/config'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(AppConfig.baseUrl),
  title: AppConfig.title,
  icons: {
    icon: AppConfig.favicon,
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
  },
  appleWebApp: {
    capable: true,
    title: 'THORChain Swap',
    statusBarStyle: 'black-translucent'
  },
  openGraph: {
    title: AppConfig.title,
    description: AppConfig.description,
    url: AppConfig.baseUrl,
    siteName: 'THORChain Swap',
    images: [
      {
        url: `${AppConfig.baseUrl}/og-image.png`,
        width: 2400,
        height: 1260,
        alt: AppConfig.title
      }
    ],
    type: 'website',
    locale: 'en_US'
  },
  twitter: {
    card: 'summary_large_image',
    title: AppConfig.title,
    description: AppConfig.description,
    images: [
      {
        url: `${AppConfig.baseUrl}/og-image.png`,
        width: 2400,
        height: 1260,
        alt: AppConfig.title
      }
    ]
  }
}

// JSON-LD structured data so search engines and AI agents can parse the
// site's identity programmatically.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${AppConfig.baseUrl}/#organization`,
      name: 'THORChain',
      url: 'https://www.thorchain.org',
      logo: `${AppConfig.baseUrl}/logo.svg`,
      sameAs: ['https://www.thorchain.org', 'https://x.com/THORChain', AppConfig.telegramLink],
      contactPoint: {
        '@type': 'ContactPoint',
        email: AppConfig.supportEmail,
        contactType: 'customer support'
      }
    },
    {
      '@type': 'WebSite',
      '@id': `${AppConfig.baseUrl}/#website`,
      name: 'THORChain Swap',
      url: AppConfig.baseUrl,
      publisher: { '@id': `${AppConfig.baseUrl}/#organization` }
    },
    {
      '@type': 'WebApplication',
      '@id': `${AppConfig.baseUrl}/#webapplication`,
      name: 'THORChain Swap',
      url: AppConfig.baseUrl,
      description: AppConfig.description,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      image: `${AppConfig.baseUrl}/og-image.png`,
      isPartOf: { '@id': `${AppConfig.baseUrl}/#website` },
      sameAs: ['https://github.com/thorchain/swap.thorchain'],
      subjectOf: { '@id': `${AppConfig.baseUrl}/developers#webpage` },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      },
      publisher: { '@id': `${AppConfig.baseUrl}/#organization` }
    }
  ]
}

const crit = localFont({
  variable: '--font-crit',
  display: 'swap',
  src: [
    { path: './fonts/Crit-Light-Trial.otf', weight: '300', style: 'normal' },
    { path: './fonts/Crit-Light-Italic-Trial.otf', weight: '300', style: 'italic' },
    { path: './fonts/Crit-Regular-Trial.otf', weight: '400', style: 'normal' },
    { path: './fonts/Crit-Italic-Trial.otf', weight: '400', style: 'italic' },
    { path: './fonts/Crit-Medium-Trial.otf', weight: '500', style: 'normal' },
    { path: './fonts/Crit-Medium-Italic-Trial.otf', weight: '500', style: 'italic' },
    { path: './fonts/Crit-Semibold-Trial.otf', weight: '600', style: 'normal' },
    { path: './fonts/Crit-Semibold-Italic-Trial.otf', weight: '600', style: 'italic' },
    { path: './fonts/Crit-Bold-Trial.otf', weight: '700', style: 'normal' },
    { path: './fonts/Crit-Bold-Italic-Trial.otf', weight: '700', style: 'italic' }
  ]
})

const notoRunic = Noto_Sans_Runic({
  variable: '--font-runic',
  display: 'swap',
  weight: '400',
  subsets: ['runic']
})

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await getLocale()) as Locale
  const messages = await getMessages()

  return (
    <html lang={locale} dir={getLangDir(locale)} data-brand={AppConfig.id} suppressHydrationWarning>
      <body className={`${crit.variable} ${notoRunic.variable} bg-body font-sans antialiased`}>
        {/* Agent discovery links; React hoists them into <head>. */}
        <link rel="mcp-server-card" type="application/mcp-server-card+json" href="/.well-known/mcp/server-card.json" />
        <link rel="ai-catalog" type="application/json" href="/.well-known/ai-catalog.json" />
        <link rel="alternate" type="text/markdown" title="llms.txt" href="/llms.txt" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
        <WebMcpTools />
        <WalletStoreHydration />
        <ReferralCapture />
        <ReactQueryProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <ThemeProvider defaultTheme="light" attribute="class" disableTransitionOnChange>
              <BchWalletProvider>
                {children}
                <BridgeTracker />
              </BchWalletProvider>
              <ChatwootWidget />
            </ThemeProvider>
          </NextIntlClientProvider>
        </ReactQueryProvider>
        <Toaster />
      </body>
    </html>
  )
}
