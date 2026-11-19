# Cash Bridge

Bridge assets to Bitcoin Cash and Cauldron CashTokens, and back. Live at https://www.cashbridge.space.

Two bridges carry the cross-chain leg: [THORChain](https://thorchain.org) and [NEAR Intents](https://docs.near-intents.org) (1Click). When both quote a transfer, the form shows what each would deliver and takes the better one. NEAR Intents is a plain transfer to a one-use deposit address — there is no Cashbridge contract on that leg; its payout is checked on the destination chain like THORChain’s.

By default (**Manual**) the user signs every step in their own wallets. For transfers that settle a Cauldron token (and for plain BCH when you prefer), the **Cashbridge Router** lets the user sign once in the source wallet while the service finishes settlement under the order’s terms. When the service returns a contract order (`apiVersion=2`), the deposit is a per-order P2SH purchase or sale covenant: spending is limited to paying the quoted minimum (or the fixed THORChain deposit on a sale) or returning funds to the fallback; after `refundAfter` (set about three hours from order creation; Bitcoin Cash median time runs about an hour behind wall clock) anyone may return them on those terms. Legacy orders used temporary P2PKH custody — the published Router proof row is that model, not covenant settlement. ERC-20 approval may still need a separate transaction. See the [docs](https://www.cashbridge.space/docs), [transaction flows](docs/how-it-works.md) and [security and custody](https://www.cashbridge.space/docs/security).

Promo film on the landing page: [`/landing/cashbridge-promo.mp4`](https://www.cashbridge.space/).

AI agents use the MCP server at `https://www.cashbridge.space/mcp`: list assets, quote, prepare an unsigned deposit for the user’s wallet, report the source tx, and read status. The server holds no keys; it does not prepare sale orders, and NEAR→CashToken prepare stays on THORChain via the Router. Add it with `claude mcp add --transport http cash-bridge https://www.cashbridge.space/mcp`; see the [agent docs](https://www.cashbridge.space/docs/agents).

Forked from the [swap.thorchain.org](https://github.com/thorchain/swap.thorchain) interface.

## Use Cash Bridge

1. Open the [bridge](https://www.cashbridge.space/bridge), choose the source asset and receive BCH, PUSD, MUSD or another Cauldron token.
2. Enter an amount, connect the source wallet and choose the BCH recipient. In Manual mode, connect your BCH wallet to sign the token purchase; with the Cashbridge Router, you can paste a receiving address.
3. Review the route (THORChain vs NEAR Intents when both quote), minimum, fees and fallback before signing. Follow the transfer in History, with links to its transactions.

To bridge back, reverse the form. Manual mode sells the CashToken to BCH and then asks your BCH wallet to sign the bridge deposit. When available, Router sales let your wallet send the token to a sale contract; the service sells it and deposits BCH to THORChain with the agreed destination memo, or returns the funds. These are several on-chain steps, not an atomic swap. See [bridging back](https://www.cashbridge.space/docs/guides/bridge-from-bch).

The [wallet guide](https://www.cashbridge.space/docs/wallets) covers WizardConnect and WalletConnect on BCH, and browser, mobile and hardware wallets on the other chains. Availability depends on the wallet and network. Cash Bridge adds no application fee; network, bridge and Cauldron pool fees still apply, and liquidity and provider limits affect each quote. See [fees and limits](https://www.cashbridge.space/docs/fees).

History is stored in your browser. The Router service continues an order after the tab closes; Manual steps still need your wallet. If a wallet answer is lost, check the transaction or use **Already paid?** before sending again. See [tracking and recovery](https://www.cashbridge.space/docs/guides/track-a-transfer).

## Proof on mainnet

Real transfers through https://www.cashbridge.space, end to end, in both directions. Every link opens the transaction on a public
explorer; the **THORChain swap** link opens the cross-chain leg on [thorchain.net](https://thorchain.net). The same table is in the
[docs](https://www.cashbridge.space/docs/mainnet). New runs are added at the bottom.

| Date | Mode | Route | Sent → received | Transactions |
|---|---|---|---|---|
| 17 Nov 2026 | Manual | BCH → BNB (BNB Smart Chain) | 0.019 BCH → 0.00624508 BNB | [BCH deposit](https://blockchair.com/bitcoin-cash/transaction/6d703a743adcf02f27f11407ba3383debd6365fd7cf7aa34ffb422968c342031) · [THORChain swap](https://thorchain.net/tx/6d703a743adcf02f27f11407ba3383debd6365fd7cf7aa34ffb422968c342031) · [BNB payout](https://bscscan.com/tx/0x0E4F95150CC7232B8E55C95AB011CA4EF4883716E30379FC326D4852632F8555) |
| 17 Nov 2026 | Manual | BNB → BCH → PUSD | 0.0062 BNB → 0.01639004 BCH → 3.39 PUSD | [BNB deposit](https://bscscan.com/tx/0x592eaa37bc2ca30efff2be5eb75b94bbb4819f1f1c99c4144c707aec7c5d8218) · [THORChain swap](https://thorchain.net/tx/592eaa37bc2ca30efff2be5eb75b94bbb4819f1f1c99c4144c707aec7c5d8218) · [BCH payout](https://blockchair.com/bitcoin-cash/transaction/92e5b363570ba683b3f519ce1c5256249c1c6f9cfdaf3af09d7ff35247061ba5) · [PUSD purchase](https://blockchair.com/bitcoin-cash/transaction/7c8a408cc401278ba6f6c1eda2aa9692de5eb8ea12a06d4f8ffdce6407e331fc) |
| 17 Nov 2026 | Manual | PUSD → BCH → BNB | 3.39 PUSD → 0.01622613 BCH → 0.00527858 BNB | [PUSD sale](https://blockchair.com/bitcoin-cash/transaction/a42ef6ed1dfe72ea9d6aa33d5438a34f5d86a24ed5db6ad53542bd53fe5552a7) · [BCH deposit](https://blockchair.com/bitcoin-cash/transaction/369ab490999475475869996741a6834ccb18d0bb9a821018d97d474f3d2d88a1) · [THORChain swap](https://thorchain.net/tx/369ab490999475475869996741a6834ccb18d0bb9a821018d97d474f3d2d88a1) · [BNB payout](https://bscscan.com/tx/0x4CD293F0BFCC30D052061578745C38A00D7D06A8FD3F4912CCADAA46CC805384) |
| 17 Nov 2026 | **Cashbridge Router** | BNB → PUSD, one signature | 0.003 BNB → 1.51 PUSD | [BNB deposit (the only signature)](https://bscscan.com/tx/0x10eb6893cb6736b67fa4d6c0c6fc8fac30453faf65fc010665f2d657f05303e8) · [THORChain swap](https://thorchain.net/tx/10eb6893cb6736b67fa4d6c0c6fc8fac30453faf65fc010665f2d657f05303e8) · [BCH to order address](https://blockchair.com/bitcoin-cash/transaction/8b0d008f5c36749d15fe9d3b206ea7b283664d4c65f1734be4b06d7aad0e4f88) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/0cf4ab532642433f0305339d003cecb9e0d826f69dcd58871d2cb255ebe4fde0) |
| 17 Nov 2026 | Manual | BNB → BCH → MUSD | 0.0022 BNB → 0.00504863 BCH → 1.02 MUSD | [BNB deposit](https://bscscan.com/tx/0xea82f1c2744b9ea41a4f6e1d928708a3914ab4bbe411edd5663e3d83c1980759) · [THORChain swap](https://thorchain.net/tx/ea82f1c2744b9ea41a4f6e1d928708a3914ab4bbe411edd5663e3d83c1980759) · [BCH payout](https://blockchair.com/bitcoin-cash/transaction/a6d7d4056baccc99e2fbcbfe6788b3e5fdefd9864d0c4071c362a31296275937) · [MUSD purchase](https://blockchair.com/bitcoin-cash/transaction/4edb9d9a879a70c45183f9fa56aa0350a61c8988b60a4f6d7feb80f527892202) |
| 17 Nov 2026 | Manual | MUSD → BCH → BNB | 1.02 MUSD → 0.00492643 BCH → 0.00130668 BNB | [MUSD sale](https://blockchair.com/bitcoin-cash/transaction/5523949b6b738a8a51b2621bef80daa590066b269725376adcdf4563861be6e3) · [BCH deposit](https://blockchair.com/bitcoin-cash/transaction/4de9d7f6c5fc0104065454163a339b548ffedcd56161186e68b87e07badbdd4f) · [THORChain swap](https://thorchain.net/tx/4de9d7f6c5fc0104065454163a339b548ffedcd56161186e68b87e07badbdd4f) · [BNB payout](https://bscscan.com/tx/0x67074DC513DFE6169884283722E04434D58C477219F997BF86DF3DC45F16851E) |
| 17 Nov 2026 | Manual | PUSD → BCH → AVAX | 1.51 PUSD → 0.00722206 BCH → 0.17553838 AVAX | [PUSD sale](https://blockchair.com/bitcoin-cash/transaction/318e55dc4b912fc4c774d436a57d1d22fdfaa65dab92bf82a88e43bf35302d9c) · [BCH deposit](https://blockchair.com/bitcoin-cash/transaction/02c3d7eb5e199f49f7f55362e1e0f2664e83634439a719c158246ed99a06a210) · [THORChain swap](https://thorchain.net/tx/02c3d7eb5e199f49f7f55362e1e0f2664e83634439a719c158246ed99a06a210) · [AVAX payout](https://snowscan.xyz/tx/0xD8A8C83CCA712EDC8C805C331D9F66614B48BE637A2545AC3612525D091C87E5) |

**Manual**: the user signs each step in their own wallets. **Cashbridge Router**: the user signs once in the source wallet, and the
Cashbridge Router buys the token on Cauldron and pays it out. The Router row above used legacy P2PKH order funding, not a
purchase covenant. Every THORChain swap above finished without a refund, and its payout is the
transaction listed next to it. The runs used small amounts, $1 to $3 per leg. The Cashbridge Router delivered 1.51 PUSD 5.7 minutes
after the single BNB signature (quote 1.50, minimum 1.48), and every payout arrived at or above the minimum shown on the Confirm screen.

## Development

Use Node.js 22.23.4, as in CI (minimum 22.22.2 on Node 22; see `package.json` for other supported versions).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Copy `.env.example` to `.env.local` and set `THORCHAIN_API_KEY` (server-only, never commit
it). Typecheck with `npx tsc --noEmit -p tsconfig.json` and run the bridge tests with `npm run test:bridge`.

## Deploying

The app is a standard Next.js build (`npm run build`, `output: 'standalone'`). On Vercel, import the repository and set the environment variables
from `.env.example` in the project settings; `THORCHAIN_API_KEY` must stay a server-side variable.

The Cashbridge Router runs as a separately operated service behind an authenticated HTTPS order API. Do not put its
wallet, xpub, database or RPC credentials on Vercel.
