import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsDemoFlow } from '@/components/docs/docs-demo-flow'
import { DocsDemoQuotes } from '@/components/docs/docs-demo-quotes'
import { Callout, DocsArticle, Flow, SchemaCompare } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'How it works',
  alternates: { canonical: '/docs/how-it-works' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      title="How it works"
      lead="A transfer is a short chain of ordinary transactions. Cash Bridge quotes two bridges when both are available, plans the steps, and follows them — in Manual mode with your wallets, or through the Cashbridge Router with per-order contracts."
    >
      <DocsDemoFlow />

      <h2 id="schemas">Protocol schemas</h2>
      <p>
        Use these diagrams as the source of truth for custody. Interactive storyboards above scrub the same modes; the schemas below stay fixed for reading.
      </p>

      <h3 id="schema-modes">Manual vs Cashbridge Router</h3>
      <SchemaCompare
        label="Manual versus Cashbridge Router forward routes"
        left={{
          title: 'Manual',
          note: 'Only your wallets hold keys. No Cashbridge covenant.',
          nodes: [
            { title: 'Source wallet', note: 'Signs deposit', kind: 'wallet' },
            { title: 'THOR / NEAR', note: 'Pays your BCH address', kind: 'onchain' },
            { title: 'BCH wallet', note: 'Optional Cauldron swap', kind: 'wallet' }
          ]
        }}
        right={{
          title: 'Cashbridge Router',
          note: 'apiVersion=2 purchase covenant · not legacy P2PKH.',
          nodes: [
            { title: 'Source wallet', note: 'Signs once', kind: 'wallet' },
            { title: 'THOR / NEAR', note: 'Pays order address', kind: 'onchain' },
            { title: 'Purchase contract', note: 'convert / giveBack / expire', kind: 'contract' },
            { title: 'Router service', note: 'Builds allowed unlock', kind: 'service' }
          ]
        }}
      />

      <h3 id="schema-bridges">THORChain vs NEAR Intents</h3>
      <SchemaCompare
        label="THORChain versus NEAR Intents first legs"
        left={{
          title: 'THORChain',
          note: 'Vault deposit with a memo that names the BCH destination (wallet or order contract).',
          nodes: [
            { title: 'Source wallet', note: 'Vault + memo', kind: 'wallet' },
            { title: 'THORChain', note: 'Swaps to native BCH', kind: 'onchain' },
            { title: 'BCH destination', note: 'Wallet or covenant', kind: 'onchain' }
          ]
        }}
        right={{
          title: 'NEAR Intents',
          note: 'Plain one-use deposit address — no memo, no Cashbridge contract on that leg.',
          nodes: [
            { title: 'Source wallet', note: 'Plain transfer', kind: 'wallet' },
            { title: 'NEAR deposit', note: '1Click address', kind: 'onchain' },
            { title: 'BCH destination', note: 'Checked on Bitcoin Cash', kind: 'onchain' }
          ]
        }}
      />

      <h3 id="schema-sale">Sale covenant (Router reverse)</h3>
      <Flow
        label="Router sale covenant"
        nodes={[
          { title: 'BCH wallet', note: 'Sends CashToken', kind: 'wallet' },
          { title: 'Sale contract', note: 'sell / return / expire', kind: 'contract' },
          { title: 'Router service', note: 'Sell ≥ min BCH + THOR memo', kind: 'service' },
          { title: 'THORChain', note: 'Cross-chain payout', kind: 'onchain' }
        ]}
      />
      <p>
        Sales stay on THORChain. After <code>refundAfter</code> (three hours from order creation), anyone may return the tokens on the same terms. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
      </p>

      <h2 id="building-blocks">The building blocks</h2>
      <h3>Your wallets</h3>
      <p>
        Every user-facing transaction is signed in a wallet you control. Cash Bridge builds the request and checks it; your wallet decides whether to sign. Cash Bridge never sees a private key. See <Link href="/docs/wallets">Wallets</Link>.
      </p>
      <h3>THORChain</h3>
      <p>
        <a href="https://thorchain.org" target="_blank" rel="noopener noreferrer">
          THORChain
        </a>{' '}
        swaps native assets across chains via liquidity pools. You send an asset to a vault with a memo that names the BCH destination; THORChain pays native BCH. If a swap cannot complete past your slippage limit, it refunds the source asset to the sender.
      </p>
      <h3>NEAR Intents</h3>
      <p>
        <a href="https://docs.near-intents.org" target="_blank" rel="noopener noreferrer">
          NEAR Intents
        </a>{' '}
        is the second bridge. Its 1Click service gives each transfer a one-use deposit address on the source chain. You send a plain transfer — no memo — and market makers pay native BCH to the destination. There is no Cashbridge contract on the NEAR leg. When both bridges quote, the form shows both outputs and takes the better one; you can pick the other.
      </p>
      <DocsDemoQuotes />
      <p>
        NEAR Intents carries Manual transfers both ways. For the Cashbridge Router, it can carry the <strong>forward</strong> first leg when the service admits NEAR orders: 1Click still uses a plain deposit address, and its BCH payout targets the Router order address. Router <strong>sales</strong> stay on THORChain.
      </p>
      <h3>Cauldron</h3>
      <p>
        <a href="https://cauldron.quest" target="_blank" rel="noopener noreferrer">
          Cauldron
        </a>{' '}
        is an on-chain market for BCH and CashTokens. A swap is a Bitcoin Cash transaction that spends pool coins and pays you the token (or BCH). Cash Bridge builds that transaction from live pools and checks each pool is still unspent before you (or the Router) spend.
      </p>
      <h3>Cashbridge Router</h3>
      <p>
        An optional service mode. For contract orders, THORChain or NEAR pays BCH into a per-order P2SH purchase covenant; the Router may convert to your token or refund BCH under those terms. Sale covenants cover reverse CashToken flows when offered. Details in <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link> and <Link href="/docs/security">Security and custody</Link>.
      </p>

      <h2 id="forward">Bridging to Bitcoin Cash (Manual)</h2>
      <Flow
        label="Manual route from another chain to PUSD"
        nodes={[
          { title: 'Source wallet', note: 'Signs the transfer', kind: 'wallet' },
          { title: 'THORChain or NEAR', note: 'Pays native BCH', kind: 'onchain' },
          { title: 'Your BCH wallet', note: 'Receives the BCH', kind: 'wallet' },
          { title: 'Cauldron', note: 'Swaps BCH for PUSD (you sign)', kind: 'onchain' },
          { title: 'Your BCH wallet', note: 'Holds the PUSD', kind: 'wallet' }
        ]}
      />
      <p>
        The first leg always ends in native BCH. If you asked for BCH you are done. If you asked for a CashToken, a second transaction — signed in your BCH wallet — swaps on Cauldron. Confirm labels them <strong>1/2 Bridge</strong> and <strong>2/2 Swap</strong>. Amounts before you start are estimates; the second leg is re-quoted on the BCH you actually receive.
      </p>

      <h2 id="reverse">Bridging back (Manual)</h2>
      <Flow
        label="Manual route from PUSD to another chain"
        nodes={[
          { title: 'Your BCH wallet', note: 'Signs the Cauldron sale', kind: 'wallet' },
          { title: 'Cauldron', note: 'Token → BCH', kind: 'onchain' },
          { title: 'Your BCH wallet', note: 'Signs the bridge deposit', kind: 'wallet' },
          { title: 'THORChain or NEAR', note: 'Cross-chain payout', kind: 'onchain' },
          { title: 'Destination wallet', note: 'Receives on its chain', kind: 'wallet' }
        ]}
      />
      <p>
        Going the other way, the BCH wallet signs both steps (the Cauldron sale is skipped when you start from BCH). See <Link href="/docs/guides/bridge-from-bch">Bridge back from Bitcoin Cash</Link>.
      </p>

      <h2 id="router">With the Cashbridge Router</h2>
      <Flow
        label="Forward route with the Cashbridge Router"
        nodes={[
          { title: 'Source wallet', note: 'Signs once', kind: 'wallet' },
          { title: 'THORChain or NEAR', note: 'Pays the order address', kind: 'onchain' },
          { title: 'Order contract', note: 'P2SH purchase covenant', kind: 'contract' },
          { title: 'Cashbridge Router', note: 'Buys token on Cauldron', kind: 'service' },
          { title: 'Your address', note: 'Receives the token or BCH', kind: 'wallet' }
        ]}
      />
      <p>
        Contract orders fix the minimum, recipient and fallback in the script. The Router verifies the deposit, then converts or refunds under those rules. After <code>refundAfter</code> (three hours from order creation), anyone can return BCH to the fallback. You still have several on-chain transactions — one signature is not atomic settlement.
      </p>

      <h2 id="speed">How long it takes</h2>
      <p>Confirm shows an estimate per step; a first transfer commonly takes a few minutes. Most of that is the cross-chain bridge. Bitcoin Cash steps are quick.</p>
      <p>
        Cash Bridge does not wait for Bitcoin Cash blocks before starting the next BCH step when configured for mempool acceptance. Cashbridge Router receipts are marked provisional until six confirmations.
      </p>

      <h2 id="status">Where status comes from</h2>
      <p>
        Cash Bridge reads chains directly (EVM nodes, Electrum for Bitcoin Cash). THORChain and NEAR status fill gaps such as refunds. A slow status page does not hold a verified chain step back.
      </p>

      <Callout kind="note">
        Transfer records live in your browser. Router orders continue after the tab closes; Manual steps still need your wallet. See <Link href="/docs/guides/track-a-transfer">Track a transfer</Link>.
      </Callout>
    </DocsArticle>
  )
}
