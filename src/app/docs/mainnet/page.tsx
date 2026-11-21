import type { Metadata } from 'next'
import Link from 'next/link'
import { Wallet, Zap } from 'lucide-react'
import { Callout, DocsArticle } from '@/components/docs/docs-ui'
import { FEATURED_TOKENS } from '@/lib/cauldron-tokens'
import { RUNS, type Run } from '@/lib/mainnet-runs'
import { rowFromRun, shortHash } from '@/lib/scanner'

export const metadata: Metadata = {
  title: 'Proof on mainnet',
  alternates: { canonical: '/docs/mainnet' }
}

// A run leaves Bitcoin Cash when it starts from BCH or a Cauldron token.
const BCH_SIDE = new Set(['BCH', ...FEATURED_TOKENS.map(token => token.ticker)])
const leavesBch = (run: Run) => BCH_SIDE.has(run.amounts.trim().split(/\s+/)[1])
const bridgeOf = (run: Run) => run.links.find(([label]) => label.endsWith(' swap'))?.[0].replace(/ swap$/, '')

const GROUPS = [
  { id: 'into-bch', title: 'Into Bitcoin Cash', runs: RUNS.filter(run => !leavesBch(run)) },
  { id: 'out-of-bch', title: 'Out of Bitcoin Cash', runs: RUNS.filter(leavesBch) }
]
const BRIDGES = [...new Set(RUNS.map(bridgeOf).filter(Boolean))]

function ProofRun({ run }: { run: Run }) {
  const bridge = bridgeOf(run)
  return (
    <li>
      <div className="docs-proof-head">
        <strong>{run.route}</strong>
        <span className="docs-proof-tag" data-router={run.router || undefined}>
          {run.router ? <Zap size={12} aria-hidden /> : <Wallet size={12} aria-hidden />}
          {run.router ? 'Cashbridge Router' : 'Manual'}
        </span>
        {bridge && <span className="docs-proof-tag">{bridge}</span>}
        {run.router && <span className="docs-proof-tag">{run.contract ? `${run.contract} contract` : 'legacy order address'}</span>}
      </div>
      <p className="docs-proof-amounts">
        <span>
          {run.amounts}
          {run.note && `, ${run.note}`}
        </span>
        <span className="docs-proof-date">{run.date}</span>
      </p>
      <ol className="docs-proof-steps" aria-label="Transactions">
        {rowFromRun(run).legs.map(leg => {
          // The bridge tag already names the bridge, and its record is found by the deposit's hash or address.
          const swap = leg.label.endsWith(' swap')
          return (
            <li key={leg.label + leg.url}>
              <a href={leg.url} target="_blank" rel="noopener noreferrer" aria-label={`${leg.label}, ${shortHash(leg.hash)}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {leg.icon && <img src={leg.icon} alt="" width={14} height={14} loading="lazy" />}
                {swap ? 'swap' : leg.label}
                {!swap && <code>{shortHash(leg.hash)}</code>}
              </a>
            </li>
          )
        })}
      </ol>
    </li>
  )
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/mainnet"
      title="Proof on mainnet"
      lead="Real transfers through this site, end to end, in both directions. Every link opens a public explorer so anyone can check that the funds moved."
    >
      <h2 id="runs">Transfers</h2>
      <p>
        {RUNS.length} transfers, {RUNS.filter(run => run.router).length} of them through the <strong>Cashbridge Router</strong>, over {BRIDGES.join(' and ')}. Newest first.
      </p>
      {GROUPS.map(group => (
        <section key={group.id} aria-labelledby={group.id}>
          <h3 id={group.id}>
            {group.title} <span className="docs-proof-count">{group.runs.length}</span>
          </h3>
          <ol className="docs-proof">
            {[...group.runs].reverse().map(run => (
              <ProofRun key={run.links[0][1]} run={run} />
            ))}
          </ol>
        </section>
      ))}

      <Callout kind="note" title="Contract and legacy Router rows">
        Rows tagged <em>order contract</em> or <em>sale contract</em> ran through the per-order P2SH covenants (<code>apiVersion=2</code>): the BCH or the token waited in a contract made for that order, which could only complete the order on its terms or give the funds back. The two rows tagged <em>legacy order address</em> used a P2PKH order address (temporary service custody of the BCH).
      </Callout>

      <h2 id="what-it-shows">What the runs show</h2>
      <ul>
        <li>Both directions: into Bitcoin Cash and its stablecoins, and back out to other chains.</li>
        <li>Two Cauldron stablecoins, PUSD and MUSD. Deposits from Ethereum, Base, BNB Smart Chain and TON, and payouts on Base, BNB Smart Chain and Avalanche.</li>
        <li>
          Both modes. <strong>Manual</strong>: the user signs each step. <strong>Cashbridge Router</strong>: one signature, in the source wallet or, for a sale, in the BCH wallet; an ERC-20 token sent through THORChain also needs an approval, as in the 3 USDC row. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
        </li>
        <li>
          THORChain and NEAR Intents carried the cross-chain leg. Its <strong>swap</strong> step opens{' '}
          <a href="https://thorchain.net" target="_blank" rel="noopener noreferrer">
            thorchain.net
          </a>{' '}
          or the{' '}
          <a href="https://explorer.near-intents.org" target="_blank" rel="noopener noreferrer">
            NEAR Intents explorer
          </a>
          . Each swap finished without a refund, and its payout is the next step.
        </li>
      </ul>
      <p>
        The runs moved $1 to $100 each. On the first Router run the Cashbridge Router delivered 1.51 PUSD 5.7 minutes after the single BNB signature, against a quote of 1.50 and a minimum of 1.48.
      </p>
    </DocsArticle>
  )
}
