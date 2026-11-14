import { useCallback, useEffect, useState } from 'react'
import { Chain, EVMChain, EVMChains } from '@tcswap/core'
import { getProvider } from '@tcswap/toolboxes/evm'

// An EIP-7702 delegated account stores a 23-byte designator - 0xef0100 followed by the address it
// delegates to - where a plain EOA stores no code at all.
const DELEGATION_DESIGNATOR = '0xef0100'

const NO_CODE = '0x'

export interface AddressCodeCheck {
  /** An EIP-7702 delegated account: an EOA that runs another contract's code. */
  isDelegated: boolean
  /** Deployed code that is not a delegation designator, i.e. an ordinary contract. */
  isContract: boolean
  /** The current value hasn't been read on-chain yet. */
  isChecking: boolean
  /** The read failed, so the address is neither cleared nor rejected until a retry succeeds. */
  isUnverified: boolean
  retry: () => void
}

// `code` is undefined when the read failed: a failure is never the same answer as "no code".
export interface CheckedCode {
  key: string
  code?: string
}

export const readAddressCode = (getCode: () => Promise<string>): Promise<string | undefined> =>
  getCode().then(
    code => (typeof code === 'string' ? code.toLowerCase() : undefined),
    () => undefined
  )

export const addressCodeState = (checked: CheckedCode, key: string, active: boolean): Omit<AddressCodeCheck, 'retry'> => {
  if (!active) return { isDelegated: false, isContract: false, isChecking: false, isUnverified: false }
  if (checked.key !== key) return { isDelegated: false, isContract: false, isChecking: true, isUnverified: false }
  const { code } = checked
  if (code === undefined) return { isDelegated: false, isContract: false, isChecking: false, isUnverified: true }
  return {
    isDelegated: code.startsWith(DELEGATION_DESIGNATOR),
    isContract: code !== NO_CODE && !code.startsWith(DELEGATION_DESIGNATOR),
    isChecking: false,
    isUnverified: false
  }
}

/**
 * Reads whether an EVM address carries code. THORChain pays a native outbound with the Router's
 * `to.send()`, which forwards only 2300 gas, so anything that executes on receipt - a contract or
 * an EIP-7702 delegate - reverts and the payout bounces back to the vault. Detecting it lets the
 * address be rejected before the swap instead of the funds being lost on the way out.
 *
 * Non-EVM chains are not checked. On an EVM chain an RPC that cannot be read leaves the address
 * unverified, and confirmation waits for a read that succeeds: an unknown destination is not a
 * safe one.
 */
export const useAddressCode = (address: string, chain: Chain, enabled = true): AddressCodeCheck => {
  const value = address.trim()
  const isEVM = EVMChains.includes(chain as EVMChain)
  const active = enabled && isEVM && value.length > 0
  const [attempt, setAttempt] = useState(0)
  const key = `${chain}:${value.toLowerCase()}:${attempt}`
  const [checked, setChecked] = useState<CheckedCode>({ key: '' })

  useEffect(() => {
    if (!active) return

    let cancelled = false
    readAddressCode(() => getProvider(chain as EVMChain).then(provider => provider.getCode(value))).then(code => {
      if (!cancelled) setChecked({ key, code })
    })

    return () => {
      cancelled = true
    }
  }, [key, value, chain, active])

  const retry = useCallback(() => setAttempt(n => n + 1), [])

  return { ...addressCodeState(checked, key, active), retry }
}
