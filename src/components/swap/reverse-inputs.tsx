'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Coins, Loader } from 'lucide-react'
import { USwapNumber } from '@tcswap/core'
import { DecimalInput } from '@/components/decimal/decimal-input'
import { DecimalText } from '@/components/decimal/decimal-text'
import { useBchWallet } from '@/components/bch-wallet'
import { BridgeAssetButton, BridgeAssetPicker, type BridgeInputProps } from '@/components/swap/bridge-asset-picker'
import { BridgeInputSwitcher } from '@/components/swap/bridge-input-switcher'
import { BridgeWalletBadge } from '@/components/swap/bridge-wallet-badge'
import { PriceImpact } from '@/components/swap/price-impact'
import { SwapQuoteTimer } from '@/components/swap/swap-quote-timer'
import { Tooltip } from '@/components/tooltip'
import { BridgeConfig } from '@/config'
import { useQuote } from '@/hooks/use-quote'
import { useRates } from '@/hooks/use-rates'
import { useAssetFrom } from '@/hooks/use-swap'
import { useTokenSale } from '@/hooks/use-token-sale'
import { listWalletCoins } from '@/lib/bch'
import { formatBaseUnits } from '@/lib/bridge'
import { formatUsd } from '@/lib/bridge-summary'
import type { CauldronToken } from '@/lib/cauldron-tokens'
import { DEPOSIT_FEE_RESERVE } from '@/lib/thorchain-deposit'
import { useSwapStore } from '@/store/swap-store'

// The reverse direction's form: the BCH side on top (BCH or a Cauldron token, sent from the bound
// BCH wallet) and the other chain's asset below (paid out by THORChain to the connected EVM wallet).

// What the bound address holds of the BCH-side asset: token-free BCH, or the token's fungible
// amount (outputs carrying an NFT are left alone). Only the bound address is seen, not the whole
// wallet, since that is the only address the bridge signs for.
export const useBchSideBalance = (token: CauldronToken | null) => {
  const { binding } = useBchWallet()
  const query = useQuery({
    queryKey: ['bch-side-balance', binding?.lockingBytecode],
    queryFn: () => listWalletCoins(binding!.lockingBytecode),
    enabled: !!binding,
    refetchInterval: 20_000,
    retry: 1
  })
  const utxos = query.data?.utxos
  const units = utxos
    ? token
      ? utxos.reduce((sum, u) => sum + (u.token?.category === token.category && !u.token.nft ? u.token.amount : 0n), 0n)
      : utxos.reduce((sum, u) => sum + (u.hasToken ? 0n : u.value), 0n)
    : undefined
  return { units, decimals: token ? token.decimals : 8, isLoading: query.isLoading && !!binding, refetch: query.refetch }
}

const useBchUsd = () => {
  const { rates } = useRates([BridgeConfig.buyAsset])
  const rate = rates[BridgeConfig.buyAsset]
  return rate ? Number(rate.toSignificant(12)) : undefined
}

export const BchInputFrom = ({ selecting, onSelectOpenChange }: BridgeInputProps) => {
  const t = useTranslations('bridge.form')
  const tSwap = useTranslations('swap')
  const token = useSwapStore(state => state.bchToken)
  const amountFrom = useSwapStore(state => state.amountFrom)
  const setAmountFrom = useSwapStore(state => state.setAmountFrom)
  const balance = useBchSideBalance(token)
  const sale = useTokenSale(token, amountFrom)
  const bchUsd = useBchUsd()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    onSelectOpenChange(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  // A token is valued at what its sale brings in BCH; BCH at its pool price.
  const sentBch = token ? (sale.quote ? Number(sale.quote.output) / 1e8 : undefined) : Number(amountFrom) || undefined
  const usd = sentBch !== undefined && bchUsd ? formatUsd(sentBch * bchUsd) : null
  // Sending all BCH leaves room for the deposit's fee.
  const max = balance.units === undefined ? undefined : token ? balance.units : balance.units - DEPOSIT_FEE_RESERVE

  return (
    <BridgeInputSwitcher selecting={selecting}>
      <div className="bridge-input-switcher__slot" aria-hidden={selecting} inert={selecting}>
        <section className="bridge-input" aria-label={t('from')}>
          <div className="bridge-input-heading">
            <BridgeAssetButton ref={trigger} bch token={token} aria-label={t('from')} aria-expanded={selecting} onClick={() => onSelectOpenChange(true)} />
            <BridgeWalletBadge kind="bch" />
          </div>
          <label htmlFor="swap-sell-amount" className="sr-only">
            {t('sendAmount')}
          </label>
          <div className="bridge-amount-row">
            <DecimalInput id="swap-sell-amount" className="bridge-amount" amount={amountFrom} onAmountChange={setAmountFrom} autoComplete="off" />
            {(balance.isLoading || max !== undefined) && (
              <Tooltip content={tSwap('balance.useMax')}>
                <button
                  type="button"
                  className="bridge-max-balance"
                  aria-label={tSwap('balance.useMax')}
                  disabled={max === undefined || max <= 0n}
                  onClick={() => max !== undefined && max > 0n && setAmountFrom(formatBaseUnits(max, balance.decimals))}
                >
                  <Coins size={15} aria-hidden="true" />
                  {balance.isLoading ? (
                    <Loader className="animate-spin" size={18} />
                  ) : (
                    <DecimalText amount={formatBaseUnits(balance.units ?? 0n, balance.decimals)} />
                  )}
                </button>
              </Tooltip>
            )}
          </div>
          <div className="bridge-input-meta">
            <span>{usd}</span>
          </div>
        </section>
      </div>
      <div className="bridge-input-switcher__slot bridge-input-switcher__picker-slot" aria-hidden={!selecting} inert={!selecting}>
        <BridgeAssetPicker side="from" bch open={selecting} onClose={close} />
      </div>
    </BridgeInputSwitcher>
  )
}

export const ReverseInputTo = ({ priceImpact, selecting, onSelectOpenChange }: BridgeInputProps & { priceImpact?: USwapNumber }) => {
  const t = useTranslations('bridge.form')
  const tSwap = useTranslations('swap')
  const asset = useAssetFrom()
  const { quote, isLoading, refetch, error } = useQuote()
  const { rates } = useRates(asset ? [asset.identifier] : [])
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    onSelectOpenChange(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const output = quote ? new USwapNumber(quote.expectedBuyAmount).toSignificant() : undefined
  const rate = asset ? rates[asset.identifier] : undefined
  const usd = quote && rate && !isLoading ? formatUsd(Number(quote.expectedBuyAmount) * Number(rate.toSignificant(12))) : undefined

  return (
    <BridgeInputSwitcher selecting={selecting}>
      <div className="bridge-input-switcher__slot" aria-hidden={selecting} inert={selecting}>
        <section className="bridge-input" aria-label={t('to')}>
          <div className="bridge-input-heading">
            <BridgeAssetButton ref={trigger} asset={asset} aria-label={t('to')} aria-expanded={selecting} onClick={() => onSelectOpenChange(true)} />
            <BridgeWalletBadge kind="other" />
          </div>
          <output className="bridge-amount" aria-label={t('receiveAmount')} aria-live="polite" aria-busy={isLoading}>
            {isLoading ? <span className="bridge-muted animate-pulse">···</span> : (output ?? '')}
          </output>
          <div className="bridge-input-meta">
            <span>{usd ?? (error && !isLoading ? t('noRoute') : t('receiveAmount'))}</span>
            <div className="flex items-center gap-2">
              {priceImpact && (
                <Tooltip content={tSwap('confirm.priceImpact')}>
                  <span>
                    <PriceImpact priceImpact={priceImpact} />
                  </span>
                </Tooltip>
              )}
              <SwapQuoteTimer quote={quote} isLoading={isLoading} refetch={refetch} />
            </div>
          </div>
        </section>
      </div>
      <div className="bridge-input-switcher__slot bridge-input-switcher__picker-slot" aria-hidden={!selecting} inert={!selecting}>
        <BridgeAssetPicker side="to" bch={false} open={selecting} onClose={close} />
      </div>
    </BridgeInputSwitcher>
  )
}
