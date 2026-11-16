# Cash Bridge

Move value from almost any chain into Bitcoin Cash, or straight into PUSD on Cauldron, and back again. No account, no sign-up: connect a wallet,
pick an amount, sign.

**Live: [cashbridge.space](https://www.cashbridge.space)** — open it, connect a wallet (or just look at the quote) and run a swap end to end.

## What you get

- **Fast.** The BCH side lands in the mempool within seconds and the app treats the swap as complete at 0-conf, so you don't wait for a block.
  The PUSD leg doesn't wait for a confirmation either; the confirm screen shows an estimated total time before you sign.
- **Clear, low fees.** Every cost is itemised in USD before you sign: source-chain gas, THORChain fees, Cauldron pool fee, the BCH miner fee
  and price impact. BCH transactions themselves cost a fraction of a cent.
- **Wide reach.** Bitcoin, Ethereum and other EVM chains, Solana, Tron, XRP, Litecoin, Dogecoin and more, bridged through THORChain liquidity.
  Land in native BCH, or in PUSD (and other Cauldron CashTokens) in one flow. The reverse direction is supported too.
- **Your wallets.** On the Bitcoin Cash side, connect with **WizardConnect** (Selene and others) or **WalletConnect v2** (Paytaca, Cashonize).
  On the source side use MetaMask, Rabby, Phantom, Trust Wallet, Brave, OKX, Vultisig, Exodus, Keplr, TronLink, Ledger, Trezor, or a keystore.
- **Non-custodial by default.** You sign every step in your own wallets. For forward transfers to PUSD there is an optional **Cashbridge
  Router** switch: sign once in the source wallet and the service briefly holds the BCH, buys PUSD on Cauldron and pays it straight to the
  recipient, with a fixed minimum and a BCH fallback. ERC-20 approval may still need a separate transaction. See the
  [transaction flows](docs/how-it-works.md) for exactly what is and isn't guaranteed.
- **Hard to lose track of.** Progress can be recovered from local history after a closed tab. With the Router, the order is saved before
  anything is broadcast, and if no trade meeting your minimum is available in time, the verified BCH is returned to your fallback address.
- **Speaks your language.** 20+ interface languages, light and dark themes, phone and desktop layouts.
- **Tested.** Types, the bridge and router test suites, i18n checks and a production build run on every push.

## How it works

1. THORChain swaps the source asset for native BCH.
2. Optionally, a second transaction trades that BCH for PUSD (or another CashToken) against live Cauldron pools.
3. The result is paid to your BCH wallet, or to a recipient address you choose.

The full manual and automatic sequences are in [docs/how-it-works.md](docs/how-it-works.md).

Forked from the [swap.thorchain.org](https://github.com/thorchain/swap.thorchain) interface.

## Development

Use Node.js 22.23.4, as in CI (minimum 22.22.2 on Node 22; see `package.json` for other supported versions).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Copy `.env.example` to `.env.local` and set `THORCHAIN_API_KEY` (server-only, never commit
it). Typecheck with `npx tsc --noEmit -p tsconfig.json`, run the bridge tests with `npm run test:bridge` and the router tests with
`npm run test:auto-bridge`.

## Deploying

The app is a standard Next.js build (`npm run build`, `output: 'standalone'`). On Vercel, import the repository and set the environment variables
from `.env.example` in the project settings; `THORCHAIN_API_KEY` must stay a server-side variable.

The Cashbridge Router runs as a separately operated service behind an authenticated HTTPS order API. Do not put its
wallet, xpub, database or RPC credentials on Vercel.
