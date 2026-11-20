export const controls = { source: 'completed', payout: undefined, lookups: [], byHash: [] }
export const getTransferStatus = async () => controls.source
export const confirmPayout = async expect => { controls.lookups.push(expect); return controls.payout }
export const destinationChainOf = buyAsset => buyAsset.split('.')[0].toUpperCase()
export const payoutByHash = async (chain, hash, expect) => { controls.byHash.push({ chain, hash, expect }); return controls.payout }
