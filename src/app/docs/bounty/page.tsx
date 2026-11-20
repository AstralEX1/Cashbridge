import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { DocsArticle } from '@/components/docs/docs-ui'
import { BlazeConfig } from '@/config'

export const metadata: Metadata = {
  title: 'The bounty, line by line',
  alternates: { canonical: '/docs/bounty' }
}

const BOUNTY_URL = 'https://bchblaze.cash/bounties/stablecoin-bridge/'

// The bounty's own words, what Cash Bridge does about each, and where to check it.
const LINES: { asks: string; answer: ReactNode; check: ReactNode }[] = [
  {
    asks: 'convert stablecoins on other chains to BCH stablecoins (eg USDC on ETH into PUSD on BCH)',
    answer: 'USDC and USDT on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Solana, TRON and more, to PUSD, MUSD or any other Cauldron token. THORChain, NEAR Intents or ShapeShift carries the BCH, and Cauldron turns it into the token.',
    check: (
      <>
        <Link href="/sell-ETH.USDC-buy-PUSD">USDC on Ethereum to PUSD</Link>, <Link href="/docs/mainnet">Proof on mainnet</Link>
      </>
    )
  },
  {
    asks: 'And vice-versa, BCH stables to other-chain stables (eg PUSD on BCH into USDC on ETH)',
    answer: 'PUSD, MUSD or any Cauldron token back to USDC, USDT or any other asset the three bridges pay out.',
    check: (
      <>
        <Link href="/sell-PUSD-buy-ETH.USDC">PUSD to USDC on Ethereum</Link>, <Link href="/docs/guides/bridge-from-bch">Bridge back from Bitcoin Cash</Link>
      </>
    )
  },
  {
    asks: 'from BCH stables to multiple/any other ecosystems would be even better',
    answer: 'More than 20 source chains. Stablecoins come from the EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Gnosis and more), Solana, TRON, TON, Sui and NEAR.',
    check: <Link href="/bridge">The chain list in the bridge</Link>
  },
  {
    asks: 'The faster … the better',
    answer: 'The token is bought as soon as the bridge’s BCH reaches the mempool, by your page or by the Cashbridge Router. The Router finishes the transfer even after you close the tab. Each route shows its expected time before you sign.',
    check: <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>
  },
  {
    asks: 'The … cheaper … the better',
    answer: 'Cash Bridge adds no fee. THORChain, NEAR Intents and ShapeShift are quoted side by side, and the form picks the route that delivers the most. Every fee is shown before you sign.',
    check: <Link href="/docs/fees">Fees and limits</Link>
  },
  {
    asks: 'The … easier to use the bridge is - the better',
    answer: 'One signature each way with the Cashbridge Router, on all three bridges (an ERC-20 token sent through THORChain may need an approval first). On the way to Bitcoin Cash you can paste a BCH address instead of connecting a BCH wallet. The app comes in 24 languages, and AI agents can use it over MCP.',
    check: (
      <>
        <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>, <Link href="/docs/agents">AI agents</Link>
      </>
    )
  },
  {
    asks: 'On the BCH side, WizardConnect is highly recommended',
    answer: 'WizardConnect for Selene, Paytaca and any other WizardConnect wallet. WalletConnect for Cashonize and Zapit.',
    check: <Link href="/docs/wallets">Wallets</Link>
  },
  {
    asks: 'On the other chain side, WalletConnect is probably essential',
    answer: 'WalletConnect, plus browser, mobile and hardware wallets: MetaMask, Rabby, Phantom, Trust Wallet, OKX, Keplr, TronLink, Vultisig, Ledger and Trezor.',
    check: <Link href="/docs/wallets">Wallets</Link>
  },
  {
    asks: 'Stretch: supporting multiple [BCH stablecoins] would be better',
    answer: 'PUSD and MUSD, and any other token with a Cauldron pool.',
    check: <Link href="/docs/mainnet">PUSD and MUSD runs</Link>
  },
  {
    asks: 'Stretch: integration or collaborations that route through large popular and existing multicoin providers like ShapeShift, ThorChain etc.',
    answer: 'THORChain, NEAR Intents and ShapeShift, each quoted wherever it carries the pair. ShapeShift’s BCH swaps run on NEAR Intents, so Cash Bridge checks each one against NEAR Intents before using it.',
    check: (
      <>
        <Link href="/docs/how-it-works">How it works</Link>, <Link href="/docs/mainnet">Proof on mainnet</Link>
      </>
    )
  },
  {
    asks: 'ParyonUSD … an excellent choice for first priority integration & demo purposes',
    answer: 'PUSD is the default destination. It is identified by its category id, never by its ticker.',
    check: <Link href="/bridge">The bridge</Link>
  },
  {
    asks: 'Mainnet Track: judges can make a BCH mainnet transaction',
    answer: 'Every transfer runs on mainnet, and each step links to a public explorer.',
    check: (
      <>
        <Link href="/docs/mainnet">Proof on mainnet</Link>, <Link href="/scanner">Scanner</Link>
      </>
    )
  },
  {
    asks: 'Mainnet Track: WizardConnect or XO integration',
    answer: 'WizardConnect.',
    check: <Link href="/docs/wallets">Wallets</Link>
  },
  {
    asks: 'Mainnet Track: a banner with the deck, the repository and a CashTokens address',
    answer: `The banner at the top of every page links the presentation and the source code${BlazeConfig.emberAddress ? ' and shows the CashTokens address' : ''}.`,
    check: <Link href="/">Home page</Link>
  }
]

export default function Page() {
  return (
    <DocsArticle
      href="/docs/bounty"
      title="The bounty, line by line"
      lead={
        <>
          Cash Bridge is an entry for the BCH BLAZE 2026{' '}
          <a href={BOUNTY_URL} target="_blank" rel="noopener noreferrer">
            Stablecoin Bridge bounty
          </a>
          . Each row quotes the bounty and says where to check how Cash Bridge meets it.
        </>
      }
    >
      <table>
        <thead>
          <tr>
            <th>The bounty asks</th>
            <th>Cash Bridge</th>
            <th>Check it</th>
          </tr>
        </thead>
        <tbody>
          {LINES.map(line => (
            <tr key={line.asks}>
              <td>
                <em>“{line.asks}”</em>
              </td>
              <td>{line.answer}</td>
              <td>{line.check}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DocsArticle>
  )
}
