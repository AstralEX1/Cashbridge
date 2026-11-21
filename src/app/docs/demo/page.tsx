import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle } from '@/components/docs/docs-ui'
import { PRE_BLAZE_RUNS } from '@/lib/mainnet-runs'

export const metadata: Metadata = {
  title: 'Pre-BLAZE demo',
  alternates: { canonical: '/docs/demo' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/demo"
      title="Pre-BLAZE demo"
      lead="Cash Bridge started before BCH BLAZE 2026. Before the build period opened on 14 November 2026, we had connected the THORChain API, run the first swaps by hand from a local build, BCH → PUSD on Cauldron included, and bought the cashbridge.space domain. These are the mainnet transactions from those tests."
    >
      <Callout kind="note" title="Manual runs from a local build">
        Each step below was signed by hand in the wallets, one transaction at a time. Transfers from 14 November 2026 on are in <Link href="/docs/mainnet">Proof on mainnet</Link>.
      </Callout>

      <h2 id="covered">What the tests covered</h2>
      <ul>
        <li>THORChain quotes and deposits from Base, in ETH and in USDC, with the minimum payout written into the swap memo.</li>
        <li>BCH to PUSD on Cauldron, in a second transaction after THORChain paid the BCH.</li>
        <li>The way back: PUSD to BCH on Cauldron, then BCH to USDC on Base through THORChain.</li>
      </ul>

      <h2 id="runs">Transfers, 26 to 31 October 2026</h2>
      {PRE_BLAZE_RUNS.map(run => (
        <section key={run.links[0][1]}>
          <h3>
            {run.date} · {run.route}
          </h3>
          <p>
            <strong>{run.amounts}</strong>
          </p>
          <p>{run.story}</p>
          <p>
            {run.links.map(([label, url], i) => (
              <span key={url + label}>
                {i > 0 && ' · '}
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ whiteSpace: 'nowrap' }}>
                  {label}
                </a>
              </span>
            ))}
          </p>
        </section>
      ))}
    </DocsArticle>
  )
}
