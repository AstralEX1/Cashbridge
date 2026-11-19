import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsArticle } from '@/components/docs/docs-ui'
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
      lead="Real transfers through this site, end to end, in both directions. Every link opens the transaction on a public explorer, so anyone can check that the funds moved."
    >
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
          Both modes. In <strong>Manual</strong> mode the user signs each step in their own wallets. With the <strong>Cashbridge Router</strong> the
          user signs once in the source wallet, and the Cashbridge Router buys PUSD and pays it out. See{' '}
          <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
        </li>
        <li>
          The cross-chain leg runs on THORChain. Every <strong>THORChain swap</strong> link opens the swap on{' '}
          <a href="https://thorchain.net" target="_blank" rel="noopener noreferrer">
            thorchain.net
          </a>
          : each one finished without a refund, and its payout is the transaction listed next to it.
        </li>
      </ul>
      <p>
        The runs used small amounts, $1 to $3 per leg. The Cashbridge Router delivered 1.51 PUSD 5.7 minutes after the single BNB signature, against a
        quote of 1.50 and a minimum of 1.48. Every payout arrived at or above the minimum shown on the Confirm screen. New runs are added at the
        bottom of the table.
      </p>
    </DocsArticle>
  )
}
