import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Shot } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Wallets',
  alternates: { canonical: '/docs/wallets' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/wallets"
      title="Wallets"
      lead="A transfer touches up to two wallets: one on the source or destination chain, and a Bitcoin Cash wallet. Cash Bridge works with the wallets you already use and never asks for a seed phrase or a private key."
    >
      <table>
        <thead>
          <tr>
            <th>Side</th>
            <th>Wallets</th>
            <th>How it connects</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Source or destination chain</td>
            <td>MetaMask, Rabby, Brave Wallet, OKX, Phantom, Trust Wallet, Exodus, Keplr, Vultisig, TronLink, Ledger, Trezor</td>
            <td>Browser extension or hardware wallet</td>
          </tr>
          <tr>
            <td>Bitcoin Cash</td>
            <td>Selene</td>
            <td>WizardConnect, with a QR code or a link</td>
          </tr>
          <tr>
            <td>Bitcoin Cash</td>
            <td>Paytaca, Cashonize</td>
            <td>WalletConnect, with a QR code, a link or the Paytaca extension</td>
          </tr>
        </tbody>
      </table>
      <p>Which wallets appear for a chain depends on that chain. The list in the app is the source of truth.</p>

      <h2 id="source">Source and destination wallets</h2>
      <p>
        Press <strong>Connect wallet</strong> on the side that is not Bitcoin Cash. The list shows the wallets that can connect to the chosen chain. Wallets your browser already has are marked <strong>Detected</strong> and come first, wallets you could install show <strong>Install</strong> with a link to their site, and hardware wallets sit at the end. A click on a detected wallet connects it and your wallet asks you to approve.
      </p>
      <Shot name="connect-evm" alt="The Connect Wallet dialog listing Brave Wallet, Exodus, Keplr, MetaMask, OKX, Phantom, Rabby Wallet, Trust Wallet and Vultisig" size="md" caption="The list on a browser with no wallet installed. Wallets it finds are marked Detected." />
      <ul>
        <li>
          <strong>Hardware wallets.</strong> Unlock the device and open the matching app on it first, such as Ethereum for an Ethereum account. Trezor also asks you to confirm in its Connect popup.
        </li>
        <li>
          <strong>On a phone.</strong> MetaMask is not detected in a normal mobile browser. The row then reads <strong>Open app</strong> and opens Cash Bridge inside the MetaMask app, where it can connect.
        </li>
        <li>
          <strong>Receiving on another chain.</strong> When you bridge back from Bitcoin Cash, the wallet on the destination chain only receives. It does not sign anything.
        </li>
      </ul>

      <h2 id="bch">Bitcoin Cash wallets</h2>
      <p>
        Press <strong>Connect BCH wallet</strong> and choose how the wallet connects. The BCH wallet receives the BCH from THORChain and signs the Cauldron swap, so it must support CashTokens when you receive PUSD or another token.
      </p>
      <h3>Selene, over WizardConnect</h3>
      <p>
        Choose <strong>Selene</strong>. Scan the QR code with the wallet or open the link in it, then approve the connection. Keep the Selene app open while you sign. The request waits there until you answer it.
      </p>
      <Shot name="connect-wizardconnect" alt="The WizardConnect dialog with a QR code to scan with a WizardConnect wallet" size="sm" caption="Scan the code with the wallet. The code in this image is blurred; yours is live." />
      <h3>Paytaca and Cashonize, over WalletConnect</h3>
      <p>
        Choose <strong>Paytaca · Cashonize</strong>. Scan the QR code with the wallet, or press <strong>Copy link</strong> and paste it into the wallet&apos;s WalletConnect screen. On a phone, <strong>Open wallet</strong> jumps to the app. Your wallet asks you to approve a short connection message. It proves that the address is yours and sends nothing.
      </p>
      <p>
        If you use the Paytaca browser extension, an extra row <strong>Paytaca · Browser extension</strong> appears. It opens the extension straight on its WalletConnect screen, so there is nothing to copy.
      </p>
      <Callout kind="note" title="Paytaca sends the transaction itself">
        Paytaca broadcasts a transaction after you approve it, even though Cash Bridge only asks for a signature. Cash Bridge allows for this: it follows the transaction by its id, and broadcasting the same signed transaction a second time does nothing extra.
      </Callout>

      <h2 id="reconnect">Reconnecting</h2>
      <p>
        Wallets reconnect on their own the next time you visit the site in the same browser. If a BCH wallet does not answer, the page says <em>Open the wallet app to finish</em>. Open the wallet. If that does not help, press <strong>New QR</strong> to pair again. <strong>Disconnect</strong> in the wallet menu forgets the connection.
      </p>
      <p>
        An unfinished transfer is bound to the BCH wallet that received the BCH. If you open the site with another wallet or account, it shows <em>Connect the wallet and account that own the bound address</em>. Connect the same account to continue.
      </p>

      <h2 id="paste">Pasting an address</h2>
      <p>
        With the <Link href="/docs/guides/cashbridge-router">Cashbridge Router</Link> on, the BCH button has a menu with <strong>Paste wallet address</strong>. You can then receive PUSD or BCH at an address without connecting its wallet, because receiving needs no signature. A pasted PUSD address must be a token-aware one that starts with <code>bitcoincash:z</code>; many wallets show it separately from the plain <code>bitcoincash:q</code> address. A plain BCH address takes the <code>q</code> form. The field turns red and the button stays disabled for anything else, including addresses of other chains and old-style <code>1…</code> addresses, which look the same as Bitcoin&apos;s.
      </p>
      <p>
        Bridging from Bitcoin Cash, the payout button has the same <strong>Paste wallet address</strong> entry. The address must be in the destination chain&apos;s own format: <code>0x…</code> on Ethereum, Base and the other EVM chains, <code>bc1…</code>, <code>1…</code> or <code>3…</code> on Bitcoin, a classic <code>r…</code> address on XRP, and so on. Anything else is refused the same way. On EVM chains a smart contract or an EIP-7702 delegated account is refused too, because THORChain cannot pay it. THORChain sends no memo or tag with the payout, so do not use an exchange deposit address that needs one.
      </p>

      <h2 id="safety">What a wallet connection can and cannot do</h2>
      <ul>
        <li>Connecting shows Cash Bridge your public address. It does not move funds.</li>
        <li>Every transaction is a separate request that your wallet shows you before it signs.</li>
        <li>Cash Bridge has no feature to import a seed phrase or a private key. If a site asks for one, it is not Cash Bridge.</li>
      </ul>
      <p>
        Wallet messages and what they mean are in <Link href="/docs/faq">FAQ and troubleshooting</Link>.
      </p>
    </DocsArticle>
  )
}
