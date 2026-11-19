import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle } from '@/components/docs/docs-ui'
import { RUNS } from '@/lib/mainnet-runs'

export const metadata: Metadata = {
  title: 'Proof on mainnet',
  alternates: { canonical: '/docs/mainnet' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/mainnet"
      title="Proof on mainnet"
      lead="Real transfers through this site, end to end, in both directions. Every link opens a public explorer so anyone can check that the funds moved."
    >
      <Callout kind="note" title="Contract vs legacy Router proof">
        The published <strong>Cashbridge Router</strong> row below used a legacy P2PKH order address (temporary service custody of the BCH). It shows a mainnet run where the user signed once in the source wallet. It is <strong>not</strong> funded evidence of the newer P2SH purchase / sale covenants (<code>apiVersion=2</code>). Contract settlements, when published, will be labelled separately.
      </Callout>

      <h2 id="runs">Transfers</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Mode</th>
            <th>Route</th>
            <th>Sent → received</th>
            <th>Transactions</th>
          </tr>
        </thead>
        <tbody>
          {RUNS.map(run => (
            <tr key={run.links[0][1]}>
              <td>{run.date}</td>
              <td>{run.router ? <strong>Cashbridge Router</strong> : 'Manual'}</td>
              <td>{run.route}</td>
              <td>{run.amounts}</td>
              <td>
                {run.links.map(([label, url], i) => (
                  <span key={url + label}>
                    {i > 0 && ' · '}
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ whiteSpace: 'nowrap' }}>
                      {label}
                    </a>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="what-it-shows">What the runs show</h2>
      <ul>
        <li>Both directions: into Bitcoin Cash and its stablecoins, and back out to other chains.</li>
        <li>Two Cauldron stablecoins, PUSD and MUSD, and payouts on BNB Smart Chain and Avalanche.</li>
        <li>
          Both modes. <strong>Manual</strong>: the user signs each step. <strong>Cashbridge Router</strong>: the listed run used one source signature; the Router bought PUSD and paid it out under the legacy order model. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link> for how contract orders work when the service returns them.
        </li>
        <li>
          These runs used THORChain for the cross-chain leg. Every <strong>THORChain swap</strong> link opens{' '}
          <a href="https://thorchain.net" target="_blank" rel="noopener noreferrer">
            thorchain.net
          </a>
          ; each finished without a refund, and its payout is listed next to it. NEAR Intents mainnet rows are not in this table yet.
        </li>
      </ul>
      <p>
        The runs used small amounts, $1 to $3 per leg. The Cashbridge Router delivered 1.51 PUSD 5.7 minutes after the single BNB signature, against a quote of 1.50 and a minimum of 1.48. Every payout arrived at or above the minimum shown on Confirm. New runs are added at the bottom of the table.
      </p>
    </DocsArticle>
  )
}
