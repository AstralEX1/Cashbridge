import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Flow } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'How it works',
  alternates: { canonical: '/docs/how-it-works' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/how-it-works"
      title="How it works"
      lead="A transfer is a short chain of ordinary transactions: one on the source chain, one or two on Bitcoin Cash. Cash Bridge plans them, builds them and follows them."
    >
      <h2 id="building-blocks">The building blocks</h2>
      <h3>Your wallets</h3>
      <p>
        Every transaction is signed in a wallet you control. Cash Bridge builds the request and checks it, and your wallet decides whether to sign. Cash Bridge never sees a private key. See <Link href="/docs/wallets">Wallets</Link>.
      </p>
      <h3>THORChain</h3>
      <p>
        <a href="https://thorchain.org" target="_blank" rel="noopener noreferrer">
          THORChain
        </a>{' '}
        is a network of liquidity pools that swaps native assets across chains. You send USDC on Ethereum to a THORChain vault with a memo that says where the result should go, and THORChain pays out native BCH on Bitcoin Cash. If a swap cannot complete, for example because the price moved past your slippage limit, THORChain refunds the source asset to the address that sent it.
      </p>
      <h3>NEAR Intents</h3>
      <p>
        <a href="https://docs.near-intents.org" target="_blank" rel="noopener noreferrer">
          NEAR Intents
        </a>{' '}
        is the second route. Its 1Click service gives each transfer a one-use deposit address on the source chain; you send the asset there with a plain transfer, no memo, and market makers pay native BCH to your address. If the transfer cannot complete before its deadline, the deposit is refunded to the address you sent it from. When both routes quote, the form shows what each would deliver and takes the better one; you can pick the other. NEAR Intents carries manual transfers in both directions. The Cashbridge Router uses THORChain.
      </p>
      <h3>Cauldron</h3>
      <p>
        <a href="https://cauldron.quest" target="_blank" rel="noopener noreferrer">
          Cauldron
        </a>{' '}
        is a market on Bitcoin Cash made of liquidity pools that hold BCH and a CashToken such as PUSD. A swap is a Bitcoin Cash transaction that spends a pool&apos;s coins and pays you the token. Cash Bridge builds that transaction in your browser from the live pools and checks each pool is still unspent before you sign.
      </p>
      <h3>Cash Bridge</h3>
      <p>The interface on top. It picks the route, shows the estimate, builds the transactions, watches the chains for each step and keeps a record in your browser.</p>

      <h2 id="forward">Bridging to Bitcoin Cash</h2>
      <Flow
        label="Route from another chain to PUSD"
        nodes={[
          { title: 'Source wallet', note: 'Signs the transfer, e.g. USDC on Ethereum' },
          { title: 'THORChain', note: 'Swaps the asset for native BCH' },
          { title: 'Your BCH wallet', note: 'Receives the BCH' },
          { title: 'Cauldron', note: 'Swaps the BCH for PUSD' },
          { title: 'Your BCH wallet', note: 'Holds the PUSD' }
        ]}
      />
      <p>
        The first leg always ends in native BCH, because THORChain pays out BCH. If you asked for BCH you are done there. If you asked for a token such as PUSD, a second transaction swaps the BCH for the token on Cauldron. That one is signed in your BCH wallet once the BCH has arrived. The confirmation screen labels them <strong>1/2 Bridge</strong> and <strong>2/2 Swap</strong>.
      </p>
      <p>
        The amount you see before you start is an estimate. THORChain&apos;s quote covers the first leg. The second leg is quoted again on the BCH you actually receive, and the minimum you accept is part of the transaction you sign. If you would rather not swap, you can keep the BCH instead.
      </p>

      <h2 id="reverse">Bridging back</h2>
      <Flow
        label="Route from PUSD to another chain"
        nodes={[
          { title: 'Your BCH wallet', note: 'Signs the Cauldron swap' },
          { title: 'Cauldron', note: 'Swaps the token for BCH' },
          { title: 'Your BCH wallet', note: 'Signs the deposit to THORChain' },
          { title: 'THORChain', note: 'Swaps the BCH for the target asset' },
          { title: 'Destination wallet', note: 'Receives the payout on its chain' }
        ]}
      />
      <p>
        Going the other way, the BCH wallet signs both steps: first the Cauldron swap into BCH (skipped when you start from BCH itself), then the BCH deposit to THORChain, which carries the swap instructions. THORChain pays the result to your wallet on the destination chain. See <Link href="/docs/guides/bridge-from-bch">Bridge back from Bitcoin Cash</Link>.
      </p>

      <h2 id="router">With the Cashbridge Router</h2>
      <Flow
        label="Route with the Cashbridge Router"
        nodes={[
          { title: 'Source wallet', note: 'Signs once' },
          { title: 'THORChain', note: 'Pays BCH to a per-order address' },
          { title: 'Cash Bridge service', note: 'Buys PUSD on Cauldron' },
          { title: 'Your address', note: 'Receives the PUSD' }
        ]}
      />
      <p>
        With the Cashbridge Router on, THORChain pays the BCH to a contract made for that one order. The Router verifies the deposit, buys PUSD on Cauldron and pays it to your address; the contract lets it spend the BCH only that way or to refund you. You sign once, but there are still several transactions. Details in <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link> and <Link href="/docs/security">Security and custody</Link>.
      </p>

      <h2 id="speed">How long it takes</h2>
      <p>
        The confirmation screen shows an estimate for each step; a first transfer commonly takes a few minutes in total. Most of that is the THORChain swap. Bitcoin Cash steps are quick.
      </p>
      <p>
        Cash Bridge does not wait for Bitcoin Cash blocks. A Bitcoin Cash transaction that has been accepted into the network&apos;s mempool counts as done, so the Cauldron swap can start as soon as the BCH from THORChain appears. Receipts for Cashbridge Router payouts are marked provisional at that point and become final after six confirmations.
      </p>

      <h2 id="status">Where status comes from</h2>
      <p>
        Cash Bridge reads the state of each transaction from the chains themselves: Ethereum-style nodes for EVM chains and Electrum servers for Bitcoin Cash. THORChain&apos;s own status is used only to fill gaps, such as showing a refund. A slow or unavailable THORChain status page does not hold a step back.
      </p>

      <Callout kind="note">
        The record of a transfer lives in your browser. If you close the tab you can come back in the same browser and carry on. See <Link href="/docs/guides/track-a-transfer">Track a transfer</Link>.
      </Callout>
    </DocsArticle>
  )
}
