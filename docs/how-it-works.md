# Cash Bridge transaction flows

## Manual (default)

Forward: source wallet → THORChain → BCH in the user's BCH wallet → optional Cauldron CashToken trade signed through WizardConnect. Native BCH skips the token trade. Reverse: BCH wallet sells the chosen token when needed, then signs the THORChain BCH deposit; the target chain proves payout. Existing manual 0-conf behavior and wallet sessions remain unchanged.

## Automatic (forward PUSD only)

1. The browser captures immutable source intent, PUSD recipient and BCH fallback. It saves the order reference locally and creates an order with a fixed PUSD minimum and unique BCH deposit script.
2. The user reviews temporary service custody, minimum, addresses and quote warnings. The source wallet authorizes the executable THORChain transfer. ERC-20 approval can be an additional transaction.
3. THORChain sends BCH to the order address. The worker discovers it even if the browser callback or tab is lost, verifies the inbound and all completed streaming outbounds, and waits for the configured input depth.
4. The shared local Cauldron engine builds a transaction spending only verified order BCH and live pools. The worker independently checks it and signs. That same transaction pays PUSD directly to the recipient and unused native BCH to the fallback.
5. If no trade meeting the original minimum is available before the stored deadline, the worker returns verified BCH to the captured fallback minus miner fee. Network/recovery delays and acceptance-unknown payouts can delay a safe refund.
6. Signed attempts are recorded before broadcast. Unknown replies reconcile/replay identical bytes. A mempool payout gives a provisional exact receipt; finality requires at least six confirmations. The UI can recover from local history in either execution mode.

Automatic means fewer user signing steps; there are still several on-chain transactions and temporary service control of BCH. It does not make the bridge atomic or guarantee a PUSD payout.
