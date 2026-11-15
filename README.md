# Cash Bridge

Bridge THORChain assets to Bitcoin Cash and Cauldron CashTokens, and back. Live at https://www.cashbridge.space.

By default the user signs every step in their own wallets. For forward transfers to PUSD, the **Cashbridge Router** switch lets the user sign
once in the source wallet: the service briefly takes custody of the BCH, buys PUSD on Cauldron and pays it straight to the recipient, with a
fixed minimum and a BCH fallback. ERC-20 approval may still need a separate transaction. See the
[transaction flows](docs/how-it-works.md).

Forked from the [swap.thorchain.org](https://github.com/thorchain/swap.thorchain) interface.

## Development

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
