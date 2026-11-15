import { Suspense } from 'react'
import { GlobalDialog } from '@/components/global-dialog'
import { Swap } from '@/components/swap/swap'

export function SwapPage() {
  return (
    <main className="bridge-page">
      <p className="sr-only">
        Bridge supported source assets to Bitcoin Cash through THORChain. Receive native BCH, or continue to PUSD with a separately signed Cauldron
        swap in your BCH wallet.
      </p>
      <Suspense>
        <Swap />
      </Suspense>
      <GlobalDialog />
    </main>
  )
}
