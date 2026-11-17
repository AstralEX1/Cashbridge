import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsArticle } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'FAQ and troubleshooting',
  alternates: { canonical: '/docs/faq' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/faq"
      title="FAQ and troubleshooting"
      lead="Short answers to the questions that come up most, and what to do when a step does not go as expected."
    >
      <h2 id="basics">The basics</h2>

      <details>
        <summary>What is PUSD, and what is a category id?</summary>
        <div>
          <p>
            PUSD is a dollar-pegged token on Bitcoin Cash. Tokens on Bitcoin Cash are called CashTokens, and each one is identified by a category id. The category id of PUSD is <code>2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544</code>. You can search the picker by ticker or by category id, and the same id tells you which token you are looking at when two tokens share a ticker.
          </p>
        </div>
      </details>

      <details>
        <summary>How long does a transfer take?</summary>
        <div>
          <p>
            Usually a few minutes. Most of the time is the THORChain swap. The Bitcoin Cash steps are quick, because Cash Bridge counts a transaction as done once it is in the network&apos;s mempool. Routes from slower chains, such as Litecoin, take longer. The confirmation screen shows an estimate.
          </p>
        </div>
      </details>

      <details>
        <summary>Does Cash Bridge charge a fee?</summary>
        <div>
          <p>
            No. The networks and pools underneath it do. See <Link href="/docs/fees">Fees and limits</Link>.
          </p>
        </div>
      </details>

      <details>
        <summary>Which wallets can I use?</summary>
        <div>
          <p>
            Browser and hardware wallets for the source chain, and Selene, Paytaca or Cashonize for Bitcoin Cash. Details and pairing steps are in <Link href="/docs/wallets">Wallets</Link>.
          </p>
        </div>
      </details>

      <h2 id="before">Before sending</h2>

      <details>
        <summary>An asset is greyed out, or the page says trading is halted</summary>
        <div>
          <p>
            THORChain has paused trading in that asset or on its whole network. Hover over it to see why. Your funds are not affected. Pick another asset or try again later, and follow the status on THORChain&apos;s <a href="https://thorchain.net/network" target="_blank" rel="noopener noreferrer">network page</a>.
          </p>
        </div>
      </details>

      <details>
        <summary>The page says Minimum is X, or No route for this amount right now</summary>
        <div>
          <p>
            Each route has a smallest amount THORChain accepts, so a very small amount cannot be sent. A very large amount may have no route because the pools lack the depth. Change the amount, or choose another asset.
          </p>
        </div>
      </details>

      <details>
        <summary>The page says one PUSD costs more than $1</summary>
        <div>
          <p>
            The Cauldron pools are pricing PUSD away from its peg at this moment, and the form shows the rate. You can wait for the pools to recover, send a smaller amount, or ask for BCH and decide when it arrives.
          </p>
        </div>
      </details>

      <details>
        <summary>The pasted address is refused</summary>
        <div>
          <p>
            An address for PUSD or another token must accept CashTokens. Many Bitcoin Cash wallets show a separate token address for that purpose. Copy the token address (it starts with <code>bitcoincash:z</code>), not the plain one. Addresses of other chains, such as Ethereum or Solana, and old-style <code>1…</code> addresses are refused too: the field turns red and the button stays disabled.
          </p>
        </div>
      </details>

      <h2 id="during">During a transfer</h2>

      <details>
        <summary>The BCH arrived, but not the PUSD</summary>
        <div>
          <p>
            In manual mode the BCH to PUSD swap is a second transaction that you sign in your BCH wallet. Press <strong>Swap BCH → PUSD (2/2)</strong> on the progress screen, or open <strong>History</strong> and continue the transfer from there. If you press <strong>Keep BCH instead</strong>, the BCH stays in your wallet and the transfer ends.
          </p>
        </div>
      </details>

      <details>
        <summary>The quote expired, or the page says the received BCH is no longer unspent</summary>
        <div>
          <p>
            A Cauldron quote is valid for a short time. Ask for a new one. If the BCH from THORChain was spent in the meantime, for example moved from the same wallet, the swap cannot use it. Check your wallet&apos;s history.
          </p>
        </div>
      </details>

      <details>
        <summary>The page says the amount is too small to cover the swap fees</summary>
        <div>
          <p>
            The BCH you received cannot pay for the token swap&apos;s miner fee and still buy anything. Keep the BCH, or start again with a larger amount.
          </p>
        </div>
      </details>

      <details>
        <summary>I closed the tab. Is the transfer lost?</summary>
        <div>
          <p>
            No. THORChain continues on its own, and Cash Bridge keeps the record in your browser. Open the site again in the same browser. A transfer that needs a BCH signature asks you to connect the BCH wallet that received the BCH. See <Link href="/docs/guides/track-a-transfer">Track a transfer</Link>.
          </p>
        </div>
      </details>

      <details>
        <summary>My history is empty on another device</summary>
        <div>
          <p>
            The record lives in one browser. On another device or in a private window it is not there. The transactions themselves are on the chain: use your wallet&apos;s history and the explorer links to follow them.
          </p>
        </div>
      </details>

      <details>
        <summary>THORChain refunded my transfer</summary>
        <div>
          <p>
            THORChain refunds when it cannot complete a swap, for example when the price moved past your max slippage. The refund goes back to the address that sent it, on the chain it came from. Cash Bridge marks the transfer as <em>Refunded by THORChain</em>. You can raise the max slippage in the settings and try again. See <Link href="/docs/fees#slippage">Price impact and slippage</Link>.
          </p>
        </div>
      </details>

      <h2 id="wallet-messages">Wallet messages</h2>

      <details>
        <summary>You declined it, or Cancelled. Nothing was sent</summary>
        <div>
          <p>
            You rejected the request in the wallet, or pressed Cancel on the page. Nothing was broadcast. Start the step again.
          </p>
        </div>
      </details>

      <details>
        <summary>The wallet did not answer in time</summary>
        <div>
          <p>
            Your BCH wallet is given three minutes, then the request is withdrawn from it. Nothing was sent. Open the wallet app first, then try again.
          </p>
        </div>
      </details>

      <details>
        <summary>The request did not reach the wallet, or the connection has ended</summary>
        <div>
          <p>
            Open the wallet app and try again. If it still fails, disconnect and connect the wallet again, with a new QR code if needed. Nothing was sent.
          </p>
        </div>
      </details>

      <details>
        <summary>The page says the wallet is not the one bound to the operation</summary>
        <div>
          <p>
            An unfinished transfer can only be signed by the BCH wallet that received its BCH. Connect that wallet and the same account.
          </p>
        </div>
      </details>

      <details>
        <summary>The page lost my wallet&apos;s answer and says the status is unknown</summary>
        <div>
          <p>
            Look in your wallet&apos;s own history to see whether the transaction was sent. If it was, paste its hash into <strong>Track this transaction</strong>. If it was not, confirm that nothing was sent and start again. Cash Bridge never resends a transaction on its own.
          </p>
        </div>
      </details>

      <h2 id="router">The Cashbridge Router</h2>

      <details>
        <summary>The Cashbridge Router option is greyed out</summary>
        <div>
          <p>
            It works for transfers to PUSD and to plain Bitcoin Cash. Other CashTokens, and every transfer back from Bitcoin Cash, are signed in your own wallets.
          </p>
        </div>
      </details>

      <details>
        <summary>The page says a source authorization has already started</summary>
        <div>
          <p>
            Your wallet may already have sent the transfer, and the page is still checking. Do not pay again. If the order does not show the payment, use <strong>Already paid? Add the source transaction ID</strong> on it.
          </p>
        </div>
      </details>

      <details>
        <summary>I received BCH instead of PUSD</summary>
        <div>
          <p>
            The Cashbridge Router could not buy PUSD at or above the minimum shown on the order before its deadline, so it sent the verified BCH to your fallback address, less the miner fee. The order shows <em>BCH fallback confirmed</em>. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
          </p>
        </div>
      </details>

      <details>
        <summary>The order shows Operator review required</summary>
        <div>
          <p>
            The service found something it will not settle by itself. The funds stay at the order address while the operator looks at it, and nothing is paid out twice. Do not send again.
          </p>
        </div>
      </details>

      <h2 id="devices">Devices</h2>

      <details>
        <summary>Can I use Cash Bridge on a phone?</summary>
        <div>
          <p>
            Yes. In a normal mobile browser, MetaMask shows <strong>Open app</strong> and opens the site inside the MetaMask app. For a Bitcoin Cash wallet, press <strong>Open wallet</strong> in the WalletConnect dialog, or copy the link into the wallet. The side menu of the docs collapses into a <strong>Menu</strong> button.
          </p>
        </div>
      </details>
    </DocsArticle>
  )
}
