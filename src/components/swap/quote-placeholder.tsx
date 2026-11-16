'use client'

import { useState } from 'react'

// The last amount that was shown, kept while a new quote loads.
export const useLastValue = (value: string | undefined) => {
  const [last, setLast] = useState(value)
  if (value !== undefined && value !== last) setLast(value)
  return last
}

// While a quote loads: the previous amount with a light sweeping across it, or a skeleton bar when
// there is no amount yet.
export const QuotePlaceholder = ({ previous }: { previous?: string }) =>
  previous ? <span className="bridge-amount-sheen">{previous}</span> : <span className="bridge-skeleton bridge-skeleton--amount" />

// A short skeleton bar for the USD line under the amount.
export const MetaSkeleton = () => <span className="bridge-skeleton bridge-skeleton--meta" aria-hidden="true" />
