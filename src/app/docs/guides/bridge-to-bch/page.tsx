import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Shot, Step, Steps } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Bridge to Bitcoin Cash or PUSD',
  alternates: { canonical: '/docs/guides/bridge-to-bch' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/guides/bridge-to-bch"
      title="Bridge to Bitcoin Cash or PUSD"
      lead="This guide walks through a transfer with the Cashbridge Router off, which is the default. You sign each step in your own wallets. The example sends USDC on Ethereum and receives PUSD."
    >
      <h2 id="before-you-start">Before you start</h2>
      <ul>
        <li>The asset you want to send, in a wallet that Cash Bridge supports, plus a little of that chain&apos;s native coin for the network fee. USDC on Ethereum needs some ETH.</li>
        <li>A Bitcoin Cash wallet that supports CashTokens if you are receiving PUSD: Selene, Paytaca or Cashonize. You do not need BCH in it beforehand; the miner fee for the swap is taken from the BCH you receive.</li>
        <li>
          A small test amount if this is your first time. See <Link href="/docs/fees">Fees and limits</Link> for what a transfer costs.
        </li>
      </ul>

      <Steps>
        <Step title="Choose what to send">
          <p>
            Select <strong>Bridge from</strong>. Pick a chain first, then a token on that chain. The search box finds a token by name.
          </p>
          <Shot name="picker-from" alt="The Bridge from picker with Base selected and its ETH, USDC and VVV tokens listed" caption="Chains on top, the tokens of the selected chain below." />
          <p>If an asset is greyed out, THORChain has paused trading for it. Funds are not affected. Try again later or pick another asset.</p>
        </Step>

        <Step title="Choose what to receive">
          <p>
            Select <strong>Bridge to</strong>. <strong>PUSD</strong> is the default. Pick <strong>BCH</strong> for plain Bitcoin Cash or any other CashToken from the list. You can search by ticker or by category id.
          </p>
          <Shot name="picker-to" alt="The Bridge to picker with Bitcoin Cash selected and BCH, PUSD, RES, NWB, MUSD and other tokens listed" caption="Bitcoin Cash is the only destination chain. Its tokens come from Cauldron." />
        </Step>

        <Step title="Enter an amount">
          <p>
            Type the amount to send. Below it you see the estimated amount you will receive and, next to it, the price impact. The square button with a ring at the top right, next to the sliders, counts down to the next refresh of the quote and your wallet balances; press it to refresh them now. Hover over the amount to get 25%, 50%, 75% and MAX shortcuts once your wallet&apos;s balance is known.
          </p>
          <Shot name="form-forward" alt="The form with 25 USDC on Ethereum and an estimate of 24.63 PUSD" caption="25 USDC is estimated at about 24.63 PUSD. The estimate is not a promise; the minimum you accept is shown before you sign." />
          <p>
            To change how far the price may move against you before the swap is refunded, open the sliders button at the top right. The default is 1%. See <Link href="/docs/fees#slippage">Price impact and slippage</Link>.
          </p>
        </Step>

        <Step title="Connect your wallets">
          <p>
            Use <strong>Connect wallet</strong> on the sending side and <strong>Connect BCH wallet</strong> on the receiving side. The main button at the bottom of the form shows which one is still missing.
          </p>
          <Shot name="connect-bch" alt="The Connect BCH wallet dialog offering Selene over WizardConnect and Paytaca or Cashonize over WalletConnect" size="md" caption="Choose how your BCH wallet connects. Selene uses WizardConnect, Paytaca and Cashonize use WalletConnect." />
          <p>
            Wallets reconnect on their own the next time you visit. Details for each wallet are in <Link href="/docs/wallets">Wallets</Link>.
          </p>
        </Step>

        <Step title="Review and send the first transaction">
          <p>
            Press the main button to open <strong>Confirm swap</strong>. It lists the route as numbered transactions, for example <strong>1/2 Bridge USDC → BCH</strong> signed now in your Ethereum wallet and <strong>2/2 Swap BCH → PUSD</strong> signed later in your BCH wallet. It also shows the estimated time, the <strong>minimum received</strong>, gas and the price impact.
          </p>
          <p>
            Check the minimum, then press <strong>Send … (1/2)</strong> and approve in your wallet. A token such as USDC needs an approval first; the button then reads <strong>Approve USDC</strong> and your wallet asks for the approval before the transfer.
          </p>
        </Step>

        <Step title="Wait for the bridge">
          <p>
            The progress screen follows the THORChain swap. The first bar fills while THORChain works, and each transaction appears as a card in the corner with a link to its explorer page.
          </p>
          <Shot name="progress-bridging" alt="The progress screen with Bridge (1/2) in progress and Swap (2/2) waiting" size="lg" caption="Step 1 of 2 in progress. Amounts here are examples." />
          <p>
            You can leave the tab open or close it. Cash Bridge keeps the record in your browser, so coming back in the same browser picks the transfer up where it stopped.
          </p>
        </Step>

        <Step title="Swap the BCH for PUSD">
          <p>
            When the BCH arrives, the screen shows the second swap with its rate, fees, price impact and the <strong>minimum received</strong>. Press <strong>Swap BCH → PUSD (2/2)</strong> and approve it in your BCH wallet. The quote is valid for a short time. If it expires, ask for a new one.
          </p>
          <Shot name="progress-ready" alt="The second step: BCH received, with Cauldron swap details and the Swap BCH to PUSD button" size="lg" caption="The BCH is in your wallet. Swap it for PUSD, or choose Keep BCH instead." />
          <Callout kind="tip">
            The second swap is optional. <strong>Keep BCH instead</strong> ends the transfer with the BCH in your wallet. Choosing <strong>BCH</strong> as the destination in step 2 skips the second swap altogether.
          </Callout>
        </Step>

        <Step title="Check the receipt">
          <p>
            A finished transfer shows what you received and the transactions behind it, each with a link to an explorer. <strong>Provide liquidity</strong> opens Cauldron if you want to earn fees on the token. <strong>New transfer</strong> clears the screen.
          </p>
          <Shot name="receipt-pusd" alt="The receipt screen: Received 1.01 PUSD, with the three transactions listed" caption="The receipt for a transfer from Base to PUSD. Amounts here are examples." />
          <p>
            Sent plain BCH? The receipt is the same but lists two transactions, and the <strong>Swap on Cauldron</strong> line is not there.
          </p>
          <Shot name="receipt-bch" alt="The receipt screen: Received 0.0072956 BCH, with two transactions listed" size="sm" />
        </Step>
      </Steps>

      <h2 id="if-something-goes-wrong">If something goes wrong</h2>
      <p>
        Most problems are a wallet that did not answer, a paused asset or an amount that is too small. <Link href="/docs/faq">FAQ and troubleshooting</Link> covers them, and <Link href="/docs/guides/track-a-transfer">Track a transfer</Link> explains each state you may see.
      </p>
    </DocsArticle>
  )
}
