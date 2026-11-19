# Cash Bridge transaction flows

## Manual (Cashbridge Router off, the default)

Forward: source wallet → THORChain → BCH in the user's BCH wallet → optional Cauldron CashToken trade signed through WizardConnect. Native BCH skips the token trade. Reverse: BCH wallet sells the chosen token when needed, then signs the THORChain BCH deposit; the target chain proves payout. Existing manual 0-conf behavior and wallet sessions remain unchanged.

## Automatic (Cashbridge Router on, forward PUSD only)

1. The browser captures immutable source intent, PUSD recipient and BCH fallback. It saves the order reference locally and creates an order with a fixed PUSD minimum and unique BCH deposit script.
2. Send prepares the order and quote in place and opens the same Confirm as manual (no separate review step); it shows the PUSD minimum, recipient and quote warnings, and the router tooltip explains the temporary custody. The source wallet authorizes the executable THORChain transfer. ERC-20 approval can be an additional transaction.
3. THORChain sends BCH to the order address. The worker discovers it even if the browser callback or tab is lost, verifies the inbound and all completed streaming outbounds, and waits for the configured input depth.
4. The shared local Cauldron engine builds a transaction spending only verified order BCH and live pools. The worker independently checks it and signs. That same transaction pays PUSD directly to the recipient and unused native BCH to the fallback.
5. If no trade meeting the original minimum is available before the stored deadline, the worker returns verified BCH to the captured fallback minus miner fee. Network/recovery delays and acceptance-unknown payouts can delay a safe refund.
6. Signed attempts are recorded before broadcast. Unknown replies reconcile/replay identical bytes. A mempool payout gives a provisional exact receipt; finality requires at least six confirmations. The UI can recover from local history in either execution mode.

Automatic means fewer user signing steps; there are still several on-chain transactions and temporary service control of BCH. It does not make the bridge atomic or guarantee a PUSD payout.

## Contract orders (Cashbridge Router without custody)

With `AUTO_BRIDGE_CONTRACT_ORDERS=true` on the Router, a new order's deposit is not an address the Router holds keys for but
the P2SH20 address of [`contracts/router-order.cash`](../contracts/router-order.cash), built from the order's terms: the
Router's key for this order, the PUSD recipient, the BCH fallback, the quoted minimum PUSD and a refund time three hours
after the order is created. THORChain pays the BCH there (it pays only 20-byte script hashes; a P2SH32 destination fails
its address check). A coin can leave in three ways only, each checked against the output with the coin's own index:

- **convert**, signed by the Router: a Cauldron trade that pays the recipient at least the quoted minimum PUSD. It is the
  same trade as before, with the contract's input in place of the Router's.
- **giveBack**, signed by the Router: the BCH back to the fallback, at most 2,000 sats to the miner.
- **expire**, by anyone after the refund time: the same as giveBack, so nothing stays stuck if the Router stops.

The order the browser receives carries the Router key and the refund time. The browser rebuilds the contract from them and the
addresses and minimum it asked for, and refuses an order whose deposit is not that contract. The Router still chooses when
to act (until the refund time) and which trade to make, so between the quoted minimum and the best price it is trusted; it
cannot pay the BCH anywhere but the recipient and the fallback. An order that receives more than one coin goes back as BCH.
If someone expires a coin before the Router acts, the order stops for review. `npm run contract:compile` rebuilds
`contracts/router-order.json`; `src/lib/router-contract.ts` holds its bytecode, and `test/router-contract.test.mjs` runs it
in the BCH VM on a real Cauldron trade.
