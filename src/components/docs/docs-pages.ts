export type DocsPageLink = { href: string; title: string }

export type DocsSection = { title: string; pages: DocsPageLink[] }

// The docs sidebar and the previous/next links under each page both read this list.
export const DOCS_SECTIONS: DocsSection[] = [
  {
    title: 'Overview',
    pages: [
      { href: '/docs', title: 'Introduction' },
      { href: '/docs/how-it-works', title: 'How it works' }
    ]
  },
  {
    title: 'Guides',
    pages: [
      { href: '/docs/guides/bridge-to-bch', title: 'Bridge to Bitcoin Cash or PUSD' },
      { href: '/docs/guides/cashbridge-router', title: 'Use the Cashbridge Router' },
      { href: '/docs/guides/bridge-from-bch', title: 'Bridge back from Bitcoin Cash' },
      { href: '/docs/guides/track-a-transfer', title: 'Track a transfer' }
    ]
  },
  {
    title: 'Reference',
    pages: [
      { href: '/docs/wallets', title: 'Wallets' },
      { href: '/docs/fees', title: 'Fees and limits' },
      { href: '/docs/security', title: 'Security and custody' }
    ]
  },
  {
    title: 'Help',
    pages: [{ href: '/docs/faq', title: 'FAQ and troubleshooting' }]
  }
]

export const DOCS_PAGES: DocsPageLink[] = DOCS_SECTIONS.flatMap(section => section.pages)
