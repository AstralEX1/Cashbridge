'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Chain } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AssetIcon } from '@/components/asset-icon'
import { chainLabel } from '@/components/connect-wallet/config'
import { Asset } from '@/components/swap/asset'
import { Tooltip } from '@/components/tooltip'
import { isNearOnlyAsset, useModeAssets } from '@/hooks/use-assets'
import { useMimir } from '@/hooks/use-mimir'
import { useAssetFrom, useAssetTo, useSetAssetFrom, useSetAssetTo } from '@/hooks/use-swap'
import { isAssetHalted } from '@/lib/swap-helpers'
import { type CauldronToken, FEATURED_TOKENS, fetchCauldronTokens, sameToken, searchCauldronTokens } from '@/lib/cauldron-tokens'
import { isBridgeSellAsset, isReverseTargetAsset, useSwapStore } from '@/store/swap-store'
import { NearMark, ThorchainMark, TokenMark } from '@/components/swap/bridge-marks'

// THORChain's own per-chain table (scanning, trading, LP and signing), where a halted chain shows up.
const THORCHAIN_STATUS_URL = 'https://thorchain.net/network'

// A halted chain can't be traded, so its pills say whose switch it is and where to watch it come back.
// The wrapped element stays hoverable and focusable (a disabled button would swallow both).
const HaltedTip = ({ halted, children }: { halted: boolean; children: ReactElement }) => {
  const t = useTranslations('bridge.form')
  if (!halted) return children
  return (
    <Tooltip
      content={
        <>
          {t('haltedNetwork')}{' '}
          <a href={THORCHAIN_STATUS_URL} target="_blank" rel="noopener noreferrer" className="underline">
            {t('haltedStatus')}
          </a>
        </>
      }
    >
      {children}
    </Tooltip>
  )
}

// Token pills come in one after another; past the first dozen they all arrive together.
const rowIn = (index: number) => ({ '--bridge-row-index': Math.min(index, 12) }) as CSSProperties

export interface BridgeInputProps {
  selecting: boolean
  onSelectOpenChange: (open: boolean) => void
}

// `bch` shows the BCH side (native BCH when `token` is null); otherwise the other chain's `asset`.
export const BridgeAssetButton = ({
  asset,
  bch,
  token,
  ...props
}: ComponentProps<'button'> & { asset?: Asset; bch?: boolean; token?: CauldronToken | null }) => {
  const t = useTranslations('bridge.form')
  const chain = bch ? Chain.BitcoinCash : asset?.chain
  return (
    <button type="button" className="bridge-pill bridge-asset-button" {...props}>
      {chain ? (
        <>
          <span className="bridge-asset-icon" aria-hidden="true">
            <img src={`/networks/${chain.toLowerCase()}.svg`} width={22} height={22} alt="" />
          </span>
          <span>{chainLabel(chain)}</span>
          <span className="bridge-asset-icon" aria-hidden="true">
            {bch ? (
              token ? (
                <TokenMark token={token} size={22} />
              ) : (
                <img src="/networks/bch.svg" width={22} height={22} alt="" />
              )
            ) : asset ? (
              <AssetIcon asset={asset} className="size-[22px] [&_img]:size-[22px]" showNetworkIcons={false} />
            ) : null}
          </span>
          <span>{bch ? (token?.ticker ?? 'BCH') : asset?.ticker}</span>
        </>
      ) : (
        <span>{t('selectSource')}</span>
      )}
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  )
}

// The picker of one side of the form. `bch` lists native BCH and the Cauldron tokens (the BCH side
// in either direction); otherwise the other chain's assets: anything THORChain sells into BCH, or in
// the reverse direction the EVM assets it can pay out.
export const BridgeAssetPicker = ({ side, bch, open, onClose }: { side: 'from' | 'to'; bch: boolean; open: boolean; onClose: () => void }) => {
  const t = useTranslations('bridge.form')
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const setAssetFrom = useSetAssetFrom()
  const setAssetTo = useSetAssetTo()
  const reverse = useSwapStore(state => state.reverse)
  const openNetworks = useSwapStore(state => state.openNetworks)
  const other = side === 'from' ? assetTo : assetFrom
  const selected = side === 'to' && (openNetworks || !bch) ? assetTo : assetFrom
  const bchToken = useSwapStore(state => state.bchToken)
  const setBchToken = useSwapStore(state => state.setBchToken)
  const { assets: modeAssets, isLoading } = useModeAssets()
  const { mimir, mayaMimir } = useMimir()
  const [chain, setChain] = useState<Chain | undefined>(selected?.chain)
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const assets = useMemo(() => {
    if (!modeAssets) return []
    if (openNetworks) return modeAssets.filter(a => a.identifier !== other?.identifier)
    return modeAssets.filter(reverse ? isReverseTargetAsset : isBridgeSellAsset)
  }, [modeAssets, openNetworks, other?.identifier, reverse])
  const chains = useMemo(() => [...new Set(assets.map(a => a.chain))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [assets])
  const activeChain = bch ? Chain.BitcoinCash : (chain && chains.includes(chain) ? chain : selected && chains.includes(selected.chain) ? selected.chain : chains[0])
  const haltedChains = useMemo(
    () => new Set(chains.filter(item => assets.filter(a => a.chain === item).every(a => isAssetHalted(a, mimir, mayaMimir)))),
    [chains, assets, mimir, mayaMimir]
  )
  const query = search.trim().toLowerCase()
  const tokens = assets.filter(a => {
    if (a.chain !== activeChain) return false
    if (!query) return true
    const haystack = [a.ticker, a.name, a.identifier, chainLabel(a.chain)]
    // Searching "near" finds rows NEAR Intents lists (including NEAR-only Midgard gaps).
    if (a.providers?.includes(ProviderName.NEAR)) haystack.push('near', 'near intents')
    return haystack.some(value => value?.toLowerCase().includes(query))
  })

  const listed = useQuery({ queryKey: ['cauldron-tokens'], queryFn: fetchCauldronTokens, enabled: bch && open, staleTime: 5 * 60_000, retry: 1 })
  const deferredQuery = useDeferredValue(query)
  const searched = useQuery({
    queryKey: ['cauldron-token-search', deferredQuery],
    queryFn: () => searchCauldronTokens(deferredQuery),
    enabled: bch && open && deferredQuery.length >= 2,
    staleTime: 60_000,
    retry: false
  })
  const bchOptions = useMemo(() => {
    const all = [...(listed.data ?? FEATURED_TOKENS), ...(searched.data ?? [])]
    const unique = all.filter((token, i) => all.findIndex(other => sameToken(other, token)) === i)
    // A category id pasted whole finds its token; otherwise ticker and name are matched.
    return unique.filter(token => !query || token.category === query || [token.ticker, token.name].some(value => value?.toLowerCase().includes(query)))
  }, [listed.data, searched.data, query])
  const showBch = !query || 'bch bitcoin cash'.includes(query)

  useEffect(() => {
    if (!open) return
    setChain(selected?.chain)
    setSearch('')
    searchInput.current?.focus()
  }, [open, selected?.chain])

  const pickBch = (token: CauldronToken | null) => {
    setBchToken(token)
    onClose()
  }

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
          placeholder={t(bch ? 'searchTokens' : 'search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>
      <p className="bridge-picker-label">{t('chains')}</p>
      <div className="bridge-options" role="group" aria-label={t('chains')}>
        {(bch ? [Chain.BitcoinCash] : chains).map(item => (
          <HaltedTip key={item} halted={!bch && haltedChains.has(item)}>
            <button
              type="button"
              className="bridge-pill"
              data-halted={!bch && haltedChains.has(item) ? 'true' : undefined}
              aria-pressed={item === activeChain}
              onClick={() => setChain(item)}
            >
              <img src={`/networks/${item.toLowerCase()}.svg`} width={20} height={20} alt="" />
              {chainLabel(item)}
            </button>
          </HaltedTip>
        ))}
      </div>
      <p className="bridge-picker-label">{t('tokens')}</p>
      <div key={open ? activeChain : 'closed'} className="bridge-options bridge-token-options" role="group" aria-label={t('tokens')}>
        {bch ? (
          <>
            {showBch && (
              <button type="button" className="bridge-pill" style={rowIn(0)} aria-pressed={bchToken === null} onClick={() => pickBch(null)}>
                <img src="/networks/bch.svg" width={20} height={20} alt="" />
                BCH
              </button>
            )}
            {bchOptions.map((token, i) => (
              <button
                type="button"
                key={token.category}
                className="bridge-pill"
                style={rowIn(i + 1)}
                aria-pressed={sameToken(bchToken, token)}
                title={`${token.name ?? token.ticker} · ${token.category}`}
                onClick={() => pickBch(token)}
              >
                <TokenMark token={token} size={20} />
                {token.ticker}
              </button>
            ))}
          </>
        ) : (
          tokens.map((asset, i) => {
            const halted = isAssetHalted(asset, mimir, mayaMimir)
            const nearOnly = isNearOnlyAsset(asset)
            return (
              <HaltedTip key={asset.identifier} halted={halted}>
                <button
                  type="button"
                  className="bridge-pill"
                  style={rowIn(i)}
                  aria-pressed={selected?.identifier === asset.identifier}
                  aria-disabled={halted || undefined}
                  title={halted ? undefined : nearOnly ? `${asset.identifier} · NEAR Intents` : asset.identifier}
                  onClick={() => {
                    if (halted) return
                    if (side === 'to') setAssetTo(asset)
                    else setAssetFrom(asset)
                    onClose()
                  }}
                >
                  <AssetIcon asset={asset} className="size-5 [&_img]:size-5" showNetworkIcons={false} />
                  {asset.ticker}
                  {nearOnly && <NearMark size={14} />}
                </button>
              </HaltedTip>
            )
          })
        )}
      </div>
      {!bch && tokens.length === 0 && (
        <p className="bridge-picker-empty" role="status">
          <ThorchainMark size={18} />
          <NearMark size={18} />
          <span>{t(isLoading ? 'loading' : !modeAssets ? 'assetsUnavailable' : 'empty')}</span>
        </p>
      )}
      {bch && (listed.isLoading || searched.isFetching) && (
        <p className="bridge-muted text-sm" role="status">
          {t('loading')}
        </p>
      )}
      {bch && listed.isError && (
        <p className="bridge-picker-empty" role="status">
          <img src="/networks/bch.svg" width={18} height={18} alt="" className="bridge-mark" />
          <span>{t('tokensUnavailable')}</span>
        </p>
      )}
      {bch && <p className="bridge-muted mt-3 text-xs">{t('destinationNote')}</p>}
    </section>
  )
}
