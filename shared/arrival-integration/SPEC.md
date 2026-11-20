# SwapOnArrival integration (Cashbridge)

## Design (integrations + CashScript/XO/Hashi lessons)

1. **Two non-custodial covenants stay distinct**
   - `RouterOrder` (`router-order.cash`): Router **service** key, fixed `minTokens`, continues with tab closed. THOR/NEAR pay the order P2SH20.
   - `SwapOnArrival` (`swap-on-arrival.cash`): **browser** `tradeKey`, proportional floor `rateNum/rateDen`, Hashi-style. THOR/NEAR pay the arrival P2SH20. Tab should stay open to `swap`; after `refundAfter` anyone may `reclaim` (no key). Server never gets the trade private key — only public terms (CashScript infrastructure guide: store constructor args).

2. **Bridge destinations**
   - THORChain outbound DESTADDR: P2SH20 `bitcoincash:p…` (already proven for RouterOrder).
   - NEAR Intents: plain BCH address to the same P2SH20 (no token-aware z…).
   - Fallback if arrival cannot be prepared/registered: pay the **wallet** and use classic Manual Cauldron (Hashi runner pattern).

3. **XO / CashScript**
   - P2SH hides redeem script → persist constructor args (IndexedDB + optional public register).
   - Prefer libauth + shipped artifact (as Hashi), already mirrored in `src/lib/swap-on-arrival.ts`.
   - VM-verify before broadcast; fee ≥ 1 sat/byte with unlock size; index-bound payout; dust/fee-cap checks.

4. **Checks & fallbacks (smooth)**
   - Waiting for coin / price (not hard fail).
   - BelowFloor → retry later or `release` BCH to owner.
   - FeeShortfall → rebuild with more reserve (limited retries).
   - TradeLayoutError → do not sign.
   - Broadcast conflict → limited retries.
   - Lost trade key → only `reclaim` after time (document clearly).
   - Arrival prep/register fail → wallet destination fallback.

## File ownership (workers)

| Owner | Files |
| --- | --- |
| Coordinator (this agent) | `src/lib/arrival-trade.ts`, `test/arrival-trade.test.mjs`, wiring glue |
| Worker session | `src/lib/arrival-session.ts`, `test/arrival-session.test.mjs` only |
| Worker wire | `src/components/swap/pusd-swap.tsx` (arrival path only), minimal i18n `en.json` keys under `bridge.arrival.*` |
| Worker docs | `src/app/docs/security/page.tsx` + `src/app/docs/guides/cashbridge-router/page.tsx` short sections only |

No commit/push. No secrets. No funded mainnet. Run focused tests.
