import { useState } from 'react'
import { Chain } from '@tcswap/core'
import { LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ChainSelect } from '@/components/connect-wallet/chain-select'
import { ALL_CHAINS, WalletParams } from '@/components/connect-wallet/config'
import { GenericButton } from '@/components/generic-button'
import { useWallets } from '@/hooks/use-wallets'

export const BrowserWallet = ({ wallet, chains, chain, onConnect }: { wallet: WalletParams; chains: (Chain | string)[]; chain?: Chain; onConnect: () => void }) => {
  const t = useTranslations('wallet')
  const availableChains: (Chain | string)[] = wallet.supportedChains.filter(c => ALL_CHAINS.includes(c))

  const [connecting, setConnecting] = useState(false)
  const [selectedChains, setSelectedChains] = useState<(Chain | string)[]>(chain && availableChains.includes(chain) ? [chain] : availableChains)
  const { connect } = useWallets()

  const handleConnect = async () => {
    if (connecting || !selectedChains.length) return
    setConnecting(true)

    connect(
      wallet.option,
      selectedChains.map(c => c as Chain)
    )
      .then(() => {
        onConnect()
      })
      .catch(() => {}) // The store reports the error; keep the dialog open for a retry.
      .finally(() => {
        setConnecting(false)
      })
  }

  const filteredChains = chains.filter(c => availableChains.includes(c))

  return (
    <>
      <ChainSelect chains={filteredChains} selectedChains={selectedChains} onChange={setSelectedChains} />

      <div className="flex p-4 pt-2 md:justify-end md:px-8 md:pb-8">
        <GenericButton
          colorType="3"
          size="large"
          className="w-full md:w-auto"
          disabled={connecting || selectedChains.length === 0}
          onClick={() => handleConnect()}
        >
          {connecting && <LoaderCircle size={20} className="animate-spin" />}
          {t('connectNamed', { name: wallet.label })}
        </GenericButton>
      </div>
    </>
  )
}
