# Task: document SwapOnArrival vs RouterOrder

Read `shared/arrival-integration/SPEC.md` and `contracts/swap-on-arrival.cash`.

OWN ONLY short sections in:
- `src/app/docs/security/page.tsx`
- `src/app/docs/guides/cashbridge-router/page.tsx`

Document clearly:
1. RouterOrder = service key, continues with tab closed, fixed minTokens.
2. SwapOnArrival = browser tradeKey, proportional floor, reclaim after refundAfter without key; keep tab open to swap.
3. Server never holds arrival trade private key; public terms only.
4. Lost key → reclaim after time only.
5. Manual prepare failure falls back to wallet + classic Cauldron.

Match existing docs tone. No commit/push. When done: call `orca orchestration worker-done` with a short summary.
