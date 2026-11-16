import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, Card, Cards, DocsArticle, Shot } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Introduction',
  alternates: { canonical: '/docs' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs"
      title="Introduction"
      lead="Cash Bridge moves value between Bitcoin Cash and the rest of crypto. Send an asset from Bitcoin, Ethereum, Base, Solana or another chain and receive BCH or a CashToken such as PUSD. Or go the other way."
    >
      <Shot name="form-forward" alt="The Cash Bridge form: 25 USDC on Ethereum to about 24.55 PUSD on Bitcoin Cash" caption="The bridge form. Pick what to send, what to receive and an amount; the estimate updates as you type." />

      <h2 id="what-you-can-do">What you can do</h2>
      <ul>
        <li>
          <strong>Bridge to Bitcoin Cash.</strong> Send an asset from another chain and receive native BCH, or a CashToken traded on Cauldron, with PUSD as the default.
        </li>
        <li>
          <strong>Bridge back.</strong> Sell BCH or a CashToken and receive an asset on another chain, paid straight to your wallet there.
        </li>
        <li>
          <strong>Sign once, if you prefer.</strong> The Cashbridge Router lets you approve a single transaction in your source wallet while the service finishes the PUSD purchase for you.
        </li>
      </ul>

      <h2 id="at-a-glance">At a glance</h2>
      <table>
        <tbody>
          <tr>
            <th>Directions</th>
            <td>Both. Any supported asset to BCH or a CashToken, and BCH or a CashToken to any supported asset.</td>
          </tr>
          <tr>
            <th>Send from</th>
            <td>Avalanche, Base, Bitcoin, BNB Smart Chain, Cosmos, Dogecoin, Ethereum, Litecoin, Solana, THORChain, TRON, XRP Ledger and Zcash. What is available at a given moment depends on THORChain.</td>
          </tr>
          <tr>
            <th>Receive</th>
            <td>Bitcoin Cash: BCH, PUSD and other CashTokens traded on Cauldron.</td>
          </tr>
          <tr>
            <th>Cash Bridge fee</th>
            <td>None. Network and liquidity costs still apply, see <Link href="/docs/fees">Fees and limits</Link>.</td>
          </tr>
          <tr>
            <th>Limits</th>
            <td>Cash Bridge sets no minimum or maximum of its own. THORChain minimums and available liquidity apply.</td>
          </tr>
          <tr>
            <th>Wallets</th>
            <td>
              EVM and other browser wallets for the source side. Selene (WizardConnect), Paytaca and Cashonize (WalletConnect) for Bitcoin Cash. See <Link href="/docs/wallets">Wallets</Link>.
            </td>
          </tr>
          <tr>
            <th>Custody</th>
            <td>
              You keep your keys and sign every step yourself. The optional Cashbridge Router holds your BCH briefly while it buys PUSD, see <Link href="/docs/security">Security and custody</Link>.
            </td>
          </tr>
        </tbody>
      </table>

      <Callout kind="warning" title="Start small">
        Cash Bridge is young software that moves real funds across several networks. Send a small amount first, check that it arrives, then bridge more.
      </Callout>

      <h2 id="two-ways">Two ways to bridge</h2>
      <p>
        <strong>Manual</strong> is the default. You sign each step in your own wallets: first the transfer from the source chain, then, for a token such as PUSD, the Cauldron swap in your BCH wallet. Nothing is ever in anyone else&apos;s hands.
      </p>
      <p>
        <strong>Cashbridge Router</strong> is a switch above the form. Turn it on and you sign once in your source wallet. Cash Bridge receives the BCH from THORChain, buys PUSD on Cauldron and sends it to your address. It works for transfers to PUSD and to plain BCH.
      </p>

      <h2 id="where-to-start">Where to start</h2>
      <Cards>
        <Card href="/docs/how-it-works" title="How it works">
          THORChain, Cauldron and your wallets, and what happens between your click and the receipt.
        </Card>
        <Card href="/docs/guides/bridge-to-bch" title="Bridge to Bitcoin Cash or PUSD">
          A walkthrough of your first transfer, with screenshots of every screen.
        </Card>
        <Card href="/docs/guides/cashbridge-router" title="Use the Cashbridge Router">
          One signature instead of two, and what you give up for it.
        </Card>
        <Card href="/docs/wallets" title="Wallets">
          Which wallets work and how to connect them.
        </Card>
        <Card href="/docs/faq" title="FAQ and troubleshooting">
          Halted trading, stuck steps, cancelled requests and refunds.
        </Card>
      </Cards>

      <h2 id="built-on">Built on THORChain and Cauldron</h2>
      <p>
        Cash Bridge is an interface, not a new network. <a href="https://thorchain.org" target="_blank" rel="noopener noreferrer">THORChain</a> swaps native assets between chains without wrapping them. <a href="https://cauldron.quest" target="_blank" rel="noopener noreferrer">Cauldron</a> is an on-chain market for BCH and CashTokens on Bitcoin Cash. Cash Bridge finds the route across the two, builds the transactions, checks them, and follows them until the funds arrive.
      </p>
    </DocsArticle>
  )
}
