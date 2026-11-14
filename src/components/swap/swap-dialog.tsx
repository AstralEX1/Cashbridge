import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Chain, FeeOption, getChainConfig, USwapNumber } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import { QuoteResponseRoute } from '@tcswap/helpers/api'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Credenza, CredenzaContent } from '@/components/ui/credenza'
import { SwapConfirm } from '@/components/swap/swap-confirm'
import { SwapRecipient } from '@/components/swap/swap-recipient'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { GenericButton } from '@/components/generic-button'
import { useBalance } from '@/hooks/use-balance'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetFrom, useAssetTo, useSwap } from '@/hooks/use-swap'
import { readableError } from '@/lib/errors'
import { isHoudiniProvider, resolvePriceImpact } from '@/lib/swap-helpers'
import { getUSwap } from '@/lib/wallets'
import { isBridgeRoute } from '@/lib/api'
import { addressPaysScript } from '@/lib/bch'
import { toBaseUnits } from '@/lib/bridge'
import { useBchWallet } from '@/components/bch-wallet'
import { startBridgeFirstLeg } from '@/components/swap/pusd-swap'
import { useIsLimitSwap, useLimitSwapBuyAmount } from '@/store/limit-swap-store'
import { useReplacementOrderStore, useSetReplacementOrder } from '@/store/replacement-order-store'
import { useSwapStore } from '@/store/swap-store'

interface SwapDialogProps {
  provider: ProviderName
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export const SwapDialog = ({ provider, isOpen, onOpenChange }: SwapDialogProps) => {
  const t = useTranslations('swap')
  const tBridge = useTranslations('bridge')
  const destinationAsset = useSwapStore(state => state.destinationAsset)
  const uSwap = getUSwap()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const { valueFrom, setAmountFrom } = useSwap()
  const { refetch: refetchBalance } = useBalance()
  const [submitting, setSubmitting] = useState(false)
  const { binding, walletName: bchWalletName } = useBchWallet()
  const setReplacementOrder = useSetReplacementOrder()
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()
  const { rateFrom, rateTo } = useSwapRates()

  // A replacement order gets exactly one confirm screen: placed or dismissed, it is not offered again.
  useEffect(() => {
    return () => {
      if (useReplacementOrderStore.getState().replacement?.consumed) setReplacementOrder(undefined)
    }
  }, [setReplacementOrder])

  const [quote, setQuote] = useState<QuoteResponseRoute | undefined>(undefined)
  const [highPriceImpactAccepted, setHighPriceImpactAccepted] = useState(false)
  const [selfCustodyAccepted, setSelfCustodyAccepted] = useState(false)
  const [ltcWarningAccepted, setLtcWarningAccepted] = useState(false)

  const priceImpact = resolvePriceImpact(quote, rateFrom, rateTo)
  const requiresHighPriceImpactAcceptance = !isLimitSwap && !!priceImpact && priceImpact.gt(2)
  const requiresLtcWarning = assetFrom?.ticker === 'LTC'
  const confirmBlocked =
    !selfCustodyAccepted || (requiresLtcWarning && !ltcWarningAccepted) || (requiresHighPriceImpactAcceptance && !highPriceImpactAccepted)

  const onConfirm = () => {
    if (!quote || !assetFrom || !assetTo || confirmBlocked || submitting) return

    setSubmitting(true)

    // THORchain returns `route.expiration` as an absolute Unix timestamp (seconds),
    // but the TRON toolbox passes it straight to `tronWeb.extendExpiration(tx, seconds)`
    // which expects an *extension in seconds* (chain max ~24h). The huge value yields
    // an expiration ~56 years in the future: the fullnode accepts the broadcast and
    // returns a txid, but consensus silently drops the tx. THORchain TRON deposits
    // are plain TRC20 transfers with no on-chain expiry, so dropping the field is safe.
    const route = assetFrom.chain === Chain.Tron && quote.expiration ? ({ ...quote, expiration: undefined } as QuoteResponseRoute) : quote

    // The route must still be the bridge's: THORChain, buying BCH.BCH, paying the bound BCH wallet.
    if (!binding || !isBridgeRoute(quote, { sellAsset: assetFrom.identifier, destinationAddress: binding.cashAddress }) || !addressPaysScript(quote.destinationAddress, binding.lockingBytecode)) {
      setSubmitting(false)
      toast.error(t('toast.bridgeRouteMismatch'))
      return
    }

    let quotedBchSats: string | undefined
    try {
      quotedBchSats = toBaseUnits(quote.expectedBuyAmount, 8).toString()
    } catch {
      quotedBchSats = undefined
    }

    const broadcast = startBridgeFirstLeg({
      binding,
      walletName: bchWalletName ?? undefined,
      quotedBchSats,
      destinationAsset,
      base: {
        provider: provider,
        chainId: getChainConfig(assetFrom.chain).chainId,
        timestamp: new Date(),
        estimatedTime: quote.estimatedTime?.total,
        assetFrom: assetFrom,
        assetTo: assetTo,
        amountFrom: valueFrom.toSignificant(),
        amountTo: new USwapNumber(quote.expectedBuyAmount).toSignificant(),
        addressFrom: quote.sourceAddress,
        addressTo: quote.destinationAddress || '',
        addressDeposit: quote.inboundAddress
      },
      execute: () => uSwap.swap({ route: route as any, feeOptionKey: FeeOption.Fast }) as Promise<string>
    })
      .then(() => {
        setAmountFrom('')
        refetchBalance()
        onOpenChange(false)
      })
      .catch((err: any) => {
        console.error('Bridge first leg failed', err)
        setSubmitting(false)
        throw err
      })

    toast.promise(broadcast, {
      loading: t('toast.submittingTransaction'),
      success: () => t('toast.transactionSubmitted'),
      error: (err: unknown) => readableError(err, t('toast.errorSubmitting'))
    })
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="flex h-auto max-h-5/6 flex-col md:max-w-2xl">
        {quote ? (
          <>
            <SwapConfirm quote={quote} priceImpact={priceImpact} />

            <div className="space-y-3 p-4 pt-2 md:p-8 md:pt-2">
              <div className="text-txt-label-small text-sm">
                {tBridge('form.selectedDestination', { asset: destinationAsset })}
                {destinationAsset === 'PUSD' && <p className="mt-1 text-xs">{tBridge('estimate.disclaimer')}</p>}
              </div>
              <SwapAddressWarning
                checked={selfCustodyAccepted}
                onCheckedChange={setSelfCustodyAccepted}
                text={t('warning.selfCustody')}
                textAccent={t('warning.lossOfFunds')}
              />
              {requiresLtcWarning && (
                <SwapAddressWarning
                  checked={ltcWarningAccepted}
                  onCheckedChange={setLtcWarningAccepted}
                  text={t('warning.ltcMweb')}
                  textAccent={t('warning.lossOfFunds')}
                />
              )}
              {requiresHighPriceImpactAcceptance && (
                <SwapAddressWarning
                  checked={highPriceImpactAccepted}
                  onCheckedChange={setHighPriceImpactAccepted}
                  text={isHoudiniProvider(provider) ? t('warning.highPriceImpactPrivate') : t('warning.highPriceImpact')}
                />
              )}
              <GenericButton
                colorType="3"
                size="large"
                className="w-full"
                onClick={() => onConfirm()}
                disabled={!quote || submitting || confirmBlocked}
              >
                {submitting ? (
                  <LoaderCircle size={20} className="animate-spin" />
                ) : (
                  <span>{isLimitSwap ? t('confirm.buttonLimit') : t('button.send')}</span>
                )}
              </GenericButton>
            </div>
          </>
        ) : (
          <SwapRecipient provider={provider} autoPrepare onFetchQuote={quote => setQuote(quote)} />
        )}
      </CredenzaContent>
    </Credenza>
  )
}
