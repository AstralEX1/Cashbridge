import { BridgeConfig } from '@/config'
import type { BchBinding } from '@/lib/bch'
import { minOutputFor } from '@/lib/bridge'
import { prepareArrival, type ArrivalSessionRecord } from '@/lib/arrival-session'
import { arrivalBinding, type ArrivalTerms } from '@/lib/swap-on-arrival'
import type { CauldronToken } from '@/lib/cauldron-tokens'

// Manual forward CashToken: try SwapOnArrival (browser trade key → contract P2SH). Any failure
// falls back to the wallet address and classic Manual Cauldron (Hashi runner pattern).

export const swapOnArrivalEnabled = () => BridgeConfig.swapOnArrival

export type ArrivalDestination =
  | { mode: 'arrival'; binding: BchBinding; terms: ArrivalTerms; session: ArrivalSessionRecord }
  | { mode: 'wallet'; binding: BchBinding; reason?: string }

export const prepareArrivalDestination = async ({
  owner,
  token,
  expectedBchSats,
  expectedTokenUnits,
  operationId
}: {
  owner: BchBinding
  token: CauldronToken
  expectedBchSats: bigint
  expectedTokenUnits: bigint
  operationId?: string
}): Promise<ArrivalDestination> => {
  if (!swapOnArrivalEnabled()) return { mode: 'wallet', binding: owner, reason: 'disabled' }
  if (expectedBchSats <= 0n || expectedTokenUnits <= 0n) {
    return { mode: 'wallet', binding: owner, reason: 'missing_quote' }
  }

  const rateNum = minOutputFor(expectedTokenUnits).toString()
  const rateDen = expectedBchSats.toString()
  if (BigInt(rateNum) <= 0n) return { mode: 'wallet', binding: owner, reason: 'floor_zero' }

  try {
    const session = await prepareArrival({
      ownerScript: owner.lockingBytecode,
      category: token.category,
      rateNum,
      rateDen,
      operationId
    })
    return { mode: 'arrival', binding: arrivalBinding(session.terms, 0), terms: session.terms, session }
  } catch (error) {
    return {
      mode: 'wallet',
      binding: owner,
      reason: error instanceof Error ? error.message : 'prepare_failed'
    }
  }
}
