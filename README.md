# Cash Bridge

Bridge THORChain assets to Bitcoin Cash and Cauldron CashTokens, and back. **Manual** is the default: the user signs in their own wallets.
For forward PUSD transfers, **Automatic** explicitly uses temporary service custody of BCH and the Cashbridge Router to pay PUSD directly to the
recipient, with a fixed minimum and BCH fallback. ERC-20 approval may still need a separate transaction. See the
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

Automatic execution additionally requires the separately operated Cashbridge Router and its authenticated HTTPS order API. Do not put its
wallet, xpub, database or RPC credentials on Vercel.
