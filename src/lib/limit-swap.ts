// THORChain makes a block about every six seconds.
const SECONDS_PER_BLOCK = 6

export const BLOCKS_PER_MINUTE = 60 / SECONDS_PER_BLOCK
export const BLOCKS_PER_HOUR = BLOCKS_PER_MINUTE * 60
export const BLOCKS_PER_DAY = BLOCKS_PER_HOUR * 24
export const BLOCKS_PER_3_DAYS = BLOCKS_PER_DAY * 3

// THORChain expires a limit order at `initial_block_height + interval`, where the interval comes
// from the memo and is capped by the STREAMINGLIMITSWAPMAXAGE mimir. Three days is the chain
// default and the fallback when mimir has not loaded yet.
export const DEFAULT_LIMIT_SWAP_MAX_AGE = BLOCKS_PER_3_DAYS

// Node operators pause limit orders by dropping STREAMINGLIMITSWAPMAXAGE to a handful of blocks
// rather than flipping ENABLEADVSWAPQUEUE. At a minute or less an order would expire about as soon
// as it is queued, so the limit flow is treated as unavailable.
export const MIN_LIMIT_SWAP_MAX_AGE = BLOCKS_PER_MINUTE

