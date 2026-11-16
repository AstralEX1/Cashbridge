import type { Metadata } from 'next'
import Link from 'next/link'
import { Callout, DocsArticle, Shot } from '@/components/docs/docs-ui'

export const metadata: Metadata = {
  title: 'Fees and limits',
  alternates: { canonical: '/docs/fees' }
}

export default function Page() {
  return (
    <DocsArticle
      href="/docs/fees"
      title="Fees and limits"
      lead="Cash Bridge adds no fee of its own and sets no limit on the amount. The transfer still costs what the networks and pools underneath it charge, and every figure is shown before you sign."
    >
      <h2 id="costs">What a transfer costs</h2>
      <table>
        <thead>
          <tr>
            <th>Cost</th>
            <th>Paid to</th>
            <th>Where you see it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Network fee (gas) on the source chain</td>
            <td>The validators or miners of that chain, in its native coin</td>
            <td>
              <strong>Gas</strong> on Confirm swap
            </td>
          </tr>
          <tr>
            <td>THORChain bridge fee</td>
            <td>THORChain: a liquidity fee for the swap and an outbound fee for the payout</td>
            <td>
              <strong>THORChain bridge fee</strong> in the price impact breakdown
            </td>
          </tr>
          <tr>
            <td>Cauldron swap fee</td>
            <td>The liquidity providers of the Cauldron pool, a small percentage of the amount traded</td>
            <td>
              <strong>Cauldron swap fee</strong> in the price impact breakdown
            </td>
          </tr>
          <tr>
            <td>Bitcoin Cash network fee</td>
            <td>Bitcoin Cash miners, a very small amount</td>
            <td>
              <strong>Network fee</strong> and <strong>Gas</strong> on Bitcoin Cash
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Prices also move when you trade against a pool: a larger amount moves the price further. This is the <strong>pool price impact</strong>. It is not a fee, but you pay it in the amount you receive.
      </p>

      <h2 id="impact">Reading the price impact</h2>
      <p>
        Next to the amount you receive, the form shows the price impact of the whole route: what you lose between the value you send and the value you receive, without gas. Hover over it for the breakdown into THORChain fee, Cauldron fee and pool price impact. A small transfer pays mostly fees. A large one pays mostly price impact, because the pools have limited depth.
      </p>
      <p>
        If the Cauldron pools price PUSD away from its peg of one dollar, the form shows the rate at which one PUSD costs. A smaller amount, or waiting for the pools to recover, gives a better result. Transfers with the Cashbridge Router ask you to tick a box before you accept a price impact above about 2%.
      </p>

      <h2 id="slippage">Price impact and slippage</h2>
      <p>
        Prices can move between the quote and the moment the swap runs. <strong>Max slippage</strong> is the most the price may move against you before THORChain cancels the swap and refunds you. Open the sliders button at the top right of the form to change it. The default is <strong>1%</strong>. The slider goes from 0.1% to <strong>No limit</strong>.
      </p>
      <Shot name="settings" alt="The settings popover with the Max slippage slider at 1%" size="md" caption="Max slippage, set to the default of 1%." />
      <ul>
        <li>A low value protects you from large moves, and the swap is refunded more often when the market is volatile.</li>
        <li>The setting applies to the THORChain swap. The Cauldron swap is quoted again on the BCH you actually receive and has its own minimum, which is part of the transaction and shown before you sign.</li>
        <li>With the Cashbridge Router on, the minimum PUSD is fixed when the order is created. See <Link href="/docs/guides/cashbridge-router">Use the Cashbridge Router</Link>.</li>
      </ul>

      <h2 id="limits">Limits</h2>
      <p>Cash Bridge itself has no minimum and no maximum. These limits still apply:</p>
      <ul>
        <li>
          <strong>THORChain minimum.</strong> Every route has a smallest amount THORChain accepts, because the outbound fee must be covered. Below it the form says <em>Minimum is X</em> for that asset and the transfer cannot start. The minimum changes with network fees.
        </li>
        <li>
          <strong>Liquidity.</strong> A very large amount has no route, or a poor price, because the pools run out of depth. The form says <em>No route for this amount right now</em>.
        </li>
        <li>
          <strong>Token swap fees.</strong> On BCH, a very small amount cannot cover the miner fee of the Cauldron swap. The page then says the amount is too small and you can keep the BCH.
        </li>
        <li>
          <strong>Cashbridge Router caps.</strong> The Cashbridge Router service limits how much BCH it holds for open orders, and the size of one order. These are set by the operator and can change. A larger transfer can use manual mode.
        </li>
        <li>
          <strong>Paused assets.</strong> THORChain can pause trading in an asset. It is greyed out in the picker until it resumes.
        </li>
      </ul>
      <Callout kind="tip">
        Whatever you plan to send, start with a small amount. It costs a little more per dollar, and it shows you the whole flow before real money is at stake.
      </Callout>
    </DocsArticle>
  )
}
