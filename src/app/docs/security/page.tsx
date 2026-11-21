import type { Metadata } from 'next'
import Link from 'next/link'
import { ExitMap } from '@/components/docs/contract-figures'
import { Callout, DocsArticle } from '@/components/docs/docs-ui'
import { LOGO } from '@/components/docs/route-scenes'

export const metadata: Metadata = {
  title: 'Security and custody',
  alternates: { canonical: '/docs/security' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/security"
      title="Security and custody"
      lead="Who can touch your funds depends on the mode and on the order the service returns. Manual: your wallets sign every step. Cashbridge Router contract orders: a per-order P2SH covenant that can only pay you or refund you under its terms. Legacy Router orders used temporary P2PKH custody. Cross-chain legs still rely on THORChain, NEAR Intents or ShapeShift (Any network), and on Cauldron for CashTokens."
    >
      <h2 id="manual">Manual mode: you stay in control</h2>
      <p>With the Cashbridge Router off (the default), Cash Bridge never holds funds and never sees a private key.</p>
      <ul>
        <li>Your wallets sign every transaction. Cash Bridge builds the request; your wallet shows it before you approve.</li>
        <li>THORChain or NEAR Intents pays BCH straight to an address in your BCH wallet. NEAR uses a plain one-use deposit address — there is no Cashbridge contract on that leg.</li>
        <li>The Cauldron swap is built in your browser and signed by your BCH wallet. Cash Bridge reviews outputs before you sign and checks that the result only carries your signatures on your inputs before broadcast.</li>
      </ul>

      <h2 id="router">Cashbridge Router: contract orders</h2>
      <Callout kind="warning" title="The contract guarantees your minimum, not the best price">
        For <code>apiVersion=2</code> purchase orders, the bridge pays BCH to a P2SH20 contract built from your order terms. Only the Router key for that order (and, on orders your page can settle itself, a one-use key the page made) can spend early, and only to pay you at least the quoted minimum of your token (<code>convert</code>; a coin smaller than quoted must buy its share of that minimum) or to send BCH to your fallback (<code>giveBack</code>, ≤ 2,000 sats miner fee). The contract checks that one payout: BCH the trade does not need goes where the signing key sends it, so above your minimum you trust the Router. After <code>refundAfter</code> — set about three hours from order creation; Bitcoin Cash median time runs about an hour behind wall clock — anyone may <code>expire</code> on the same refund terms.
      </Callout>

      <ExitMap
        input={{ logo: LOGO.bch, label: 'BCH from the bridge', sub: 'THORChain, NEAR Intents or ShapeShift' }}
        title="Order contract"
        sub="one per order · P2SH20"
        exits={[
          { fn: 'convert', who: 'keys', when: 'any time', logo: LOGO.pusd, result: 'The token, to you', detail: 'at least the floor', tone: 'pay' },
          { fn: 'giveBack', who: 'keys', when: 'any time', logo: LOGO.bch, result: 'The BCH, to your fallback', detail: 'at most 2,000 sats to the miner', tone: 'back' },
          { fn: 'expire', who: 'anyone', when: 'after the refund time', logo: LOGO.bch, result: 'The BCH, to your fallback', detail: 'same terms, no signature needed', tone: 'back' }
        ]}
        caption={
          <>
            Every way out of an order contract pays you. The <Link href="/docs/smart-contracts">Smart contracts</Link> page walks through the terms, the keys, the floor
            and the sale contracts.
          </>
        }
      />

      <p>What the service does, and what the contract prevents:</p>
      <ul>
        <li>Each contract order gets its own script: recipient, fallback, token category, minimum and refund time. The page rebuilds the contract from the public order fields and refuses any other deposit address.</li>
        <li>It verifies on Bitcoin Cash that BCH arrived before it acts.</li>
        <li>If the minimum cannot be met before the conversion deadline, it refunds BCH to your fallback (less the miner fee), within the covenant.</li>
        <li>Signed transactions are recorded before send, so a restart replays the same bytes and does not build a second payout.</li>
        <li>Unsafe cases go to operator review instead of a second automatic payout.</li>
        <li>Open-order BCH exposure is limited by the service.</li>
      </ul>

      <h3 id="sale-contracts">Sale contracts (reverse)</h3>
      <p>
        When Router sales are offered, a reverse CashToken transfer uses a sale covenant: your wallet sends the token in; the Router may sell for ≥ min BCH and deposit to the bridge address fixed in the contract (THORChain&apos;s vault with the memo, or a NEAR Intents or ShapeShift deposit address the Router checks at 1Click first), or return the tokens; after <code>refundAfter</code> (same median-time rule) anyone may return them. The THORChain and NEAR Intents sale paths each have a mainnet run in <Link href="/docs/mainnet">Proof on mainnet</Link>; the ShapeShift sale path has been tested against simulated networks only. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
      </p>

      <h3 id="legacy">Legacy P2PKH orders</h3>
      <p>
        Older Router orders used a P2PKH order address: temporary service custody of BCH, with no purchase covenant. The two oldest Router rows in <Link href="/docs/mainnet">Proof on mainnet</Link> used this model; the later Router rows there settled through the P2SH contracts.
      </p>

      <h2 id="near">NEAR Intents and custody</h2>
      <p>
        NEAR Intents never places funds in a Cashbridge contract on the source chain. You (or the Router&apos;s tracking of your order) rely on 1Click&apos;s deposit address and on reading the BCH payout on Bitcoin Cash. When NEAR feeds a Router order, the covenant (if any) begins only once BCH sits at the order address.
      </p>

      <h2 id="mcp">MCP agents</h2>
      <p>
        The MCP server at <code>https://www.cashbridge.space/mcp</code> holds no keys. It quotes, prepares unsigned deposits for the user to sign (THORChain, NEAR Intents, ShapeShift, Cashbridge Router purchase and sale), and reads status. See <Link href="/docs/agents">AI agents</Link>.
      </p>

      <h2 id="data">What the site stores and sees</h2>
      <ul>
        <li>
          <strong>In your browser.</strong> Transfer records, wallet reconnection data, Manual / Cashbridge Router choice. No accounts; Manual history lives only there.
        </li>
        <li>
          <strong>The page key.</strong> A contract order your page can settle keeps its one-use key in this browser while the order runs. A leaked key could at most sell at your minimum or send the BCH back to you. The page erases it once the order is done and no BCH is left at the contract, and every page runs only scripts served with its own nonce (a strict Content Security Policy), so injected code cannot read it.
        </li>
        <li>
          <strong>On the server.</strong> Quote and status requests may pass through Cash Bridge&apos;s server. Router orders are stored by the service with the addresses you gave it.
        </li>
        <li>
          <strong>Wallet connections.</strong> WizardConnect and WalletConnect use their own relays between the page and your wallet.
        </li>
      </ul>

      <h2 id="third-parties">What you rely on</h2>
      <ul>
        <li>
          <strong>THORChain</strong>, <strong>NEAR Intents</strong> and <strong>ShapeShift</strong> hold or route funds during a cross-chain swap and can refund or pause. A fault there affects any interface built on them.
        </li>
        <li>
          <strong>Cauldron</strong> pools set CashToken prices. Cash Bridge builds from live pools but does not control them.
        </li>
        <li>
          <strong>Your wallets and chains.</strong> Compromised wallets or congested networks are outside Cash Bridge&apos;s control.
        </li>
      </ul>

      <h2 id="stay-safe">Staying safe</h2>
      <ul>
        <li>
          Check the address bar: <strong>www.cashbridge.space</strong>. Bookmark it.
        </li>
        <li>Cash Bridge never asks for a seed phrase, private key or password.</li>
        <li>Read what your wallet shows before you approve.</li>
        <li>Blockchain transfers cannot be reversed.</li>
        <li>Start small, especially with the Cashbridge Router, until you know the flow.</li>
      </ul>
      <p>
        For stuck steps and wallet messages, see <Link href="/docs/faq">FAQ and troubleshooting</Link>.
      </p>
    </DocsArticle>
  )
}
