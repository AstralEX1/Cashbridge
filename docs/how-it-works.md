# Cash Bridge transaction flows

## Manual (Cashbridge Router off, the default)

Forward: source wallet → THORChain → BCH in the user's BCH wallet → optional Cauldron CashToken trade signed through WizardConnect. Native BCH skips the token trade. Reverse: BCH wallet sells the chosen token when needed, then signs the THORChain BCH deposit; the target chain proves payout. Existing manual 0-conf behavior and wallet sessions remain unchanged.
NEAR Intents (1Click) and [ShapeShift](https://shapeshift.com) quote beside THORChain both ways, for plain BCH and for the BCH leg of a CashToken transfer, and on **Any network** free pairs; the form takes the best route. Their leg is a plain transfer to a one-use deposit address, and its payout is found on the paying chain like THORChain's. ShapeShift's BCH quotes are NEAR Intents swaps: before one is used, the page reads 1Click's status of its deposit address and requires that exact swap (an exact amount in, paying the chosen recipient, refunding the sending wallet), then follows it like a NEAR Intents one. On Any network, NEAR Intents and ShapeShift need the source wallet connected; the QR deposit there is THORChain's.

## Automatic (Cashbridge Router on, forward to a Cauldron token)

1. The browser captures immutable source intent, the token (its category; PUSD when absent), token recipient and BCH fallback. It saves the order reference locally and creates an order with a fixed token minimum and unique BCH deposit script.
2. Send prepares the order and quote in place and opens the same Confirm as manual (no separate review step); it shows the token minimum, recipient and quote warnings, and the router tooltip explains the purchase/sale covenant (or legacy P2PKH custody when the service still returns that model). The source wallet authorizes the executable THORChain transfer. ERC-20 approval can be an additional transaction.
3. THORChain sends BCH to the order address. Once the source transaction is known, the Cashbridge Router settles only that inbound; any other payment to the address is kept aside for recovery. If the browser callback or tab is lost, it finds the inbound from the BCH memo and accepts it only from the order's own sender, chain and asset. It verifies the inbound and all completed streaming outbounds, and waits for the configured input depth.
4. The shared local Cauldron engine builds a transaction spending only verified order BCH and live pools. The Cashbridge Router independently checks it and signs. That same transaction pays the token directly to the recipient and unused native BCH to the fallback.
5. If no trade meeting the original minimum is available before the stored deadline, the Cashbridge Router returns verified BCH to the captured fallback minus miner fee. Network/recovery delays and acceptance-unknown payouts can delay a safe refund.
6. Signed attempts are recorded before broadcast. Unknown replies reconcile/replay identical bytes. A mempool payout gives a provisional exact receipt; finality requires at least six confirmations. The UI can recover from local history in either execution mode.

The Cashbridge Router's BCH nodes must keep a full transaction index (`txindex=1`, no pruning): it looks up confirmed deposits and payouts by id, and it holds order processing while any configured node fails that check.

Automatic means fewer user signing steps; there are still several on-chain transactions. Contract orders (`apiVersion=2`) keep BCH in a per-order covenant that can only pay you or refund you; legacy P2PKH orders used temporary service custody. It does not make the bridge atomic or guarantee a token payout.

## Contract orders (Cashbridge Router without custody)

With `AUTO_BRIDGE_CONTRACT_ORDERS=true` on the Router, a new order's deposit is not an address the Router holds keys for but
the P2SH20 address of [`contracts/router-order.cash`](../contracts/router-order.cash), built from the order's terms: the
Router's key for this order, the token recipient, the BCH fallback, the token category, the quoted minimum of it and a refund time three hours
after the order is created. THORChain pays the BCH there (it pays only 20-byte script hashes; a P2SH32 destination fails
its address check). A coin can leave in three ways only, each checked against the output with the coin's own index:

- **convert**, signed by the Router: a Cauldron trade that pays the recipient at least the quoted minimum of the token. It is the
  same trade as before, with the contract's input in place of the Router's.
- **giveBack**, signed by the Router: the BCH back to the fallback, at most 2,000 sats to the miner.
- **expire**, by anyone after the refund time: the same as giveBack, so nothing stays stuck if the Router stops.

The order the browser receives carries the Router key and the refund time. The browser rebuilds the contract from them and the
addresses and minimum it asked for, and refuses an order whose deposit is not that contract. The Router still chooses when
to act (until the refund time) and which trade to make, so between the quoted minimum and the best price it is trusted; it
cannot pay the BCH anywhere but the recipient and the fallback. Only the order's largest coin of at least half the quoted BCH is
converted, so a stranger's coin cannot block the swap; dust under 1,000 sats is ignored, and any other coin goes back as BCH once
the order is done. The customer's page does the same with its own key, and after the refund time it sends back whatever is left
through expire, so a stopped Router strands nothing.
If someone expires a coin before the Router acts, the order stops for review. `npm run contract:compile` rebuilds
`contracts/router-order.json`; `src/lib/router-contract.ts` holds its bytecode, and `test/router-contract.test.mjs` runs it
in the BCH VM on a real Cauldron trade.

## NEAR Intents and ShapeShift orders (Cashbridge Router forward)

With `AUTO_BRIDGE_NEAR_ORDERS=true` on the Router (the site offers it unless `NEXT_PUBLIC_ROUTER_NEAR=false`, and ShapeShift
unless `NEXT_PUBLIC_ROUTER_SHAPESHIFT=false`), a forward Router transfer can take its first leg through NEAR Intents or
ShapeShift when that quotes better. The page asks 1Click for a quote that
pays the order's own BCH address and refunds the source wallet, and gives the Router the quote's deposit address before
Confirm, so the Router can follow the order even if the tab closes. A Router without the setting refuses the address, and
the page quotes THORChain instead. 1Click pays q… and p… addresses, so contract orders take it
too. A ShapeShift quote is the same kind of 1Click address; the page sends its quote id with the address, the Router keeps
both, and the order is followed exactly like a NEAR one. The address is set once, before anything is paid, and a reused contract order takes
NEAR only if its payout deadline and the Router's wait both end before the contract's refund time.

The Router reads 1Click's status for that deposit address as a pointer only: the signed quote in it must pay native BCH to
the order's address, each BCH payout it names is read from the Router's own node, and together they must pay at least the
quote's minimum. Then the order goes on as above (depth, Cauldron trade or BCH fallback). A quote paying elsewhere, a
short payout or a failed swap stops the order for review; a 1Click refund ends it as refunded at the source.
ShapeShift's swaps refund about four hours after the quote, later than NEAR's two hours; the Router still expects the payout
within those two hours, and BCH that lands after the order's refund time can only go back to the BCH fallback.

## Sale orders (Cashbridge Router back from BCH)

With `AUTO_BRIDGE_SALE_ORDERS=true` on the Router (the site offers it unless `NEXT_PUBLIC_ROUTER_SALES=false`), a token transfer back
from BCH can also go through the Router. The page quotes the Cauldron sale and the THORChain deposit, then opens an order
whose deposit is the P2SH20 address of [`contracts/router-sale.cash`](../contracts/router-sale.cash), built from: the
Router's key for this order, THORChain's BCH vault, the deposit memo (destination asset and address), the user's address
for anything returned, the minimum BCH from the sale (the Router's quote less its slippage, which the page checks against
its own quote) and a refund time three hours ahead.
The page rebuilds the contract from these terms and refuses an order whose deposit is not that contract. The BCH wallet
signs one transaction: the tokens to that address, with 2,000 sats so the coin can be returned as it came.

A coin can leave the contract in four ways only:

- **sell**, signed by the Router: a Cauldron sale whose output with the coin's own index pays at least the minimum BCH,
  with no token, back into the same contract.
- **deposit**, signed by the Router: the contract's BCH, alone in its transaction, to THORChain's vault with the order's
  memo as the only other output, at most 2,000 sats to the miner. Being the only input makes the contract the sender
  THORChain refunds.
- **giveBack**, signed by the Router: each coin back to the user's address with the same token, amount and NFT
  commitment, at most 2,000 sats to the miner.
- **expire**, by anyone after the refund time: the same as giveBack.

The Router signs the sale and the deposit together and broadcasts them back to back, so the deposit usually enters the
mempool right after the sale. If THORChain no longer takes BCH at that vault, the sale cannot meet the minimum before the
deadline, or the contract gets anything but one coin of the order's token, the coins go back. A THORChain refund that
comes back to the contract goes on to the user; one paid to the memo's refund address ends the order as it is. The page
follows the order for the sale and deposit, then finds the payout on the destination chain as for a manual deposit.

### Sales paid out through NEAR Intents or ShapeShift

With `AUTO_BRIDGE_SALE_ROUTES` left on (the site offers it unless `NEXT_PUBLIC_ROUTER_SALE_ROUTES=false`), the sale's BCH
can go to a NEAR Intents or ShapeShift deposit address instead of THORChain's vault. The order names the route, and the memo
is the fixed `cashbridge` marker, an OP_RETURN with no instructions (that 1Click credits such a deposit is untested with real funds). Before taking the order, the Router reads 1Click's status of the
address: it must be waiting for a deposit of native BCH, pay the order's destination, refund the user's BCH address, and stay
open past the Router's own window. Otherwise the order is refused ("get a fresh quote"). The same check runs again before the
deposit; once the deposit is sent, the order follows 1Click's status to paid, refunded (to the user's BCH address) or review.

- **NEAR Intents** uses the same `router-sale.cash` contract. Its quote is flexible: it takes any amount down to the minimum
  BCH less the 2,000-sat fee cap, so the whole sale goes in.
- **ShapeShift** quotes an exact amount, so it uses [`contracts/router-sale-exact.cash`](../contracts/router-sale-exact.cash).
  Its deposit pays exactly that amount to the address, the memo, and the rest of the coin back to the user's BCH address as
  plain BCH, with the same fee cap. The page quotes it 3% under its own sale quote, less 2,546 sats (fee cap and dust), so the
  Router's minimum always covers it.

`test/router-sale.test.mjs` and `test/router-sale-exact.test.mjs` run the contracts in the BCH VM on a real Cauldron sale,
and `test/auto-bridge-sale.test.mjs` runs the Router's side against a fake network that VM-checks every broadcast. The
NEAR Intents and ShapeShift sale paths are tested this way only; no mainnet run has been made through them yet, so their
behaviour with real funds is a hypothesis until one is.

Deploy order: a Router without this support refuses routed sales (409), and the page would show that error to a user who
picks NEAR Intents or ShapeShift for a Router sale. Update the Router before or with the site, or set
`NEXT_PUBLIC_ROUTER_SALE_ROUTES=false` until it is.
