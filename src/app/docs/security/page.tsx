import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Security and custody',
  alternates: { canonical: '/docs/security' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/security"
      title="Security and custody"
      lead="Who can touch your funds depends on the mode. In manual mode only you can. With the Cashbridge Router, the service holds the BCH for a short time. Both modes rely on THORChain and Cauldron."
    >
      <h2 id="manual">Manual mode: you stay in control</h2>
      <p>
        With the Cashbridge Router off, which is the default, Cash Bridge never holds funds and never sees a private key.
      </p>
      <ul>
        <li>Your wallets sign every transaction. Cash Bridge builds the request, and your wallet shows it before you approve.</li>
        <li>THORChain pays the BCH straight to an address in your BCH wallet.</li>
        <li>The Cauldron swap is built in your browser and signed by your BCH wallet. Cash Bridge reviews every output of it before you sign, and checks the result carries signatures by your key on your own inputs only, before anything is broadcast.</li>
      </ul>

      <h2 id="router">The Cashbridge Router: short custody</h2>
      <Callout kind="warning" title="With the Cashbridge Router on, the service controls your BCH for a while">
        From the moment THORChain pays the BCH to the order address until the PUSD payout, or a BCH refund, is sent, the keys for that address are held by Cash Bridge&apos;s own server. If the server or its operator failed in that window, the funds could be delayed or lost.
      </Callout>
      <p>This is what the service does and what it is built to avoid:</p>
      <ul>
        <li>Each order gets its own deposit address, and a fixed minimum of PUSD that is stored when the order is created.</li>
        <li>It verifies on the Bitcoin Cash chain that the BCH really arrived before it acts.</li>
        <li>If the minimum cannot be met before the conversion deadline, it sends the BCH to your fallback address, less the miner fee.</li>
        <li>Signed transactions are written down before they are sent, so a restart replays the same transaction and never builds a second payout.</li>
        <li>An order that the service cannot settle safely is held for the operator to review. It does not trigger a second automatic payout.</li>
        <li>The service limits how much BCH it holds across open orders.</li>
      </ul>
      <p>
        The web app talks to the service only through a narrow, authenticated connection. It never receives the service&apos;s wallet. Delays are possible after outages or recovery. If an order does not move, do not pay again. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
      </p>

      <h2 id="data">What the site stores and sees</h2>
      <ul>
        <li>
          <strong>In your browser.</strong> Your transfer records, wallet reconnection data and settings such as the Cashbridge Router switch. Cash Bridge has no accounts, and in manual mode the history of your transfers lives only there.
        </li>
        <li>
          <strong>On the server.</strong> Quote and status requests pass through Cash Bridge&apos;s server on their way to THORChain, so the server and THORChain can see the amounts and addresses in them. A Cashbridge Router order is also stored by the service, with the addresses you gave it.
        </li>
        <li>
          <strong>Wallet connections.</strong> Pairing with a BCH wallet goes through a relay. WizardConnect and WalletConnect use their own relay servers to pass the messages between the page and your wallet.
        </li>
      </ul>

      <h2 id="third-parties">What you rely on</h2>
      <ul>
        <li>
          <strong>THORChain</strong> holds the funds during a swap and can pause an asset or refund a swap. A fault in the protocol would affect any bridge built on it.
        </li>
        <li>
          <strong>Cauldron</strong> pools and their covenants decide the price and the payout of the token swap. Cash Bridge builds the transaction from live pools and checks each pool is still unspent, but it does not control them.
        </li>
        <li>
          <strong>Your wallets and chains.</strong> A compromised wallet or a congested chain is outside Cash Bridge&apos;s control.
        </li>
      </ul>

      <h2 id="stay-safe">Staying safe</h2>
      <ul>
        <li>Check the address in the browser bar: <strong>www.cashbridge.space</strong>. Bookmark it.</li>
        <li>Cash Bridge never asks for a seed phrase, a private key or a password. Nobody working on it will either.</li>
        <li>Read what your wallet shows before you approve. Amounts and addresses should match what you saw on the confirmation screen.</li>
        <li>Blockchain transfers cannot be reversed. A wrong address or a paste into the wrong field means lost funds.</li>
        <li>Start with a small amount, especially with the Cashbridge Router, until you know the flow.</li>
      </ul>
      <p>
        Cash Bridge is new software. Treat it that way. For wallet messages and what to do about them, see <Link href="/docs/faq">FAQ and troubleshooting</Link>.
      </p>
    </DocsArticle>
  )
}
