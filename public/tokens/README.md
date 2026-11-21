# Token and protocol marks

Third-party marks, used only to identify the token and the exchange in this bridge's UI. They
belong to their owners; no licence is stated at the source.

- `pusd.svg`: ParyonUSD (PUSD, category `2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544`).
  The icon its BCMR metadata names (`uris.icon`), fetched from https://paryonusd.com/logo.svg on 2026-10-27
  (BCMR record via https://bcmr.paytaca.com/api/tokens/2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544/).
- `../providers/cauldron.png`: Cauldron DEX, the favicon of https://app.cauldron.quest (https://app.cauldron.quest/favicon.png),
  fetched on 2026-10-27.
- `usdc.svg`, `usdt.svg`: plain coin marks drawn here for the scanner (each issuer's colour and symbol), not the issuers' own artwork.
- `abg.webp`, `noear.webp`, `gnear.svg`, `itlx.svg`, `cnear.webp`: NEAR Intents tokens CoinGecko does not list. Each is the
  icon the token declares in its own `ft_metadata` on NEAR (`abg-966.meme-cooking.near`, `noear-324.meme-cooking.near`,
  `gnear-229.meme-cooking.near`, `itlx.intellex_xyz.near`, `cnear.assetize.near`). `cnear.webp` is scaled down to 64 px;
  `itlx.svg` is the declared mark padded to a square. Every other NEAR Intents token shows CoinGecko's image for the
  `coingeckoId` the 1Click catalog gives it (`src/lib/token-logos.ts`).
