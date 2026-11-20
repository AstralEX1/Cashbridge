import Image from 'next/image'
import Link from 'next/link'
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
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
          <Image src={AppConfig.logo} alt="" width={32} height={32} priority />
          <span className="text-lg font-semibold tracking-tight">{AppConfig.appName}</span>
        </Link>
        {[
          ['/scanner', 'Scanner'],
          ['/docs', 'Docs']
        ].map(([href, label], i) => (
          <Link
            key={href}
            href={href}
            className={`${i === 0 ? 'ml-auto ' : ''}rounded-md px-2 py-1 text-sm font-medium opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2`}
          >
            {label}
          </Link>
        ))}
      </header>
      <p className="sr-only">
        Bridge supported source assets to Bitcoin Cash and CashTokens through THORChain, NEAR Intents or ShapeShift, and Cauldron. Manual execution uses your own wallets.
        With the Cashbridge Router, the BCH waits in a contract made for each order, which can only pay out the token or refund the BCH.
      </p>
      <Suspense>
        <Swap />
      </Suspense>
      <GlobalDialog />
    </main>
  )
}
