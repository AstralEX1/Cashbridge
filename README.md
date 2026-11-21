# Cash Bridge

Bridge assets to Bitcoin Cash and Cauldron CashTokens, and back. Live at https://www.cashbridge.space.

Three bridges carry the BCH path: [THORChain](https://thorchain.org), [NEAR Intents](https://docs.near-intents.org) (1Click) and [ShapeShift](https://shapeshift.com) (public swap API). Each is quoted wherever it carries the pair: plain BCH both ways, CashTokens both ways (Manual, and the Cashbridge Router when it admits the route), and **Any network** free pairs. The form shows what each would deliver after the gas its deposit costs on the source chain, and takes the best one. NEAR Intents and ShapeShift are plain transfers to a one-use deposit address, with no Cashbridge contract on that leg; their payouts are checked on the destination chain like THORChain’s. ShapeShift’s BCH quotes are NEAR Intents swaps underneath, so the page and the Router check each one against 1Click before it is used.

By default (**Manual**) the user signs every step in their own wallets. For transfers that settle a Cauldron token (and for plain BCH when you prefer), the **Cashbridge Router** lets the user sign once in the source wallet while the service finishes settlement under the order’s terms. When the service returns a contract order (`apiVersion=2`), the deposit is a per-order P2SH purchase or sale covenant: spending is limited to paying the quoted minimum (or the fixed THORChain deposit on a sale) or returning funds to the fallback; after `refundAfter` (set about three hours from order creation; Bitcoin Cash median time runs about an hour behind wall clock) anyone may return them on those terms. Legacy orders used temporary P2PKH custody; the two oldest Router rows in [Proof on mainnet](#proof-on-mainnet) are that model, and the later ones ran through the contracts. ERC-20 approval may still need a separate transaction. See the [docs](https://www.cashbridge.space/docs), [transaction flows](docs/how-it-works.md) and [security and custody](https://www.cashbridge.space/docs/security).

Promo film on the landing page: [`/landing/cashbridge-promo.mp4`](https://www.cashbridge.space/).

AI agents use the MCP server at `https://www.cashbridge.space/mcp`: list assets, quote (THORChain, NEAR Intents, ShapeShift), prepare an unsigned deposit for the user’s wallet (including Cashbridge Router purchase/sale and Any-network free pairs), report the source tx, and read status. The server holds no keys. Add it with `claude mcp add --transport http cash-bridge https://www.cashbridge.space/mcp`; see the [agent docs](https://www.cashbridge.space/docs/agents).

Forked from the [swap.thorchain.org](https://github.com/thorchain/swap.thorchain) interface.

## Strengths

- With the Cashbridge Router you sign once, in the source wallet, whichever of THORChain, NEAR Intents and ShapeShift carries the BCH. The Router buys the token on Cauldron and pays it out. An ERC-20 token sent through THORChain may need an approval first.
- Bridging back takes one signature as well: your BCH wallet sends the token to a sale contract, and the Router sells it and deposits the BCH to the bridge.
- THORChain, NEAR Intents and ShapeShift are quoted side by side, each with what it would deliver and how long it takes. The form picks the one that delivers the most, and you can pick another.
- The Router finishes the transfer after you close the tab. Until then the BCH waits in a contract made for that order, which can only pay out the token or give the BCH back.
- You can receive without connecting a wallet: paste a token-aware `bitcoincash:z…` address for PUSD, or the payout address on the other chain when you bridge back.
- PUSD, MUSD, plain BCH and any other token with a Cauldron pool.
- USDC and USDT on the EVM chains, Solana, TRON, TON, Sui and NEAR, among more than 20 source chains.
- WizardConnect and WalletConnect on Bitcoin Cash. On the other chains, WalletConnect and browser, mobile and hardware wallets, Ledger and Trezor included.
- Cash Bridge charges no fee of its own. Network, bridge and pool fees are shown before you sign.
- The scanner finds a wallet's transfers from any device and links every transaction.
- The interface comes in 24 languages, and AI agents can quote and prepare transfers over MCP.
- Real transfers on mainnet, each step linked to a public explorer. See [Proof on mainnet](#proof-on-mainnet).

## How Cash Bridge meets the bounty

Cash Bridge is an entry for the BCH BLAZE 2026 [Stablecoin Bridge bounty](https://bchblaze.cash/bounties/stablecoin-bridge/). The same list, with links into the app, is at [/docs/bounty](https://www.cashbridge.space/docs/bounty).

| The bounty asks | Cash Bridge |
|---|---|
| "convert stablecoins on other chains to BCH stablecoins (eg USDC on ETH into PUSD on BCH)" | USDC and USDT on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Solana, TRON and more, to PUSD, MUSD or any Cauldron token, through THORChain, NEAR Intents or ShapeShift and then Cauldron. [Try it](https://www.cashbridge.space/sell-ETH.USDC-buy-PUSD) |
| "And vice-versa, BCH stables to other-chain stables (eg PUSD on BCH into USDC on ETH)" | PUSD, MUSD or any Cauldron token back to USDC, USDT or any asset the three bridges pay out. [Try it](https://www.cashbridge.space/sell-PUSD-buy-ETH.USDC) |
| "from BCH stables to multiple/any other ecosystems would be even better" | More than 20 source chains. Stablecoins come from the EVM chains, Solana, TRON, TON, Sui and NEAR |
| "The faster, cheaper, and easier to use the bridge is - the better." | The token is bought as soon as the bridge's BCH reaches the mempool, and the Cashbridge Router finishes after the tab closes. No Cash Bridge fee: three bridges are quoted side by side and the best one is picked. One signature each way with the Router. 24 interface languages and an MCP server for agents |
| "On the BCH side, WizardConnect is highly recommended." | WizardConnect for Selene, Paytaca and any WizardConnect wallet; WalletConnect for Cashonize and Zapit. [Wallets](https://www.cashbridge.space/docs/wallets) |
| "On the other chain side, WalletConnect is probably essential" | WalletConnect, plus browser, mobile and hardware wallets |
| Stretch: more than one BCH stablecoin | PUSD and MUSD, and any token with a Cauldron pool |
| Stretch: "route through large popular and existing multicoin providers like ShapeShift, ThorChain etc." | THORChain, NEAR Intents and ShapeShift, each quoted wherever it carries the pair |
| "ParyonUSD … first priority integration & demo" | PUSD is the default destination, identified by its category id |
| Mainnet Track: a BCH mainnet transaction | Every transfer, with explorer links. See [Proof on mainnet](#proof-on-mainnet) |

## Use Cash Bridge

1. Open the [bridge](https://www.cashbridge.space/bridge), choose the source asset and receive BCH, PUSD, MUSD or another Cauldron token.
2. Enter an amount, connect the source wallet and choose the BCH recipient. In Manual mode, connect your BCH wallet to sign the token purchase; with the Cashbridge Router, you can paste a receiving address.
3. Review the route (THORChain, NEAR Intents or ShapeShift, whichever quote), minimum, fees and fallback before signing. Follow the transfer on its progress screen, and later in the [scanner](https://www.cashbridge.space/scanner) by wallet address, with links to its transactions.

To bridge back, reverse the form. Manual mode sells the CashToken to BCH and then asks your BCH wallet to sign the bridge deposit. When available, Router sales let your wallet send the token to a sale contract; the service sells it and deposits the BCH to the chosen bridge (THORChain’s vault with the agreed memo, or a NEAR Intents or ShapeShift deposit address), or returns the funds. These are several on-chain steps, not an atomic swap. See [bridging back](https://www.cashbridge.space/docs/guides/bridge-from-bch).

The [wallet guide](https://www.cashbridge.space/docs/wallets) covers WizardConnect and WalletConnect on BCH, and browser, mobile and hardware wallets on the other chains. Availability depends on the wallet and network. Cash Bridge adds no application fee; network, bridge and Cauldron pool fees still apply, and liquidity and provider limits affect each quote. See [fees and limits](https://www.cashbridge.space/docs/fees).

The scanner finds a wallet's Router orders and THORChain swaps from any device, and this browser's own transfers on this device. The Router service continues an order after the tab closes; Manual steps still need your wallet. If a wallet answer is lost, check the transaction or use **Already paid?** before sending again. See [tracking and recovery](https://www.cashbridge.space/docs/guides/track-a-transfer).

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
| 18 Nov 2026 | **Cashbridge Router** | ETH (Ethereum) → PUSD through THORChain, one signature | 0.0239214 ETH → 0.20364266 BCH → 42.77 PUSD | [ETH deposit (the only signature)](https://etherscan.io/tx/0x8760d8dca4ef0469ff807c2224b103ced60d4a15a7a406f6bd73dbb12826bd59) · [THORChain swap](https://thorchain.net/tx/8760d8dca4ef0469ff807c2224b103ced60d4a15a7a406f6bd73dbb12826bd59) · [BCH to order address](https://blockchair.com/bitcoin-cash/transaction/0ecafc8a84a4cbcf42ab6b3b0f2995ae1b33fbf37d42dff1dfad41dc8665d114) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/8a3d6c7398b8220deaeedd5bdeb4e39e894d008df939c0ac72555b241dedeaa1) |
| 19 Nov 2026 | **Cashbridge Router** | USDC (Base) → PUSD through THORChain, approval and deposit, order contract | 3 USDC → 0.01306603 BCH → 2.71 PUSD | [USDC approval](https://basescan.org/tx/0x840444ab096bfda4a767bfb6e0e924b65cc8cd4b421654a611fe7b1419cf740b) · [USDC deposit](https://basescan.org/tx/0xe8660dc09f7976a12fbcce1638973412d2dec4c1de86b067ab98b8c64525e18c) · [THORChain swap](https://thorchain.net/tx/e8660dc09f7976a12fbcce1638973412d2dec4c1de86b067ab98b8c64525e18c) · [BCH to order contract](https://blockchair.com/bitcoin-cash/transaction/38b2f49613c07e9ef918c9612d192623730cda0919770b4efed3429ee55cd6d8) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/15b4f826e22ed0b4982862f20b4f2781fb527cd72cc611aa14a5bd45b8a496f0) |
| 19 Nov 2026 | **Cashbridge Router** | ETH (Base) → PUSD through THORChain, one signature, order contract; the BCH came back | 0.00419841 ETH → 0.03481972 BCH → 0.03481596 BCH back | [ETH deposit (the only signature)](https://basescan.org/tx/0x2b2bf1b709c126ca2ae49e7e505d961e4f306cb4199cc2bf2139cffb8f0ee04d) · [THORChain swap](https://thorchain.net/tx/2b2bf1b709c126ca2ae49e7e505d961e4f306cb4199cc2bf2139cffb8f0ee04d) · [BCH to order contract](https://blockchair.com/bitcoin-cash/transaction/93c651c63cbbdfc636d98fbac26dd2eda740dc90335e728e71f660fa05bce16b) · [BCH refund](https://blockchair.com/bitcoin-cash/transaction/cbc2a2b00b7c758997f81dc0b2f0d7447b04a24c6584ed79679078a0d3c63349) |
| 19 Nov 2026 | **Cashbridge Router** | PUSD → USDC (Base) through THORChain, one signature, sale contract | 2.71 PUSD → 0.01290603 BCH → 2.429573 USDC | [PUSD to sale contract (the only signature)](https://blockchair.com/bitcoin-cash/transaction/7c9ce40ab7661f4623cbfad3990331d839a2c4c9b62101117bc655865e4a8eda) · [Cauldron sale into the contract](https://blockchair.com/bitcoin-cash/transaction/e7e04746a3db1c89113a90751d37e80807e86606a98831e79f92a44ad65cc1a0) · [BCH deposit from the contract](https://blockchair.com/bitcoin-cash/transaction/7cb8b6fac3b25f494d307660ccf0f97466661ed60e9d06ccde48ab60a6e2a4d8) · [THORChain swap](https://thorchain.net/tx/7cb8b6fac3b25f494d307660ccf0f97466661ed60e9d06ccde48ab60a6e2a4d8) · [USDC payout](https://basescan.org/tx/0x00451b7b4657184f3d5c1f6d0f6fad9cbdd564d50e99b31655791c6ad19161f7) |
| 20 Nov 2026 | **Cashbridge Router** | USDC (Base) → PUSD through NEAR Intents, one signature, order contract | 5 USDC → 0.02449021 BCH → 4.93 PUSD | [USDC deposit (the only signature)](https://basescan.org/tx/0xc4f9d9ef1b3e0406908eac16aee46eb418111f27a2504f197da1177c41f6e35f) · [NEAR Intents swap](https://explorer.near-intents.org/transactions/0x435c854B89BE175F79f05AE9Ffbfc367D9F2052f) · [BCH to order contract](https://blockchair.com/bitcoin-cash/transaction/394584f5437ace7fa8688838ad989302ebb72337e7d5cdcc44fc5fa5d0ed22b8) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/bcb7309b577e4063eb7b60b9b3bf805739553edf3f942e5cf76a3b7e944f8cb0) |
| 20 Nov 2026 | **Cashbridge Router** | PUSD → USDC (Base) through NEAR Intents, one signature, sale contract | 4.93 PUSD → 0.02492599 BCH → 4.962201 USDC | [PUSD to sale contract (the only signature)](https://blockchair.com/bitcoin-cash/transaction/63b66a39947bd65d59cbe1b5a8aa54378a37e0c85d3b5809fe03df35b4677da7) · [Cauldron sale into the contract](https://blockchair.com/bitcoin-cash/transaction/a5a2cced6582bf9df79c68c96644a4381b9af333f38000d7aa3d3b848ff956a7) · [BCH deposit from the contract](https://blockchair.com/bitcoin-cash/transaction/69cfb82f9cff1d62106a3f68198e9047c9b54f4ff08b6857b474e10198b7ff96) · [NEAR Intents swap](https://explorer.near-intents.org/transactions/bitcoincash:qrmzp6fk7cstle77qt6q3mqc7y2rh9g9aqnljtr8w2) · [USDC payout](https://basescan.org/tx/0x0cda109863f29a7bf2d681e71f8f9671fd0a94b95208f4c86a94bfaea391f0dd) |
| 20 Nov 2026 | **Cashbridge Router** | USDC (Base) → PUSD through NEAR Intents, one signature, order contract | 99.8932 USDC → 0.49994357 BCH → 98.93 PUSD | [USDC deposit (the only signature)](https://basescan.org/tx/0x890604ed3c895565571b122644022f7d3ec452e025ed89acd297aa011fddb3cb) · [NEAR Intents swap](https://explorer.near-intents.org/transactions/0x509c39ee45C24E0e42814a0E705F94095FA089ed) · [BCH to order contract](https://blockchair.com/bitcoin-cash/transaction/44fcf1b08c3c417e26ceb41ade7b9d562bfd30a34da597382b601f9525bd3190) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/8a9b6c3acb9dd330ec3e54369568867232b3b53305cf8f932491f93c0a5e2ab5) |
| 20 Nov 2026 | **Cashbridge Router** | USDT (BNB Smart Chain) → PUSD through NEAR Intents, one signature, order contract | 1.97137 USDT → 0.00989847 BCH → 1.95 PUSD | [USDT deposit (the only signature)](https://bscscan.com/tx/0x589ae6780bdd454a0afa38c6e8c03b9c211e47e5dcb1c8947238eb6d268272ae) · [NEAR Intents swap](https://explorer.near-intents.org/transactions/0x65001523f7118e27D3820532357c2E4C59a862dB) · [BCH to order contract](https://blockchair.com/bitcoin-cash/transaction/6b5ffa400171a9df42301f0f912533f054e28c994fbf4f20dcc354717b3be2fe) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/a1dd1067dc7b9fe9cbce05a8f9c37e1c2ef75fd733ab1a815ec2969460be92e0) |
| 20 Nov 2026 | **Cashbridge Router** | TON → PUSD through NEAR Intents, one signature, order contract | 2.68943 TON → 0.0139448 BCH → 2.61 PUSD | [TON deposit (the only signature)](https://tonviewer.com/transaction/7935dc078f614b99f0b89bb262d97c92987bb0da3ea2bc380e5ccbb7fb7cfdc8) · [NEAR Intents swap](https://explorer.near-intents.org/transactions/UQAd3hu2yTWESAYp2ryqwhl8f8qzPeVHf9CtGahi6FDmKqJt) · [BCH to order contract](https://blockchair.com/bitcoin-cash/transaction/f73610484aba18031fa23e97f946f740f0b27286d21eb1d1d3cf1fb21a437911) · [PUSD payout](https://blockchair.com/bitcoin-cash/transaction/a363c0be8fe6749a4d94d3e5a1a6b4d10461cf9e98c05443e72305a8638b9618) |

**Manual**: the user signs each step in their own wallets. **Cashbridge Router**: the user signs once, in the source wallet or,
for a sale, in the BCH wallet, and the Cashbridge Router does the Cauldron trade and pays out (an ERC-20 token sent through
THORChain also needs an approval, as in the 3 USDC row). The two Router rows without "contract" used a legacy P2PKH order
address; the others ran through a per-order purchase or sale contract. In the ETH (Base) row the order contract gave the BCH
back to the user's fallback address instead of buying PUSD. Every THORChain and NEAR Intents swap above finished without a
refund, and its payout is the transaction listed next to it. The runs moved $1 to $100 each. On the first Router run the
Cashbridge Router delivered 1.51 PUSD 5.7 minutes after the single BNB signature (quote 1.50, minimum 1.48).

## Development

Use Node.js 22.23.4, as in CI (minimum 22.22.2 on Node 22; see `package.json` for other supported versions).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Copy `.env.example` to `.env.local` and set `THORCHAIN_API_KEY` (server-only, never commit
it). Optional: `NEAR_INTENTS_JWT` from the 1Click Partner Dashboard drops the keyless +25 bps surcharge.
Typecheck with `npx tsc --noEmit -p tsconfig.json` and run the bridge tests with `npm run test:bridge`.

## Deploying

The app is a standard Next.js build (`npm run build`, `output: 'standalone'`). On Vercel, import the repository and set the environment variables
from `.env.example` in the project settings; `THORCHAIN_API_KEY` must stay a server-side variable.

The Cashbridge Router runs as a separately operated service behind an authenticated HTTPS order API. Do not put its
wallet, xpub, database or RPC credentials on Vercel.
