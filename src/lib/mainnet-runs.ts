// Real transfers through this site, each checked on public explorers. The docs page /docs/mainnet and the
// scanner both list them.

const bch = (id: string) => `https://blockchair.com/bitcoin-cash/transaction/${id}`
const bsc = (hash: string) => `https://bscscan.com/tx/${hash}`
const avax = (hash: string) => `https://snowscan.xyz/tx/${hash}`
const base = (hash: string) => `https://basescan.org/tx/${hash}`
const eth = (hash: string) => `https://etherscan.io/tx/${hash}`
const ton = (hash: string) => `https://tonviewer.com/transaction/${hash}`
const nearIntents = (depositAddress: string) => `https://explorer.near-intents.org/transactions/${depositAddress}`
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
  },
  {
    date: '18 Nov 2026',
    router: true,
    route: 'ETH (Ethereum) → PUSD through THORChain, one signature',
    amounts: '0.0239214 ETH → 0.20364266 BCH → 42.77 PUSD',
    links: [
      ['ETH deposit (the only signature)', eth('0x8760d8dca4ef0469ff807c2224b103ced60d4a15a7a406f6bd73dbb12826bd59')],
      ['THORChain swap', thor('0x8760d8dca4ef0469ff807c2224b103ced60d4a15a7a406f6bd73dbb12826bd59')],
      ['BCH to order address', bch('0ecafc8a84a4cbcf42ab6b3b0f2995ae1b33fbf37d42dff1dfad41dc8665d114')],
      ['PUSD payout', bch('8a3d6c7398b8220deaeedd5bdeb4e39e894d008df939c0ac72555b241dedeaa1')]
    ]
  },
  {
    date: '19 Nov 2026',
    router: true,
    route: 'USDC (Base) → PUSD through THORChain, approval and deposit, order contract',
    amounts: '3 USDC → 0.01306603 BCH → 2.71 PUSD',
    links: [
      ['USDC approval', base('0x840444ab096bfda4a767bfb6e0e924b65cc8cd4b421654a611fe7b1419cf740b')],
      ['USDC deposit', base('0xe8660dc09f7976a12fbcce1638973412d2dec4c1de86b067ab98b8c64525e18c')],
      ['THORChain swap', thor('0xe8660dc09f7976a12fbcce1638973412d2dec4c1de86b067ab98b8c64525e18c')],
      ['BCH to order contract', bch('38b2f49613c07e9ef918c9612d192623730cda0919770b4efed3429ee55cd6d8')],
      ['PUSD payout', bch('15b4f826e22ed0b4982862f20b4f2781fb527cd72cc611aa14a5bd45b8a496f0')]
    ]
  },
  {
    date: '19 Nov 2026',
    router: true,
    route: 'ETH (Base) → PUSD through THORChain, one signature, order contract; the BCH came back',
    amounts: '0.00419841 ETH → 0.03481972 BCH → 0.03481596 BCH back',
    links: [
      ['ETH deposit (the only signature)', base('0x2b2bf1b709c126ca2ae49e7e505d961e4f306cb4199cc2bf2139cffb8f0ee04d')],
      ['THORChain swap', thor('0x2b2bf1b709c126ca2ae49e7e505d961e4f306cb4199cc2bf2139cffb8f0ee04d')],
      ['BCH to order contract', bch('93c651c63cbbdfc636d98fbac26dd2eda740dc90335e728e71f660fa05bce16b')],
      ['BCH refund', bch('cbc2a2b00b7c758997f81dc0b2f0d7447b04a24c6584ed79679078a0d3c63349')]
    ]
  },
  {
    date: '19 Nov 2026',
    router: true,
    route: 'PUSD → USDC (Base) through THORChain, one signature, sale contract',
    amounts: '2.71 PUSD → 0.01290603 BCH → 2.429573 USDC',
    links: [
      ['PUSD to sale contract (the only signature)', bch('7c9ce40ab7661f4623cbfad3990331d839a2c4c9b62101117bc655865e4a8eda')],
      ['Cauldron sale into the contract', bch('e7e04746a3db1c89113a90751d37e80807e86606a98831e79f92a44ad65cc1a0')],
      ['BCH deposit from the contract', bch('7cb8b6fac3b25f494d307660ccf0f97466661ed60e9d06ccde48ab60a6e2a4d8')],
      ['THORChain swap', thor('7cb8b6fac3b25f494d307660ccf0f97466661ed60e9d06ccde48ab60a6e2a4d8')],
      ['USDC payout', base('0x00451b7b4657184f3d5c1f6d0f6fad9cbdd564d50e99b31655791c6ad19161f7')]
    ]
  },
  {
    date: '20 Nov 2026',
    router: true,
    route: 'USDC (Base) → PUSD through NEAR Intents, one signature, order contract',
    amounts: '5 USDC → 0.02449021 BCH → 4.93 PUSD',
    links: [
      ['USDC deposit (the only signature)', base('0xc4f9d9ef1b3e0406908eac16aee46eb418111f27a2504f197da1177c41f6e35f')],
      ['NEAR Intents swap', nearIntents('0x435c854B89BE175F79f05AE9Ffbfc367D9F2052f')],
      ['BCH to order contract', bch('394584f5437ace7fa8688838ad989302ebb72337e7d5cdcc44fc5fa5d0ed22b8')],
      ['PUSD payout', bch('bcb7309b577e4063eb7b60b9b3bf805739553edf3f942e5cf76a3b7e944f8cb0')]
    ]
  },
  {
    date: '20 Nov 2026',
    router: true,
    route: 'PUSD → USDC (Base) through NEAR Intents, one signature, sale contract',
    amounts: '4.93 PUSD → 0.02492599 BCH → 4.962201 USDC',
    links: [
      ['PUSD to sale contract (the only signature)', bch('63b66a39947bd65d59cbe1b5a8aa54378a37e0c85d3b5809fe03df35b4677da7')],
      ['Cauldron sale into the contract', bch('a5a2cced6582bf9df79c68c96644a4381b9af333f38000d7aa3d3b848ff956a7')],
      ['BCH deposit from the contract', bch('69cfb82f9cff1d62106a3f68198e9047c9b54f4ff08b6857b474e10198b7ff96')],
      ['NEAR Intents swap', nearIntents('bitcoincash:qrmzp6fk7cstle77qt6q3mqc7y2rh9g9aqnljtr8w2')],
      ['USDC payout', base('0x0cda109863f29a7bf2d681e71f8f9671fd0a94b95208f4c86a94bfaea391f0dd')]
    ]
  },
  {
    date: '20 Nov 2026',
    router: true,
    route: 'USDC (Base) → PUSD through NEAR Intents, one signature, order contract',
    amounts: '99.8932 USDC → 0.49994357 BCH → 98.93 PUSD',
    links: [
      ['USDC deposit (the only signature)', base('0x890604ed3c895565571b122644022f7d3ec452e025ed89acd297aa011fddb3cb')],
      ['NEAR Intents swap', nearIntents('0x509c39ee45C24E0e42814a0E705F94095FA089ed')],
      ['BCH to order contract', bch('44fcf1b08c3c417e26ceb41ade7b9d562bfd30a34da597382b601f9525bd3190')],
      ['PUSD payout', bch('8a9b6c3acb9dd330ec3e54369568867232b3b53305cf8f932491f93c0a5e2ab5')]
    ]
  },
  {
    date: '20 Nov 2026',
    router: true,
    route: 'USDT (BNB Smart Chain) → PUSD through NEAR Intents, one signature, order contract',
    amounts: '1.97137 USDT → 0.00989847 BCH → 1.95 PUSD',
    links: [
      ['USDT deposit (the only signature)', bsc('0x589ae6780bdd454a0afa38c6e8c03b9c211e47e5dcb1c8947238eb6d268272ae')],
      ['NEAR Intents swap', nearIntents('0x65001523f7118e27D3820532357c2E4C59a862dB')],
      ['BCH to order contract', bch('6b5ffa400171a9df42301f0f912533f054e28c994fbf4f20dcc354717b3be2fe')],
      ['PUSD payout', bch('a1dd1067dc7b9fe9cbce05a8f9c37e1c2ef75fd733ab1a815ec2969460be92e0')]
    ]
  },
  {
    date: '20 Nov 2026',
    router: true,
    route: 'TON → PUSD through NEAR Intents, one signature, order contract',
    amounts: '2.68943 TON → 0.0139448 BCH → 2.61 PUSD',
    links: [
      ['TON deposit (the only signature)', ton('7935dc078f614b99f0b89bb262d97c92987bb0da3ea2bc380e5ccbb7fb7cfdc8')],
      ['NEAR Intents swap', nearIntents('UQAd3hu2yTWESAYp2ryqwhl8f8qzPeVHf9CtGahi6FDmKqJt')],
      ['BCH to order contract', bch('f73610484aba18031fa23e97f946f740f0b27286d21eb1d1d3cf1fb21a437911')],
      ['PUSD payout', bch('a363c0be8fe6749a4d94d3e5a1a6b4d10461cf9e98c05443e72305a8638b9618')]
    ]
  }
]
