import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Shot, Step, Steps } from '@/components/docs/docs-ui'
import { BridgeConfig } from '@/config'

export const metadata: Metadata = {
  title: 'Use the Cashbridge Router',
  alternates: { canonical: '/docs/guides/cashbridge-router' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/guides/cashbridge-router"
      title="Use the Cashbridge Router"
      lead="The Cashbridge Router turns a two-signature transfer into one source signature. For contract orders, BCH lands in a per-order P2SH covenant that can only pay your token minimum or refund your BCH — the Router service chooses when to act, not where funds may go."
    >
      <Callout kind="warning" title="Contract orders vs Manual">
        When the Cashbridge Router returns a contract order (<code>apiVersion=2</code>), the cross-chain bridge pays BCH to a purchase covenant built from your terms. The Router key for that order can spend it only to pay you at least the quoted minimum, or to send BCH to your fallback (≤ 2,000 sats miner fee). After <code>refundAfter</code> (about three hours from order creation; Bitcoin Cash median time runs about an hour behind wall clock) anyone may send it back on the same terms. Manual mode keeps every step in your wallets. Start with a small amount.
      </Callout>

      <h2 id="what-it-does">What it does</h2>
      <ul>
        <li>
          The selector above the form has <strong>Manual</strong> and <strong>Cashbridge Router</strong>. Manual is the default; your choice is remembered in the browser.
        </li>
        <li>
          Forward transfers cover <strong>any Cauldron token</strong> (such as PUSD) and <strong>plain BCH</strong>. For plain BCH you can paste a receiving address instead of connecting a BCH wallet.
        </li>
        <li>
          The first leg may be <strong>THORChain</strong>, <strong>NEAR Intents</strong> or <strong>ShapeShift</strong> when they quote and the Router admits NEAR orders (ShapeShift&apos;s BCH quotes are NEAR Intents swaps). NEAR and ShapeShift use a plain deposit address; their BCH payout targets the order address. There is no Cashbridge covenant on that leg. ShapeShift&apos;s swap refunds later than NEAR&apos;s (about four hours); BCH that reaches the order after its refund time goes to your BCH fallback.
        </li>
        {BridgeConfig.routerSales ? (
          <li>
            Bridging a Cauldron token <strong>back from Bitcoin Cash</strong> can use a <strong>sale covenant</strong> when the service offers it: your BCH wallet sends the token to a P2SH sale contract. The Router may sell for at least the quoted minimum BCH and deposit it to the chosen bridge (THORChain&apos;s vault with the fixed destination memo, or a NEAR Intents or ShapeShift deposit address), or return the tokens. On ShapeShift the deposit is an exact amount and the rest comes back to your BCH address as plain BCH. After <code>refundAfter</code> (same median-time rule as purchase orders) anyone may return them.
          </li>
        ) : (
          <li>Bridging back from Bitcoin Cash stays Manual when Router sales are not offered; the Cashbridge Router option is greyed out for those routes.</li>
        )}
      </ul>

      <h2 id="sale-schema">Sale covenant schema</h2>
      <p>
        When Router sales are offered, reverse CashToken transfers use an <code>apiVersion=2</code> sale covenant. Your wallet sends the token in; the Router may sell for ≥ min BCH and deposit to the bridge address in the terms (with the fixed memo; on ShapeShift an exact amount, the rest back to you), or return the tokens; after three hours anyone can return them. Legacy P2PKH order addresses are a different model — temporary service custody, not this script.
      </p>

      <h2 id="custody-boundary">Custody boundary</h2>
      <table>
        <thead>
          <tr>
            <th>Piece</th>
            <th>Who / what</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Source deposit</td>
            <td>You sign in the source wallet. ERC-20 approval may be a separate transaction.</td>
          </tr>
          <tr>
            <td>Order contract (purchase)</td>
            <td>
              On-chain P2SH20 script: <code>convert</code>, <code>giveBack</code>, <code>expire</code>. Terms include recipient, fallback, token category, minimum and <code>refundAfter</code>.
            </td>
          </tr>
          <tr>
            <td>Cashbridge Router service</td>
            <td>Off-chain: verifies deposits, builds Cauldron trades, signs allowed unlocks, tracks status. Does not invent new destinations.</td>
          </tr>
          <tr>
            <td>Legacy P2PKH orders</td>
            <td>Historical / fallback model: temporary service custody of BCH. The published Router proof row used this model — it is not contract settlement.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="steps">Step by step</h2>
      <Steps>
        <Step title="Choose the Cashbridge Router">
          <p>
            Pick <strong>Cashbridge Router</strong>. A line under the selector says the bridge settles through the Router without a second user signature. Choose what to send and the token (or <strong>BCH</strong>) to receive.
          </p>
          <Shot name="router-selector" alt="The Manual and Cashbridge Router selector with Cashbridge Router chosen" caption="With the Cashbridge Router chosen, no second wallet signature is required from you." />
        </Step>

        <Step title="Say where the token goes">
          <p>
            Connect your BCH wallet, or paste a receiving address. Token payouts need a token-aware address (<code>bitcoincash:z…</code>). That address is also the fallback if the token cannot be bought.
          </p>
        </Step>

        <Step title="Review the order">
          <p>
            Prepare the order and open <strong>Confirm swap</strong>. Check:
          </p>
          <ul>
            <li>
              <strong>Minimum if converted</strong> — fixed when the order is created and encoded in the contract for covenant orders.
            </li>
            <li>
              <strong>BCH fallback</strong> — where BCH goes if the minimum cannot be met, less the miner fee.
            </li>
            <li>Which bridge won the quote compare (THORChain or NEAR Intents), when both were available.</li>
          </ul>
        </Step>

        <Step title="Sign once">
          <p>
            Approve the transfer in your source wallet. If the page loses the wallet answer, it does not send again on its own — use <strong>Already paid?</strong> rather than paying twice.
          </p>
        </Step>

        <Step title="Follow the order">
          <p>
            A row under the form follows it, and the <Link href="/scanner">scanner</Link> finds it by your wallet address. You can close the tab; the Router continues.
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
            <td>Your source transfer is in flight. The bridge has not paid BCH to the order yet.</td>
          </tr>
          <tr>
            <td>THORChain transfer in progress</td>
            <td>THORChain is swapping and sending BCH to the order address.</td>
          </tr>
          <tr>
            <td>Waiting for BCH confirmations</td>
            <td>BCH is seen on Bitcoin Cash; the service waits for the depth it requires.</td>
          </tr>
          <tr>
            <td>Preparing the token payout</td>
            <td>Deposit verified; the token purchase is being built and signed under the contract rules.</td>
          </tr>
          <tr>
            <td>Waiting for a trade meeting your minimum</td>
            <td>Pools cannot meet the minimum yet; retries continue until the conversion deadline.</td>
          </tr>
          <tr>
            <td>Payout submitted · verifying the chain</td>
            <td>Token transaction is in the network; receipt is provisional until six confirmations.</td>
          </tr>
          <tr>
            <td>Token payout confirmed</td>
            <td>Done. The token is at your address.</td>
          </tr>
          <tr>
            <td>BCH fallback confirmed</td>
            <td>Minimum could not be met in time. BCH went to the fallback, less the miner fee.</td>
          </tr>
          <tr>
            <td>Source refund reported by THORChain</td>
            <td>The bridge refunded your source asset. Check your source wallet (NEAR refunds are reported similarly).</td>
          </tr>
          <tr>
            <td>Operator review required</td>
            <td>The service will not settle automatically. Funds stay under the order rules while the operator looks.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="limits">What to keep in mind</h2>
      <ul>
        <li>One signature is not one transaction. There are still bridge, deposit and payout steps. The Cashbridge Router is not an atomic swap and does not guarantee a token payout — only the fixed minimum or a BCH refund under the order terms.</li>
        <li>The service limits how much BCH it will take across open orders. If an order is refused, use Manual.</li>
        <li>Delays are possible after outages or recovery. Do not send again.</li>
      </ul>
      <p>
        More in <Link href="/docs/security">Security and custody</Link>. Public explorer runs: <Link href="/docs/mainnet">Proof on mainnet</Link>.
      </p>
    </DocsArticle>
  )
}
