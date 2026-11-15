# Cash Bridge

Bridge assets to Bitcoin Cash and PUSD. The first leg buys native BCH through [THORChain](https://www.thorchain.org); an optional second leg
swaps that BCH to PUSD on [Cauldron](https://app.cauldron.quest). Every step is signed in the user's own wallet: the site holds no funds and
takes no fee.

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
