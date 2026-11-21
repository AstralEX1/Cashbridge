// 1Click (NEAR Intents) ships no token logos, so its rows take CoinGecko's image for the catalog's own coingeckoId.
// Paths under coin-images.coingecko.com/coins/images/ (the 64 px "small" size); a coin added to the catalog later
// shows its ticker's first letter until it is added here.
const COINGECKO = 'https://coin-images.coingecko.com/coins/images/'

const BY_COINGECKO_ID: Record<string, string> = {
  aave: '12645/small/aave-token-round.png?1720472354',
  'adi-token': '68846/small/ADI_Token-min.png?1765296433',
  arbitrum: '16547/small/arb.jpg?1721358242',
  'aster-2': '69040/small/_ASTER.png?1757326782',
  'aurora-near': '20582/small/aurora.jpeg?1696519989',
  'avalanche-2': '12559/small/Avalanche_Circle_RedWhite_Trans.png?1696512369',
  'based-brett': '35529/small/1000050750.png?1709031995',
  'berachain-bera': '25235/small/BERA.png?1738822008',
  binancecoin: '825/small/bnb-icon2_2x.png?1696501970',
  bitcoin: '1/small/bitcoin.png?1696501400',
  'bitcoin-cash': '780/small/bitcoin-cash-circle.png?1696501932',
  'black-dragon': '35502/small/Untitled-8.png?1709390396',
  'book-of-meme': '36071/small/bome.png?1710407255',
  cardano: '975/small/cardano.png?1696502090',
  chainlink: '877/small/Chainlink_Logo_500.png?1760023405',
  coca: '52379/small/_COCA_Token_1.png?1733257913',
  'coinbase-wrapped-btc': '40143/small/cbbtc.webp?1726136727',
  'consumerfi-protocol': '70993/small/o6dyoqfbdes0qabkk4p6ed9ighgz.?1765019681',
  'cow-protocol': '24384/small/CoW-token_logo.png?1719524382',
  dai: '9956/small/Badge_Dai.png?1696509996',
  dash: '19/small/dash-logo.png?1696501423',
  dogecoin: '5/small/dogecoin.png?1696501409',
  dogwifcoin: '33566/small/dogwifhat.jpg?1702499428',
  ethereum: '279/small/ethereum.png?1696501628',
  'falcon-finance': '54558/small/ff_200_X_200.png?1740741076',
  'forgive-me-father': '51666/small/nZLzDdNi_400x400.jpg?1731729029',
  frax: '13422/small/LFRAX.png?1751911193',
  gmx: '18323/small/arbit.png?1696517814',
  gnosis: '662/small/logo_square_simple_300px.png?1696501854',
  hapi: '14298/small/Hapi_logo_square_%281%29.png?1696513995',
  'hemi-bitcoin': '67027/small/hemibtc.jpg?1751514905',
  'infinex-2': '70868/small/infinex.png?1764322875',
  'jambo-2': '68744/small/jambo.png?1756450646',
  kaito: '54411/small/Qm4DW488_400x400.jpg?1739552780',
  'kyber-network-crystal': '14899/small/RwdVsGcw_400x400.jpg?1696514562',
  litecoin: '2/small/litecoin.png?1696501400',
  loud: '66211/small/loud-logo.jpg?1748759689',
  'melania-meme': '53775/small/melania-meme.png?1737329885',
  'meta-pool': '24249/small/aB2d0Nmn_400x400.png?1696523434',
  'mog-coin': '31059/small/MOG_LOGO_200x200.png?1696529893',
  monad: '38927/small/mon.png?1766029057',
  'monerium-eur-money-2': '54303/small/eure.jpg?1739167959',
  'monerium-gbp-emoney': '39004/small/gbp.png?1719840784',
  near: '10365/small/near.jpg?1696510367',
  nearkat: '51737/small/nkimage.png?1753240872',
  'nearkat-2': '102176913/small/nearkat.jpg?1789019515',
  npro: '70983/small/npro_coin_squared_2x.png?1765013426',
  'official-trump': '53746/small/trump.png?1737171561',
  okb: '4463/small/WeChat_Image_20220118095654.png?1696505053',
  optimism: '25244/small/Token.png?1774456081',
  pepe: '29850/small/pepe-token.jpeg?1696528776',
  'polygon-ecosystem-token': '32440/small/pol.png?1759114181',
  publicai: '67977/small/publicai.jpg?1754478612',
  'pudgy-penguins': '52622/small/PUDGY_PENGUINS_PENGU_PFP.png?1733809110',
  'rhea-2': '67682/small/RHEA_Logo.png?1753517263',
  safe: '27032/small/Artboard_1_copy_8circle-1.png?1696526084',
  'shiba-inu': '11939/small/shiba.png?1696511800',
  shitzu: '24857/small/sFChtaUA_400x400.jpg?1696524017',
  solana: '4128/small/solana.png?1718769756',
  spx6900: '31401/small/centeredcoin_%281%29.png?1737048493',
  'staked-near': '24250/small/st-NEAR-token-white-dark-purple-circle.png?1696523435',
  starknet: '26433/small/starknet.png?1696525507',
  strkbtc: '102173511/small/strkBTC_Logo.png?1779888214',
  sui: '26375/small/sui-ocean-square.png?1727791290',
  sweatcoin: '25057/small/Sweat_-_logo-nov-2025.png?1762411781',
  tether: '325/small/Tether.png?1696501661',
  'tether-gold': '10481/small/logo.png?1774627372',
  'the-open-network': '17980/small/Gram_Circular_Badge.png?1781524778',
  'thor-wallet': '70474/small/TITNToken%281%29.png?1764103345',
  tron: '1094/small/photo_2026-04-13_09-59-16.png?1776048311',
  turbo: '30117/small/TurboMark-QL_200.png?1708079597',
  uniswap: '12504/small/uniswap-logo.png?1720676669',
  'usd-coin': '6319/small/USDC.png?1769615602',
  'usd1-wlfi': '54977/small/USD1_1000x1000_transparent.png?1749297002',
  usdt0: '53705/small/usdt0.jpg?1737086183',
  'venice-token': '54023/small/VVV_Token_Transparent.png?1741856877',
  'wrapped-bitcoin': '7598/small/WBTCLOGO.png?1764496367',
  'wrapped-near': '18280/small/EX4mrWMW_400x400.jpg?1696517773',
  'wrapped-steth': '18834/small/wstETH.png?1696518295',
  xdai: '11062/small/Identity-Primary-DarkBG.png?1696511004',
  zcash: '486/small/Brandmark-Yellow_%281%29.png?1785810558'
}

// Catalog rows with no CoinGecko id (or 1Click's own `custom:` one): the same coin found on CoinGecko by its
// contract, or the icon the NEAR token declares in its own ft_metadata (public/tokens).
const QUANTUS = `${COINGECKO}102171910/small/Token_Icon.png?1791345433`
const BY_ASSET_ID: Record<string, string> = {
  'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near': `${COINGECKO}102178575/small/2026-09-11_16.44.03.jpg?1790069661`,
  '1cs_v1:near:nep141:qtc.omft.near': QUANTUS,
  '1cs_v1:sol:spl:Bn9oW3GVKQdgNJG5w5P53dbuZfUtAehwFAniZYry68T8': QUANTUS,
  'nep141:abg-966.meme-cooking.near': '/tokens/abg.webp',
  'nep141:noear-324.meme-cooking.near': '/tokens/noear.webp',
  'nep141:gnear-229.meme-cooking.near': '/tokens/gnear.svg',
  'nep141:itlx.intellex_xyz.near': '/tokens/itlx.svg',
  'nep141:cnear.assetize.near': '/tokens/cnear.webp'
}

export const nearTokenLogo = ({ assetId, coingeckoId }: { assetId: string; coingeckoId?: string | null }): string | undefined => {
  const path = coingeckoId ? BY_COINGECKO_ID[coingeckoId] : undefined
  return BY_ASSET_ID[assetId] ?? (path && `${COINGECKO}${path}`)
}

// THORChain list rows whose own logo URL is gone (403): vTHOR from THORSwap's token list.
const THORCHAIN_LOGO_FIXES: Record<string, string> = {
  'ETH.VTHOR-0X815C23ECA83261B6EC689B60CC4A58B54BC24D8D':
    'https://static.thorswap.net/token-list/images/eth.vthor-0x815c23eca83261b6ec689b60cc4a58b54bc24d8d.png'
}

export const thorchainTokenLogo = (identifier: string, logoURI?: string) => THORCHAIN_LOGO_FIXES[identifier.toUpperCase()] ?? logoURI
