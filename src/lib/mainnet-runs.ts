// Real transfers through this site, each checked on public explorers. The docs page /docs/mainnet and the
// scanner both list them.

const bch = (id: string) => `https://blockchair.com/bitcoin-cash/transaction/${id}`
const bsc = (hash: string) => `https://bscscan.com/tx/${hash}`
const avax = (hash: string) => `https://snowscan.xyz/tx/${hash}`
// thorchain.net looks a swap up by its deposit hash, without 0x.
const thor = (hash: string) => `https://thorchain.net/tx/${hash.replace(/^0x/i, '').toLowerCase()}`

export type Run = { date: string; router?: boolean; route: string; amounts: string; links: [string, string][] }

// The same runs as the table in README.md. Add new runs at the bottom of both.
export const RUNS: Run[] = [
  {
    date: '17 Nov 2026',
    route: 'BCH → BNB (BNB Smart Chain)',
    amounts: '0.019 BCH → 0.00624508 BNB',
    links: [
      ['BCH deposit', bch('6d703a743adcf02f27f11407ba3383debd6365fd7cf7aa34ffb422968c342031')],
      ['THORChain swap', thor('6d703a743adcf02f27f11407ba3383debd6365fd7cf7aa34ffb422968c342031')],
      ['BNB payout', bsc('0x0E4F95150CC7232B8E55C95AB011CA4EF4883716E30379FC326D4852632F8555')]
    ]
  },
  {
    date: '17 Nov 2026',
    route: 'BNB → BCH → PUSD',
    amounts: '0.0062 BNB → 0.01639004 BCH → 3.39 PUSD',
    links: [
      ['BNB deposit', bsc('0x592eaa37bc2ca30efff2be5eb75b94bbb4819f1f1c99c4144c707aec7c5d8218')],
      ['THORChain swap', thor('0x592eaa37bc2ca30efff2be5eb75b94bbb4819f1f1c99c4144c707aec7c5d8218')],
      ['BCH payout', bch('92e5b363570ba683b3f519ce1c5256249c1c6f9cfdaf3af09d7ff35247061ba5')],
      ['PUSD purchase', bch('7c8a408cc401278ba6f6c1eda2aa9692de5eb8ea12a06d4f8ffdce6407e331fc')]
    ]
  },
  {
    date: '17 Nov 2026',
    route: 'PUSD → BCH → BNB',
    amounts: '3.39 PUSD → 0.01622613 BCH → 0.00527858 BNB',
    links: [
      ['PUSD sale', bch('a42ef6ed1dfe72ea9d6aa33d5438a34f5d86a24ed5db6ad53542bd53fe5552a7')],
      ['BCH deposit', bch('369ab490999475475869996741a6834ccb18d0bb9a821018d97d474f3d2d88a1')],
      ['THORChain swap', thor('369ab490999475475869996741a6834ccb18d0bb9a821018d97d474f3d2d88a1')],
      ['BNB payout', bsc('0x4CD293F0BFCC30D052061578745C38A00D7D06A8FD3F4912CCADAA46CC805384')]
    ]
  },
  {
    date: '17 Nov 2026',
    router: true,
    route: 'BNB → PUSD, one signature',
    amounts: '0.003 BNB → 1.51 PUSD',
    links: [
      ['BNB deposit (the only signature)', bsc('0x10eb6893cb6736b67fa4d6c0c6fc8fac30453faf65fc010665f2d657f05303e8')],
      ['THORChain swap', thor('0x10eb6893cb6736b67fa4d6c0c6fc8fac30453faf65fc010665f2d657f05303e8')],
      ['BCH to order address', bch('8b0d008f5c36749d15fe9d3b206ea7b283664d4c65f1734be4b06d7aad0e4f88')],
      ['PUSD payout', bch('0cf4ab532642433f0305339d003cecb9e0d826f69dcd58871d2cb255ebe4fde0')]
    ]
  },
  {
    date: '17 Nov 2026',
    route: 'BNB → BCH → MUSD',
    amounts: '0.0022 BNB → 0.00504863 BCH → 1.02 MUSD',
    links: [
      ['BNB deposit', bsc('0xea82f1c2744b9ea41a4f6e1d928708a3914ab4bbe411edd5663e3d83c1980759')],
      ['THORChain swap', thor('0xea82f1c2744b9ea41a4f6e1d928708a3914ab4bbe411edd5663e3d83c1980759')],
      ['BCH payout', bch('a6d7d4056baccc99e2fbcbfe6788b3e5fdefd9864d0c4071c362a31296275937')],
      ['MUSD purchase', bch('4edb9d9a879a70c45183f9fa56aa0350a61c8988b60a4f6d7feb80f527892202')]
    ]
  },
  {
    date: '17 Nov 2026',
    route: 'MUSD → BCH → BNB',
    amounts: '1.02 MUSD → 0.00492643 BCH → 0.00130668 BNB',
    links: [
      ['MUSD sale', bch('5523949b6b738a8a51b2621bef80daa590066b269725376adcdf4563861be6e3')],
      ['BCH deposit', bch('4de9d7f6c5fc0104065454163a339b548ffedcd56161186e68b87e07badbdd4f')],
      ['THORChain swap', thor('4de9d7f6c5fc0104065454163a339b548ffedcd56161186e68b87e07badbdd4f')],
      ['BNB payout', bsc('0x67074DC513DFE6169884283722E04434D58C477219F997BF86DF3DC45F16851E')]
    ]
  },
  {
    date: '17 Nov 2026',
    route: 'PUSD → BCH → AVAX',
    amounts: '1.51 PUSD → 0.00722206 BCH → 0.17553838 AVAX',
    links: [
      ['PUSD sale', bch('318e55dc4b912fc4c774d436a57d1d22fdfaa65dab92bf82a88e43bf35302d9c')],
      ['BCH deposit', bch('02c3d7eb5e199f49f7f55362e1e0f2664e83634439a719c158246ed99a06a210')],
      ['THORChain swap', thor('02c3d7eb5e199f49f7f55362e1e0f2664e83634439a719c158246ed99a06a210')],
      ['AVAX payout', avax('0xD8A8C83CCA712EDC8C805C331D9F66614B48BE637A2545AC3612525D091C87E5')]
    ]
  }
]
