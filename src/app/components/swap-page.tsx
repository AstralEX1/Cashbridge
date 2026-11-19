import Image from 'next/image'
import { Suspense } from 'react'
import { BlazeBanner } from '@/components/blaze-banner'
import { GlobalDialog } from '@/components/global-dialog'
import { Swap } from '@/components/swap/swap'
import { AppConfig } from '@/config'

export function SwapPage() {
  return (
    <main className="bridge-page">
      <BlazeBanner />
      <header className="mx-auto mb-8 flex w-full max-w-[514px] items-center gap-2.5">
        <Image src={AppConfig.logo} alt="" width={32} height={32} priority />
        <span className="text-lg font-semibold tracking-tight">{AppConfig.appName}</span>
      </header>
      <p className="sr-only">
        Bridge supported source assets to Bitcoin Cash and CashTokens through THORChain and Cauldron. Manual execution uses your own wallets.
        Automatic PUSD delivery uses temporary service custody of BCH and the Cashbridge Router.
      </p>
      <Suspense>
        <Swap />
      </Suspense>
      <GlobalDialog />
    </main>
  )
}
