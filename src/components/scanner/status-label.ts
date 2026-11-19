import type { ScanStatus } from '@/lib/scanner'

/** Human-readable scanner status; avoids a bare "Completed". */
export const statusLabel = (status: ScanStatus): string =>
  ({ completed: 'Settled', pending: 'In progress', refunded: 'Refunded', review: 'Needs review' })[status]
