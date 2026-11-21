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
      <Callout kind="note" title="Legacy and contract Router rows">
        The two oldest <strong>Cashbridge Router</strong> rows used a legacy P2PKH order address (temporary service custody of the BCH). The rows marked <em>order contract</em> or <em>sale contract</em> ran through the per-order P2SH covenants (<code>apiVersion=2</code>): the BCH or the token waited in a contract made for that order, which could only complete the order on its terms or give the funds back.
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
        <li>Two Cauldron stablecoins, PUSD and MUSD. Deposits from Ethereum, Base, BNB Smart Chain and TON, and payouts on Base, BNB Smart Chain and Avalanche.</li>
        <li>
          Both modes. <strong>Manual</strong>: the user signs each step. <strong>Cashbridge Router</strong>: one signature, in the source wallet or, for a sale, in the BCH wallet; an ERC-20 token sent through THORChain also needs an approval, as in the 3 USDC row. In the ETH (Base) row the order contract gave the BCH back to the user&apos;s fallback address instead of buying PUSD. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
        </li>
        <li>
          THORChain and NEAR Intents carried the cross-chain leg. A <strong>THORChain swap</strong> link opens{' '}
          <a href="https://thorchain.net" target="_blank" rel="noopener noreferrer">
            thorchain.net
          </a>{' '}
          and a <strong>NEAR Intents swap</strong> link opens the{' '}
          <a href="https://explorer.near-intents.org" target="_blank" rel="noopener noreferrer">
            NEAR Intents explorer
          </a>
          . Each swap finished without a refund, and its payout is listed next to it.
        </li>
      </ul>
      <p>
        The runs moved $1 to $100 each. On the first Router run the Cashbridge Router delivered 1.51 PUSD 5.7 minutes after the single BNB signature, against a quote of 1.50 and a minimum of 1.48. New runs are added at the bottom of the table.
      </p>
    </DocsArticle>
  )
}
