import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Chain, FeeOption, getChainConfig, USwapNumber } from '@tcswap/core'
import { ProviderName } from '@tcswap/helpers'
import { QuoteResponseRoute } from '@tcswap/helpers/api'
import { LoaderCircle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Credenza, CredenzaContent } from '@/components/ui/credenza'
import { BridgeConfirm } from '@/components/swap/swap-confirm'
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
import { addressPaysScript, type BchBinding } from '@/lib/bch'
import { toBaseUnits } from '@/lib/bridge'
import { firstLegSeconds } from '@/lib/bridge-summary'
import { useBchWallet } from '@/components/bch-wallet'
import { BridgeBlocked, FirstLegRejected, startBridgeFirstLeg } from '@/components/swap/pusd-swap'
import { useIsLimitSwap, useLimitSwapBuyAmount } from '@/store/limit-swap-store'
import { useReplacementOrderStore, useSetReplacementOrder } from '@/store/replacement-order-store'
import { useSwapStore } from '@/store/swap-store'
import { chainLabel } from '@/components/connect-wallet/config'

interface SwapDialogProps {
  provider: ProviderName
  // Prepared by the main button: the executable route and the BCH destination it pays.
  quote?: QuoteResponseRoute
  binding?: BchBinding
  walletName?: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export const SwapDialog = ({ provider, quote: prepared, binding: destination, walletName, isOpen, onOpenChange }: SwapDialogProps) => {
  const t = useTranslations('swap')
  const tConfirm = useTranslations('bridge.confirm')
  const tBridge = useTranslations('bridge')
  const bchToken = useSwapStore(state => state.bchToken)
  const uSwap = getUSwap()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const { valueFrom, setAmountFrom } = useSwap()
  const { refetch: refetchBalance } = useBalance()
  const [submitting, setSubmitting] = useState(false)
  const wallet = useBchWallet()
  const binding = destination ?? wallet.binding
  const bchWalletName = destination ? walletName : wallet.walletName
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

  const [quote, setQuote] = useState<QuoteResponseRoute | undefined>(prepared)
  const [highPriceImpactAccepted, setHighPriceImpactAccepted] = useState(false)
  const [ltcWarningAccepted, setLtcWarningAccepted] = useState(false)

  const priceImpact = resolvePriceImpact(quote, rateFrom, rateTo)
  const requiresHighPriceImpactAcceptance = !isLimitSwap && !!priceImpact && priceImpact.gt(2)
  const requiresLtcWarning = assetFrom?.ticker === 'LTC'
  const confirmBlocked = (requiresLtcWarning && !ltcWarningAccepted) || (requiresHighPriceImpactAcceptance && !highPriceImpactAccepted)

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
      destinationAsset: bchToken ? 'TOKEN' : 'BCH',
      token: bchToken ?? undefined,
      base: {
        provider: provider,
        chainId: getChainConfig(assetFrom.chain).chainId,
        timestamp: new Date(),
        estimatedTime: firstLegSeconds(quote.estimatedTime),
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

    const toastId = toast.loading(t('toast.submittingTransaction'))
    broadcast.then(
      () => {
        // A hash exists: the swap is sent. Nothing after this point may hand Confirm back, so a
        // failure tidying the form is logged, never routed to the submission-error path below.
        toast.success(t('toast.transactionSubmitted'), { id: toastId })
        try {
          setAmountFrom('')
          refetchBalance()
        } catch (error) {
          console.error('Failed to reset the swap form after broadcast:', error)
        }
        onOpenChange(false)
      },
      (err: unknown) => {
        setSubmitting(false)
        // Declined in the wallet: nothing was sent and nothing was recorded. Back to the form.
        if (err instanceof FirstLegRejected) {
          toast.dismiss(toastId)
          toast(tBridge('cancelledInWallet'))
          onOpenChange(false)
          return
        }
        console.warn('Bridge first leg failed', err)
        toast.error(readableError(err, t('toast.errorSubmitting')), { id: toastId })
        // A recorded operation now has its own progress screen; this one must not stay on top of it.
        if (!(err instanceof BridgeBlocked)) onOpenChange(false)
      }
    )
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="bridge-confirm-dialog flex h-auto max-h-5/6 flex-col md:max-w-[620px]">
        {quote ? (
          <>
            <BridgeConfirm quote={quote} token={bchToken} bchAddress={binding?.cashAddress ?? quote.destinationAddress ?? ''} />

            <div className="space-y-3 p-4 pt-2 md:px-7 md:pb-7">
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
                  <span>
                    {tConfirm(bchToken ? 'sendFirst' : 'send', {
                      amount: new USwapNumber(quote.sellAmount).toSignificant(),
                      ticker: assetFrom?.ticker ?? ''
                    })}
                  </span>
                )}
              </GenericButton>
              {submitting && (
                <p className="bridge-sign-hint" role="status">
                  {tConfirm('approveInWallet', { chain: assetFrom ? chainLabel(assetFrom.chain) : '' })}
                </p>
              )}
            </div>
          </>
        ) : (
          <SwapRecipient provider={provider} autoPrepare onFetchQuote={quote => setQuote(quote)} />
        )}
      </CredenzaContent>
    </Credenza>
  )
}
