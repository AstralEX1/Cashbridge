// Source identifiers are not BCH hashes: Solana is case-sensitive, and Cosmos can add an index.
export const sourceTransactionId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (/^(?:0x)?[a-f0-9]{64}$/i.test(text)) return text.replace(/^0x/i, '').toLowerCase()
  if (/^[a-f0-9]{64}-\d{1,12}$/i.test(text)) return text.toLowerCase()
  if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(text)) return text
  return undefined
}

export const sameSourceTransaction = (a: unknown, b: unknown) => {
  const first = sourceTransactionId(a)
  return first !== undefined && first === sourceTransactionId(b)
}

export const sourceIdFromMemo = (memo: string, action: 'OUT' | 'REFUND' = 'OUT') =>
  memo.slice(0, action.length + 1).toUpperCase() === `${action}:` ? sourceTransactionId(memo.slice(action.length + 1)) : undefined
