import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Shot, Step, Steps } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Use the Cashbridge Router',
  alternates: { canonical: '/docs/guides/cashbridge-router' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/guides/cashbridge-router"
      title="Use the Cashbridge Router"
      lead="The Cashbridge Router turns a two-signature transfer into one. You approve a single transaction in your source wallet. Cash Bridge receives the BCH from THORChain, buys PUSD on Cauldron and sends it to you."
    >
      <Callout kind="warning" title="Temporary custody">
        With the Cashbridge Router on, the service controls your BCH from the moment THORChain pays it until the PUSD payout, or a BCH refund, is sent. With it off, nobody but you ever holds your funds. If you are unsure, use manual mode, and always start with a small amount.
      </Callout>

      <h2 id="what-it-does">What it does</h2>
      <ul>
        <li>The switch sits above the form. It is off by default, and your choice is remembered in the browser.</li>
        <li>It covers transfers to <strong>PUSD</strong> and to <strong>plain BCH</strong>. For plain BCH nothing changes in how the transfer runs, but you can pay a pasted address instead of connecting a wallet.</li>
        <li>It is not available for other CashTokens or for bridging back from Bitcoin Cash. The switch is greyed out and a tooltip says so; those routes are signed in your own wallets.</li>
      </ul>
      <Shot name="router-tooltip" alt="The Cashbridge Router switch with its tooltip explaining that you sign once in your source wallet" caption="Hover the switch for a short explanation of both modes." />

      <h2 id="steps">Step by step</h2>
      <Steps>
        <Step title="Turn the Cashbridge Router on">
          <p>
            Switch on <strong>Cashbridge Router</strong>. Choose what to send and keep <strong>PUSD</strong> (or <strong>BCH</strong>) as what you receive.
          </p>
          <Shot name="router-on" alt="The form with the Cashbridge Router switch on and a Connect BCH wallet button with a dropdown arrow" caption="With the Cashbridge Router on, the BCH wallet button gains a menu for pasting an address." />
        </Step>

        <Step title="Say where the PUSD goes">
          <p>
            Connect your BCH wallet as usual, or open the menu on the BCH button and choose <strong>Paste wallet address</strong>. A pasted PUSD address must be a token-aware one, which many wallets show separately and which starts with <code>bitcoincash:z</code>. A plain <code>bitcoincash:q</code> address is refused, and so is anything that is not a Bitcoin Cash address. Receiving needs no signature from that wallet, and the same address is the fallback if the PUSD cannot be bought.
          </p>
        </Step>

        <Step title="Review the order">
          <p>
            Press the main button to prepare the order and open <strong>Confirm swap</strong>. In addition to the usual details it shows:
          </p>
          <ul>
            <li>
              <strong>Minimum if converted</strong>: the least PUSD the service may pay you. It is fixed when the order is created.
            </li>
            <li>
              <strong>BCH fallback</strong>: the address that receives the BCH if the minimum cannot be met, less the miner fee.
            </li>
            <li>A reminder that the service temporarily controls the BCH.</li>
          </ul>
          <p>If the price impact is high you must tick a box to accept it. Litecoin routes ask for a second acknowledgement because they take longer to confirm.</p>
        </Step>

        <Step title="Sign once">
          <p>
            Approve the transfer in your source wallet. An ERC-20 token such as USDC may need a separate approval transaction first. After that you do not need to touch the BCH wallet.
          </p>
          <p>
            If the page loses the answer of your wallet, it does not send again on its own. If you already paid and the order does not show it, use <strong>Already paid? Add the source transaction ID</strong> on the order. Never pay twice.
          </p>
        </Step>

        <Step title="Follow the order">
          <p>
            The order appears under <strong>History</strong> as an <em>Automatic transfer</em> with a state. You can close the tab, because the service continues the order on its own. Open the site again in the same browser to see the result.
          </p>
        </Step>
      </Steps>

      <h2 id="states">States of an automatic transfer</h2>
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>What it means</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Waiting for BCH</td>
            <td>Your source transfer is being processed. THORChain has not paid BCH yet.</td>
          </tr>
          <tr>
            <td>THORChain transfer in progress</td>
            <td>THORChain is swapping and sending the BCH to the order address.</td>
          </tr>
          <tr>
            <td>Waiting for BCH confirmations</td>
            <td>The BCH is seen on Bitcoin Cash. The service is waiting for the depth it requires.</td>
          </tr>
          <tr>
            <td>Preparing PUSD payout</td>
            <td>The BCH is verified and the PUSD purchase is being built and signed.</td>
          </tr>
          <tr>
            <td>Waiting for a trade meeting your minimum</td>
            <td>The pools cannot give you the minimum right now. The service retries until the conversion deadline shown on the order.</td>
          </tr>
          <tr>
            <td>Payout submitted · verifying the chain</td>
            <td>The PUSD transaction is in the network. The receipt is provisional until it has six confirmations.</td>
          </tr>
          <tr>
            <td>PUSD payout confirmed</td>
            <td>Done. The PUSD is at your address.</td>
          </tr>
          <tr>
            <td>BCH fallback confirmed</td>
            <td>The minimum could not be met in time. Your BCH was sent to the fallback address, less the miner fee.</td>
          </tr>
          <tr>
            <td>Source refund reported by THORChain</td>
            <td>THORChain could not complete the swap and refunded your source asset. Check your source wallet.</td>
          </tr>
          <tr>
            <td>Operator review required</td>
            <td>The service found something it will not settle automatically. The funds stay safe at the order address while the operator looks.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="limits">What to keep in mind</h2>
      <ul>
        <li>One signature is not one transaction. There are still a THORChain transfer, a BCH deposit and a payout. The Cashbridge Router does not make the transfer atomic and does not guarantee a PUSD payout, only the fixed minimum or a BCH refund.</li>
        <li>The service limits how much BCH it holds for open orders. If an order is refused, use manual mode.</li>
        <li>
          Delays are possible. A node outage or a recovery pass can postpone a payout or a refund. The order page says when the service is catching up; do not send again.
        </li>
      </ul>
      <p>
        More about what the service can and cannot do is in <Link href="/docs/security">Security and custody</Link>.
      </p>
    </DocsArticle>
  )
}
