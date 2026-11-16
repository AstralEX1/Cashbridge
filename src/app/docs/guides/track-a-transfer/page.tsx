import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Shot } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Track a transfer',
  alternates: { canonical: '/docs/guides/track-a-transfer' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/guides/track-a-transfer"
      title="Track a transfer"
      lead="While a transfer runs, the progress screen shows where it is. Afterwards, History and the explorer links let you check it again."
    >
      <h2 id="progress">The progress screen</h2>
      <p>
        A transfer with two steps has two bars. A bar fills while its step runs and turns green with a check when the step is done. The label shows the time left, and a small arrow on a bar opens that step&apos;s transaction in an explorer. The <strong>History</strong> button at the top lists your recent transfers, and the cross closes the screen without cancelling anything.
      </p>
      <Shot name="progress-swapping" alt="The progress screen during the second step: Bridge done, Swap (2/2) at 40 seconds left" size="lg" caption="The bridge is done and the swap is running." />

      <h2 id="notifications">Transaction cards</h2>
      <p>
        Every transaction you sign or that follows from it shows up as a card in the bottom right corner. A ring turns around the token while the network confirms it. When it is through, the card says <em>Transaction complete</em> and links to the explorer.
      </p>
      <Shot name="toasts" alt="Three transaction cards: PUSD swap sent, BCH received and Send Tx confirmed" size="sm" caption="Cards for the swap, the BCH arrival and the source transfer." />

      <h2 id="stages">What the stages mean</h2>
      <table>
        <thead>
          <tr>
            <th>Message</th>
            <th>What it means</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Waiting for your source wallet</td>
            <td>Cash Bridge has asked your wallet to sign and has not seen an answer yet.</td>
          </tr>
          <tr>
            <td>THORChain swap to BCH in progress</td>
            <td>The source transfer is on its chain and THORChain is working on it.</td>
          </tr>
          <tr>
            <td>BCH received, waiting for confirmation</td>
            <td>The BCH is in the mempool. For the Cauldron swap this is enough.</td>
          </tr>
          <tr>
            <td>BCH received: ready for the token swap</td>
            <td>Your turn. Sign the second swap in your BCH wallet, or keep the BCH.</td>
          </tr>
          <tr>
            <td>Token swap broadcast, waiting for confirmation</td>
            <td>The Cauldron swap is in the network.</td>
          </tr>
          <tr>
            <td>Completed</td>
            <td>The funds are where you asked for them.</td>
          </tr>
          <tr>
            <td>Finished: you kept the BCH</td>
            <td>You chose not to do the token swap. The BCH is in your wallet.</td>
          </tr>
          <tr>
            <td>Refunded by THORChain</td>
            <td>THORChain did not complete the swap and returned the funds.</td>
          </tr>
          <tr>
            <td>Stopped</td>
            <td>The transfer did not complete. The message on the screen says why.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="after-closing">Coming back later</h2>
      <p>
        Cash Bridge stores each transfer in your browser. Open the site again in the same browser and the transfer is still there, with its current state read from the chains. A transfer that expects a BCH signature is bound to the BCH wallet that started it, so reconnect that same wallet and account to continue.
      </p>
      <Callout kind="warning" title="The record is local">
        Clearing the site data of your browser removes the record. It does not remove your funds. You can always follow a transaction in an explorer with its hash, and Cash Bridge can pick up a THORChain transfer if you paste its source transaction hash.
      </Callout>

      <h2 id="unknown">When the wallet gave no answer</h2>
      <p>
        If the page loses your wallet&apos;s answer, it cannot tell whether the transaction was sent and says so. Check your wallet&apos;s own history. Cash Bridge will not send it again by itself. If the transaction is there, paste its hash into <strong>Track this transaction</strong> and the transfer continues. If it is not, choose <strong>Nothing was sent</strong> to close the transfer and start a new one.
      </p>
      <p>
        If the Cauldron swap shows <em>broadcast unconfirmed</em>, the transaction may still be in the network. Cash Bridge keeps checking by its transaction id, and re-sending the same signed transaction is safe.
      </p>

      <p>
        Stuck or unsure? <Link href="/docs/faq">FAQ and troubleshooting</Link> has the common cases.
      </p>
    </DocsArticle>
  )
}
