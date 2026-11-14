'use client'

import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Chain } from '@tcswap/core'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AssetIcon } from '@/components/asset-icon'
import { chainLabel } from '@/components/connect-wallet/config'
import { Asset } from '@/components/swap/asset'
import { useModeAssets } from '@/hooks/use-assets'
import { useMimir } from '@/hooks/use-mimir'
import { useAssetFrom, useSetAssetFrom } from '@/hooks/use-swap'
import { isAssetHalted } from '@/lib/swap-helpers'
import { isBridgeSellAsset, useSwapStore } from '@/store/swap-store'
import { PusdMark } from '@/components/swap/bridge-marks'

export interface BridgeInputProps {
  selecting: boolean
  onSelectOpenChange: (open: boolean) => void
}

export const BridgeAssetButton = ({ asset, ticker, ...props }: ComponentProps<'button'> & { asset?: Asset; ticker?: string }) => {
  const t = useTranslations('bridge.form')
  const chain = asset?.chain ?? (ticker ? Chain.BitcoinCash : undefined)
  return (
    <button type="button" className="bridge-pill bridge-asset-button" {...props}>
      {chain ? (
        <>
          <span className="bridge-asset-icon" aria-hidden="true">
            <img src={`/networks/${chain.toLowerCase()}.svg`} width={22} height={22} alt="" />
          </span>
          <span>{chainLabel(chain)}</span>
          <span className="bridge-asset-icon" aria-hidden="true">
            {ticker === 'PUSD' ? (
              <PusdMark size={22} />
            ) : asset ? (
              <AssetIcon asset={asset} className="size-[22px] [&_img]:size-[22px]" showNetworkIcons={false} />
            ) : (
              <img src="/networks/bch.svg" width={22} height={22} alt="" />
            )}
          </span>
          <span>{ticker ?? asset?.ticker}</span>
        </>
      ) : (
        <span>{t('selectSource')}</span>
      )}
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  )
}

export const BridgeAssetPicker = ({ side, open, onClose }: { side: 'from' | 'to'; open: boolean; onClose: () => void }) => {
  const t = useTranslations('bridge.form')
  const selected = useAssetFrom()
  const setAssetFrom = useSetAssetFrom()
  const destination = useSwapStore(state => state.destinationAsset)
  const setDestination = useSwapStore(state => state.setDestinationAsset)
  const { assets: modeAssets, isLoading } = useModeAssets()
  const { mimir, mayaMimir } = useMimir()
  const [chain, setChain] = useState<Chain | undefined>(selected?.chain)
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const assets = useMemo(() => modeAssets?.filter(isBridgeSellAsset) ?? [], [modeAssets])
  const chains = useMemo(() => [...new Set(assets.map(a => a.chain))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [assets])
  const activeChain = side === 'to' ? Chain.BitcoinCash : (chain ?? selected?.chain ?? chains[0])
  const query = search.trim().toLowerCase()
  const tokens = assets.filter(
    a => a.chain === activeChain && [a.ticker, a.name, a.identifier, chainLabel(a.chain)].some(value => value?.toLowerCase().includes(query))
  )

  useEffect(() => {
    if (!open) return
    setChain(selected?.chain)
    setSearch('')
    searchInput.current?.focus()
  }, [open, selected?.chain])

  return (
    <section
      className="bridge-picker"
      aria-label={t(side === 'from' ? 'from' : 'to')}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <button type="button" className="bridge-pill bridge-picker-back" onClick={onClose}>
        <ChevronLeft size={16} aria-hidden="true" />
        {t(side === 'from' ? 'from' : 'to')}
        {activeChain && <img src={`/networks/${activeChain.toLowerCase()}.svg`} width={18} height={18} alt="" />}
      </button>
      <div className="bridge-search">
        <Search size={19} aria-hidden="true" />
        <input
          ref={searchInput}
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>
      <p className="bridge-picker-label">{t('chains')}</p>
      <div className="bridge-options" role="group" aria-label={t('chains')}>
        {(side === 'to' ? [Chain.BitcoinCash] : chains).map(item => (
          <button type="button" key={item} className="bridge-pill" aria-pressed={item === activeChain} onClick={() => setChain(item)}>
            <img src={`/networks/${item.toLowerCase()}.svg`} width={20} height={20} alt="" />
            {chainLabel(item)}
          </button>
        ))}
      </div>
      <p className="bridge-picker-label">{t('tokens')}</p>
      <div className="bridge-options bridge-token-options" role="group" aria-label={t('tokens')}>
        {side === 'from'
          ? tokens.map(asset => {
              const halted = isAssetHalted(asset, mimir, mayaMimir)
              return (
                <button
                  type="button"
                  key={asset.identifier}
                  className="bridge-pill"
                  aria-pressed={selected?.identifier === asset.identifier}
                  disabled={halted}
                  title={halted ? t('halted') : asset.identifier}
                  onClick={() => {
                    setAssetFrom(asset)
                    onClose()
                  }}
                >
                  <AssetIcon asset={asset} className="size-5 [&_img]:size-5" showNetworkIcons={false} />
                  {asset.ticker}
                </button>
              )
            })
          : ['BCH', 'PUSD', 'RES', 'NIGGA']
              .filter(ticker => ticker.toLowerCase().includes(query) || 'bitcoin cash'.includes(query))
              .map(ticker => {
                const available = ticker === 'BCH' || ticker === 'PUSD'
                return (
                  <button
                    type="button"
                    key={ticker}
                    className="bridge-pill"
                    aria-pressed={destination === ticker}
                    disabled={!available}
                    title={available ? ticker : t('unavailable')}
                    onClick={() => {
                      if (ticker === 'BCH' || ticker === 'PUSD') setDestination(ticker)
                      onClose()
                    }}
                  >
                    {ticker === 'BCH' ? (
                      <img src="/networks/bch.svg" width={20} height={20} alt="" />
                    ) : ticker === 'PUSD' ? (
                      <PusdMark size={20} />
                    ) : (
                      <span className="bridge-token-mark" aria-hidden="true">
                        {ticker[0]}
                      </span>
                    )}
                    {ticker}
                    {!available && <span className="text-[10px]">{t('unavailableShort')}</span>}
                  </button>
                )
              })}
      </div>
      {side === 'from' && tokens.length === 0 && (
        <p className="bridge-muted text-sm" role="status">
          {t(isLoading ? 'loading' : !modeAssets ? 'assetsUnavailable' : 'empty')}
        </p>
      )}
      {side === 'to' && <p className="bridge-muted mt-3 text-xs">{t('destinationNote')}</p>}
    </section>
  )
}
