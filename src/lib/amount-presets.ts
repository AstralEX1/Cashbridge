// The amount chips next to the sell field: a quarter, half and three quarters of what can be
// spent, and the maximum as the last chip.
export const PRESET_PERCENTS = [25, 50, 75] as const

// A share of an amount in base units, rounded down so a chip never asks for more than is there.
export const percentOfUnits = (units: bigint, percent: number) => (units * BigInt(percent)) / 100n
