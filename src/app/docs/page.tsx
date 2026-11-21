import type { Metadata } from 'next'
import Link from 'next/link'
import { BlazeConfig } from '@/config'
import { DocsDemoMcp } from '@/components/docs/docs-demo-mcp'
import { Callout, Card, CardGroup, DocsArticle, Shot } from '@/components/docs/docs-ui'
import { RouteFigure } from '@/components/docs/route-figure'
import { routeScene } from '@/components/docs/route-scenes'

export const metadata: Metadata = {
  title: 'Introduction',
  alternates: { canonical: '/docs' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs"
      title="Cash Bridge docs"
      lead="Move value between Bitcoin Cash (and Cauldron CashTokens) and the rest of crypto. THORChain, NEAR Intents and ShapeShift carry the BCH path and Any network pairs; two modes decide who signs: Manual or the Cashbridge Router."
    >
      <Shot name="form-forward" alt="The Cash Bridge form: 25 USDC on Ethereum to about 24.63 PUSD on Bitcoin Cash" caption="The bridge form. Pick what to send, what to receive and an amount; when several routes quote, the form compares them." />

      <h2 id="video-demo">Video demo</h2>
      <figure className="docs-shot">
        <video
          className="w-full rounded-2xl"
          controls
          playsInline
          preload="none"
          width={1112}
          height={720}
          poster="/landing/cashbridge-demo.jpg"
          aria-label="Cash Bridge video demo"
        >
          <source src="/landing/cashbridge-demo.mp4" type="video/mp4" />
          <a href={BlazeConfig.videoUrl}>Watch the video demo on X</a>
        </video>
        <figcaption>
          <a href={BlazeConfig.videoUrl} target="_blank" rel="noreferrer">Watch the video demo on X</a> (4:45).
        </figcaption>
      </figure>

      <h2 id="start-here">Start here</h2>
      <CardGroup title="Protocol">
        <Card href="/docs/how-it-works" title="How it works" eyebrow="Route explorer">
          Every route animated: into or out of Bitcoin Cash, Manual or Cashbridge Router, THORChain, NEAR Intents or ShapeShift.
        </Card>
        <Card href="/docs/smart-contracts" title="Smart contracts" eyebrow="Contracts">
          The per-order contracts behind one signature: every way out, the floor, two keys and a clock.
        </Card>
        <Card href="/docs/guides/cashbridge-router" title="Cashbridge Router" eyebrow="Guide">
          Sign once, follow the order, and what each state means.
        </Card>
        <Card href="/docs/security" title="Security and custody" eyebrow="Custody">
          Who signs, what the contract enforces, and what stays off-chain with the Router service.
        </Card>
      </CardGroup>
      <CardGroup title="Integrate">
        <Card href="/docs/agents" title="AI agents (MCP)" eyebrow="Agents">
          Quote, prepare unsigned deposits, and track status at /mcp — no keys.
        </Card>
        <Card href="/docs/mainnet" title="Proof on mainnet" eyebrow="Evidence">
          Public explorer links for real runs. Contract vs legacy P2PKH rows are labelled.
        </Card>
        <Card href="/docs/guides/bridge-to-bch" title="First transfer guide" eyebrow="Guide">
          Walkthrough with screenshots for bridging to BCH or a CashToken.
        </Card>
      </CardGroup>

      <h2 id="one-signature">One signature, start to finish</h2>
      <RouteFigure
        figure={routeScene('in', 'router', 'any').figure}
        caption="USDC on Base into PUSD on Bitcoin Cash with the Cashbridge Router. The pen marks your only signature; the dashed path is the BCH coming back to you if no trade pays your minimum."
      />

      <h2 id="what-you-can-do">What you can do</h2>
      <ul>
        <li>
          <strong>Bridge to Bitcoin Cash.</strong> Send an asset from another chain and receive native BCH, or a CashToken traded on Cauldron (PUSD by default).
        </li>
        <li>
          <strong>Bridge back.</strong> Sell BCH or a CashToken and receive an asset on another chain.
        </li>
        <li>
          <strong>Compare routes.</strong> When more than one of THORChain, NEAR Intents and ShapeShift quotes a transfer, the form shows the outputs and takes the best one unless you pick another.
        </li>
        <li>
          <strong>Sign once, if you prefer.</strong> The Cashbridge Router lets you approve a single source transaction while a per-order contract (or, for older proof rows, a legacy address) settles the Cauldron leg.
        </li>
      </ul>

      <h2 id="at-a-glance">At a glance</h2>
      <table>
        <tbody>
          <tr>
            <th>Directions</th>
            <td>Both. Supported assets ↔ BCH or a Cauldron CashToken.</td>
          </tr>
          <tr>
            <th>Cross-chain bridges</th>
            <td>
              <a href="https://thorchain.org" target="_blank" rel="noopener noreferrer">
                THORChain
              </a>
              ,{' '}
              <a href="https://docs.near-intents.org" target="_blank" rel="noopener noreferrer">
                NEAR Intents
              </a>{' '}
              (1Click) and{' '}
              <a href="https://shapeshift.com" target="_blank" rel="noopener noreferrer">
                ShapeShift
              </a>{' '}
              for the BCH path both ways (Manual and the Cashbridge Router) and Any network pairs. Availability depends on each network&apos;s listings and liquidity.
            </td>
          </tr>
          <tr>
            <th>Modes</th>
            <td>
              <strong>Manual</strong> (default): you sign every step. <strong>Cashbridge Router</strong>: one source signature; settlement follows order terms. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.
            </td>
          </tr>
          <tr>
            <th>Receive on BCH</th>
            <td>Native BCH, PUSD and other CashTokens traded on Cauldron.</td>
          </tr>
          <tr>
            <th>Cash Bridge fee</th>
            <td>
              None. Network, bridge and pool costs still apply — <Link href="/docs/fees">Fees and limits</Link>.
            </td>
          </tr>
          <tr>
            <th>Wallets</th>
            <td>
              Source: browser wallets or WalletConnect. BCH: WizardConnect, Selene and Paytaca; Cashonize and Zapit over WalletConnect. See <Link href="/docs/wallets">Wallets</Link>.
            </td>
          </tr>
          <tr>
            <th>Agents</th>
            <td>
              MCP at <code>https://www.cashbridge.space/mcp</code> — <Link href="/docs/agents">AI agents</Link>.
            </td>
          </tr>
          <tr>
            <th>Custody</th>
            <td>
              Manual: only your wallets. Router contract orders: BCH sits in a P2SH covenant that can only pay you or refund you. See <Link href="/docs/security">Security and custody</Link>.
            </td>
          </tr>
        </tbody>
      </table>

      <Callout kind="warning" title="Start small">
        Cash Bridge is young software that moves real funds across several networks. Send a small amount first, check that it arrives, then bridge more.
      </Callout>

      <h2 id="two-ways">Manual vs Cashbridge Router</h2>
      <p>
        <strong>Manual</strong> is the default. You sign each step: the source deposit, then, for a CashToken, the Cauldron swap in your BCH wallet. THORChain, NEAR Intents or ShapeShift carries the cross-chain leg. Nothing is ever in the Router&apos;s hands.
      </p>
      <p>
        <strong>Cashbridge Router</strong> is the second option above the form. You sign once in the source wallet. For contract orders (<code>apiVersion=2</code>), BCH lands in a per-order purchase covenant; the Router may buy your token on Cauldron at or above the fixed minimum, or return BCH to your fallback. Sale contracts do the same for bridging a CashToken back. See <Link href="/docs/smart-contracts">Smart contracts</Link>. The two oldest Router rows in Proof on mainnet used an earlier model with temporary P2PKH custody.
      </p>

      <h2 id="agents-strip">For agents</h2>
      <DocsDemoMcp />

      <h2 id="built-on">Built on open liquidity</h2>
      <p>
        Cash Bridge is an interface, not a new chain.{' '}
        <a href="https://thorchain.org" target="_blank" rel="noopener noreferrer">
          THORChain
        </a>
        ,{' '}
        <a href="https://docs.near-intents.org" target="_blank" rel="noopener noreferrer">
          NEAR Intents
        </a>{' '}
        and{' '}
        <a href="https://shapeshift.com" target="_blank" rel="noopener noreferrer">
          ShapeShift
        </a>{' '}
        move native assets across networks.{' '}
        <a href="https://cauldron.quest" target="_blank" rel="noopener noreferrer">
          Cauldron
        </a>{' '}
        markets BCH and CashTokens on Bitcoin Cash. Cash Bridge quotes the available routes, builds the transactions, and follows them until funds arrive.
      </p>
    </DocsArticle>
  )
}
