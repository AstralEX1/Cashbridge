import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsDemoQuotes } from '@/components/docs/docs-demo-quotes'
import { Callout, DocsArticle } from '@/components/docs/docs-ui'
import { BridgeCards, BuiltOn, LayerMap, ModeCompare, StatusMap, TimeStrip, WhenItFails } from '@/components/docs/how-figures'
import { RouteExplorer } from '@/components/docs/route-explorer'
import { BeamDiagram } from '@/components/landing/beam-diagram'
import { CHAINS, ROUTES } from '@/components/landing/network'
import { FEATURED_TOKENS } from '@/lib/cauldron-tokens'
import '@/components/landing/landing.css'

export const metadata: Metadata = {
  title: 'How it works',
  alternates: { canonical: '/docs/how-it-works' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      title="How it works"
      lead="A bridge carries the value to or from Bitcoin Cash as native BCH, and Cauldron turns that BCH into a CashToken such as PUSD, or back. Cash Bridge quotes, builds, checks and follows every step."
    >
      <div className="docs-beam">
        <BeamDiagram
          chains={CHAINS.slice(0, 5).map(([icon, name]) => ({ name, icon: `/networks/${icon}.svg` }))}
          more={CHAINS.length - 5}
          routes={ROUTES}
          tokens={[
            { name: 'BCH', icon: '/networks/bch.svg' },
            ...FEATURED_TOKENS.slice(0, 3).map(token => ({ name: token.ticker, icon: token.icon })),
            { name: 'Any CashToken' }
          ]}
        />
      </div>

      <h2 id="who-does-what">Who does what</h2>
      <LayerMap />

      <h2 id="explore">Every route, step by step</h2>
      <p>Pick a direction, a mode and a bridge. The coin shows what moves; the pen marks each signature you make.</p>
      <RouteExplorer />

      <h2 id="modes">Two modes</h2>
      <ModeCompare />

      <h2 id="bridges">Three bridges</h2>
      <BridgeCards />
      <DocsDemoQuotes />

      <h2 id="speed">Where the time goes</h2>
      <TimeStrip />

      <h2 id="failures">When something goes wrong</h2>
      <WhenItFails />
      <p>
        Every way a coin can leave a contract is on <Link href="/docs/smart-contracts">Smart contracts</Link>. A transfer that seems stuck:{' '}
        <Link href="/docs/stuck">Transaction got stuck?</Link>
      </p>

      <h2 id="status">Where status comes from</h2>
      <StatusMap />
      <Callout kind="note">
        Transfer records live in your browser, and the <Link href="/scanner">scanner</Link> finds a wallet&apos;s transfers from any device. See{' '}
        <Link href="/docs/guides/track-a-transfer">Track a transfer</Link>.
      </Callout>

      <h2 id="building-blocks">Built on</h2>
      <BuiltOn />
    </DocsArticle>
  )
}
