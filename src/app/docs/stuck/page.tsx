import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Step, Steps } from '@/components/docs/docs-ui'
import { AppConfig } from '@/config'

export const metadata: Metadata = {
  title: 'Transaction got stuck?',
  alternates: { canonical: '/docs/stuck' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/stuck"
      title="Transaction got stuck?"
      lead="A transfer either finishes or its coins come back to you, even when the Cashbridge Router stops, as long as you open the site again in the browser you used. Here is how to see where it is and what it waits for."
    >
      <Callout kind="warning" title="Do not send again">
        Paying a second time does not push the first transfer on. It starts a second one.
      </Callout>

      <h2 id="find">Find it</h2>
      <Steps>
        <Step title="Search the scanner">
          Paste your wallet address or a transaction hash into the <Link href="/scanner">scanner</Link>. It shows the step the transfer is on and links each transaction to an explorer.
        </Step>
        <Step title="Open the bridge page in the same browser">
          The <Link href="/bridge">bridge page</Link> reopens the progress screen and keeps following the transfer. It is also the page that sends coins back on its own, so leave it open while you wait. See <Link href="/docs/guides/track-a-transfer">Track a transfer</Link>.
        </Step>
      </Steps>

      <h2 id="router">Cashbridge Router transfers</h2>
      <p>
        Your coins wait at a contract made for that order. It can only pay you at least the quoted minimum of your token, or send the coins back to you. When the Router cannot buy at that minimum, it sends them back itself.
      </p>
      <h3 id="router-to-bch">To Bitcoin Cash</h3>
      <p>
        If the Router does not finish, the bridge page sends the BCH from the contract to your BCH fallback address once the order&apos;s refund time passes. That is about three hours after the order, and up to about four, because Bitcoin Cash counts time by the median of recent blocks, which runs about an hour behind the clock. There is nothing to sign: the contract allows this refund without any key, and the miner fee comes out of the BCH.
      </p>
      <h3 id="router-from-bch">From Bitcoin Cash</h3>
      <p>
        If the Router does not sell your tokens in time, any page of the site open in the same browser sends them back from the sale contract to your BCH address after the same refund time, as they came. Again there is nothing to sign.
      </p>
      <Callout kind="note" title="Operator review required">
        The Router found something it will not settle by itself. The coins stay at the order address and the page leaves them there. Open an issue on <a href={`${AppConfig.repoUrl}/issues`} target="_blank" rel="noopener noreferrer">GitHub</a> with the order&apos;s scanner link.
      </Callout>

      <h2 id="bridge">The cross-chain step</h2>
      <ul>
        <li>
          <strong>THORChain</strong> refunds a swap it cannot complete to the address that sent it, on the chain it came from. When THORChain pauses a chain, its <a href="https://thorchain.net/network" target="_blank" rel="noopener noreferrer">network page</a> shows it.
        </li>
        <li>
          <strong>NEAR Intents</strong> refunds a deposit it could not swap after its deadline: two hours on the way to Bitcoin Cash, four hours on the way back. <strong>ShapeShift</strong>&apos;s Bitcoin Cash route runs through NEAR Intents and refunds after about four hours. The refund goes to your source wallet, or as BCH to your BCH address when you bridge back.
        </li>
      </ul>

      <h2 id="manual">Manual transfers</h2>
      <p>
        In manual mode every step is a transaction in your own wallets, so nothing sits in a contract. If the BCH arrived but not the token, press <strong>Swap BCH → PUSD (2/2)</strong> on the progress screen, or keep the BCH. The <Link href="/docs/faq#during">FAQ</Link> covers the other messages.
      </p>

      <h2 id="other-device">On another device</h2>
      <p>
        The order&apos;s terms are saved in the browser that made it and with the Router. In another browser, or after clearing site data, the page cannot rebuild the refund, so wait for the Router or open an issue on <a href={`${AppConfig.repoUrl}/issues`} target="_blank" rel="noopener noreferrer">GitHub</a>. The funds stay at the contract until one of you sends them back.
      </p>
    </DocsArticle>
  )
}
