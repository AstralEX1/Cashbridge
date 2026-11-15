import Image from 'next/image'
import { Suspense } from 'react'
import { GlobalDialog } from '@/components/global-dialog'
import { Swap } from '@/components/swap/swap'
import { AppConfig } from '@/config'

export function SwapPage() {
  return (
    <main className="bridge-page">
      <header className="mx-auto mb-8 flex w-full max-w-[514px] items-center gap-2.5">
        <Image src={AppConfig.logo} alt="" width={32} height={32} priority />
        <span className="text-lg font-semibold tracking-tight">{AppConfig.appName}</span>
      </header>
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
