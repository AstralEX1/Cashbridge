import { useEffect, useState } from 'react'
import { Chain, EVMChain } from '@tcswap/core'
import { QuoteResponseRoute } from '@tcswap/helpers/api'
import { useTranslations } from 'next-intl'
import { toast } from '@/lib/toast'
import { AnimatedButton } from '@/components/animated-button'
import { useBchWallet } from '@/components/bch-wallet'
import { useTokenEstimate } from '@/components/swap/pusd-swap'
import { useActiveBridge } from '@/store/transaction-store'
import { chainLabel } from '@/components/connect-wallet/config'
import { ConnectWallet } from '@/components/connect-wallet/connect-wallet'
import { useDialog } from '@/components/global-dialog'
import { InstantSwapDialog } from '@/components/swap/instant-swap-dialog'
import { SwapDialog } from '@/components/swap/swap-dialog'
import { useBalance } from '@/hooks/use-balance'
import { useIsLimitSwapPaused, useIsMemolessHalted, useMimir } from '@/hooks/use-mimir'
import { useQuote } from '@/hooks/use-quote'
import { useSimulation } from '@/hooks/use-simulation'
import { useAssetFrom, useAssetTo, useSlippage, useSwap } from '@/hooks/use-swap'
import { useConnectedAccount, useExternalWalletMode, useSetExternalWalletMode } from '@/hooks/use-wallets'
import { readableError, resolveQuoteError } from '@/lib/errors'
import { isDepositOnlyPrivateSell, isMayaProvider, isPrivateSend, isTaprootAddress, waitForAllowance } from '@/lib/swap-helpers'
import { getUSwap } from '@/lib/wallets'
import { useIsLimitSwap, useLimitSwapBuyAmount } from '@/store/limit-swap-store'
import { useIsPrivateSwap, usePrivateSwapAcknowledged } from '@/store/private-swap-store'
import { useSwapStore } from '@/store/swap-store'
import { useAutomaticBridge, useBchDestination } from '@/hooks/use-automatic-bridge'
import { AutoBridgeDialog, prepareAutomatic } from '@/components/swap/auto-bridge-confirm'
import { RouterUnavailable } from '@/components/swap/router-unavailable'
import { RouterUnavailableError } from '@/lib/auto-bridge-client'
import { addressToLockingBytecode } from '@/lib/bch'
import { toBaseUnits } from '@/lib/bridge'
import { prepareArrivalDestination } from '@/lib/arrival-prepare'
import { getQuotes } from '@/lib/api'
import { getNearQuote, isNearRoute, nearSlippageBps } from '@/lib/near-intents'
import { USwapError } from '@tcswap/helpers'
import type { ArrivalTerms } from '@/lib/swap-on-arrival'

interface SwapButtonProps {
  onShowBridge: () => void
  instantSwapSupported: boolean
  instantSwapAvailable: boolean
}

interface ButtonState {
  text: string
  spinner: boolean
  accent: boolean
  onClick?: () => void
}

export const SwapButton = ({ instantSwapSupported, instantSwapAvailable, onShowBridge }: SwapButtonProps) => {
  const t = useTranslations('swap')
  const tWallet = useTranslations('wallet')
  const tAuto = useTranslations('automatic')
  const { automatic, recipient, pastedProblem } = useAutomaticBridge()
  const destination = useBchDestination()
  const slippage = useSlippage()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const uSwap = getUSwap()
  const selectedAccount = useConnectedAccount(assetFrom?.chain)
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()
  const isPrivateSwap = useIsPrivateSwap()
  const privateSwapAcknowledged = usePrivateSwapAcknowledged()
  const externalWalletMode = useExternalWalletMode()
  const isMemolessHalted = useIsMemolessHalted()
  const setExternalWalletMode = useSetExternalWalletMode()
  const { valueFrom } = useSwap()
  const { quote, isLoading: isQuoting, refetch: refetchQuote, minimum } = useQuote()
  const { isLoading: isSimulating, approveData } = useSimulation()
  const { balance, isLoading: isBalanceLoading, error: balanceError, refetch: refetchBalance } = useBalance()
  const { mimir } = useMimir()
  const isLimitSwapPaused = useIsLimitSwapPaused()
  const isMayaChain = isMayaProvider(quote?.providers[0])
  const isLimitSwapDisabled = mimir['ENABLEADVSWAPQUEUE'] === 2 || isLimitSwapPaused || isMayaChain
  const actionLabel = isLimitSwap
    ? t('button.enterLimitOrder')
    : isPrivateSend(isPrivateSwap, assetFrom, assetTo)
      ? t('button.send')
      : t('button.send')

  const [isApproving, setIsApproving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [routerDown, setRouterDown] = useState(false)
  const activeBridge = useActiveBridge()
  const tokenEstimate = useTokenEstimate()
  const bchWallet = useBchWallet()
  const bchToken = useSwapStore(state => state.bchToken)

  const { openDialog } = useDialog()

  // Send prepares the executable route in place ("Preparing swap"), then opens straight on Confirm.
  const onSwap = async (quote: QuoteResponseRoute) => {
    if (!assetFrom || !selectedAccount || preparing) return
    const provider = quote.providers[0]
    setPreparing(true)
    setRouterDown(false)
    try {
      if (automatic) {
        const prepared = await prepareAutomatic({
          source: { chain: assetFrom.chain, asset: assetFrom.identifier, amount: valueFrom.toSignificant(), address: selectedAccount.address },
          token: bchToken!,
          recipient,
          expectedBuyAmount: quote.expectedBuyAmount,
          provider,
          slippage,
          messages: { invalidAddress: tAuto('invalidRecipient'), serviceUpdate: tAuto('serviceUpdate'), noRoute: tAuto('noRoute') }
        })
        openDialog(AutoBridgeDialog, { prepared })
        return
      }
      const owner = destination.binding
      if (!owner) return
      // CashToken Manual: try SwapOnArrival so THOR/NEAR pay the contract P2SH (not the wallet). Soft
      // fallback to the wallet on any prepare failure — classic Manual Cauldron still works.
      let binding = owner
      let arrival: { terms: ArrivalTerms } | undefined
      if (bchToken && !destination.pasted) {
        try {
          const expectedBchSats = toBaseUnits(quote.expectedBuyAmount, 8)
          const expectedTokenUnits = tokenEstimate.output ?? 0n
          const dest = await prepareArrivalDestination({
            owner,
            token: bchToken,
            expectedBchSats,
            expectedTokenUnits
          })
          if (dest.mode === 'arrival') {
            binding = dest.binding
            arrival = { terms: dest.terms }
          }
        } catch {
          binding = owner
          arrival = undefined
        }
      }
      if (isNearRoute(quote)) {
        // A fresh quote with a one-use deposit address, paying the bound address (1Click refuses z…)
        // and refunding the source wallet.
        const route = await getNearQuote({
          sellAsset: assetFrom.identifier,
          buyAsset: assetTo!.identifier,
          sellAmount: valueFrom.toSignificant(),
          sourceAddress: selectedAccount.address,
          recipient: binding.cashAddress,
          refundTo: selectedAccount.address,
          dry: false,
          slippageBps: nearSlippageBps(slippage)
        })
        if (!route) throw new Error(t('button.noValidQuotes'))
        openDialog(SwapDialog, {
          provider,
          quote: route,
          binding,
          arrival,
          walletName: destination.pasted ? undefined : (bchWallet.walletName ?? undefined)
        })
        return
      }
      const quotes = await getQuotes({
        buyAsset: assetTo!.identifier,
        sellAsset: assetFrom.identifier,
        sellAmount: valueFrom.toSignificant(),
        sourceAddress: selectedAccount.address,
        destinationAddress: binding.cashAddress,
        refundAddress: selectedAccount.address,
        dry: false,
        slippage: slippage ?? 99,
        providers: [provider]
      })
      if (!quotes[0]) throw new Error(t('button.noValidQuotes'))
      openDialog(SwapDialog, {
        provider,
        quote: quotes[0],
        binding,
        arrival,
        walletName: destination.pasted ? undefined : (bchWallet.walletName ?? undefined)
      })
    } catch (error) {
      console.warn('Preparing the swap failed', error)
      // The form is untouched: the notice offers Try again, which prepares the same transfer once more.
      if (error instanceof RouterUnavailableError) return setRouterDown(true)
      toast.error(readableError(error instanceof USwapError ? resolveQuoteError(error) : error, t('toast.errorSubmitting')))
    } finally {
      setPreparing(false)
    }
  }

  const onInstantSwap = (quote: QuoteResponseRoute) => {
    openDialog(InstantSwapDialog, { provider: quote.providers[0] })
  }

  const connectSource = () => {
    if (!assetFrom) return
    if (externalWalletMode) {
      if (!isMemolessHalted) toast.warning(tWallet('externalWalletAssetUnsupported'))
      setExternalWalletMode(false)
    }
    openDialog(ConnectWallet, { chain: assetFrom.chain })
  }

  const onApprove = async () => {
    if (!approveData || !selectedAccount) return

    const wallet = uSwap.getWallet<EVMChain>(selectedAccount.provider, selectedAccount.network as EVMChain)
    if (!wallet) return

    const { contract, spender, amount } = approveData
    const from = selectedAccount.address
    const target = { assetAddress: contract, spenderAddress: spender }

    setIsApproving(true)

    const toastId = toast.loading(t('toast.approvalTransaction'))

    try {
      // USDT and other non-standard ERC-20s revert on approve() while a leftover non-zero allowance
      // is still set, so it has to be cleared - and mined - before the new allowance can be signed.
      const allowance = await wallet.approvedAmount({ ...target, from }).catch(() => 0n)

      if (allowance > 0n) {
        toast.loading(t('toast.resettingApproval'), { id: toastId })
        // '0' as a string on purpose: the SDK falls back to an unlimited approval for a falsy amount.
        await wallet.approve({ ...target, amount: '0' })
        const cleared = await waitForAllowance(async () => (await wallet.approvedAmount({ ...target, from })) === 0n)
        if (!cleared) throw new Error(t('toast.approvalNotConfirmed'))
        toast.loading(t('toast.approvalTransaction'), { id: toastId })
      }

      await wallet.approve({ ...target, amount })
      const approved = await waitForAllowance(() => wallet.isApproved({ ...target, from, amount }))
      if (!approved) throw new Error(t('toast.approvalNotConfirmed'))

      toast.success(t('toast.success'), { id: toastId })
    } catch (err) {
      console.error('Approval failed', err)
      toast.error(readableError(err, t('toast.errorSubmitting')), { id: toastId })
    } finally {
      setIsApproving(false)
      refetchQuote()
    }
  }

  const getState = (): ButtonState => {
    if (preparing) return { text: t('recipient.preparingSwap'), spinner: true, accent: true }
    // The BCH side first, then the source wallet. A pasted address stands in for the BCH wallet.
    if (pastedProblem || destination.invalid) return { text: tAuto(automatic ? 'invalidTokenRecipient' : 'invalidRecipient'), spinner: false, accent: false }
    if (automatic ? !addressToLockingBytecode(recipient) : !destination.binding) {
      const connecting = bchWallet.state === 'connecting' || bchWallet.state === 'reconnecting'
      return {
        text: bchWallet.mismatch ? t('button.connectBoundBch') : t('button.connectBch'),
        spinner: connecting && !bchWallet.reconnectStalled,
        accent: true,
        onClick: bchWallet.reconnectStalled || bchWallet.mismatch || bchWallet.state === 'connected' ? bchWallet.pairAgain : connecting ? undefined : bchWallet.connect
      }
    }
    if (assetFrom && !selectedAccount && !instantSwapSupported) {
      return { text: t('button.connectWallet', { chain: chainLabel(assetFrom.chain) }), spinner: false, accent: true, onClick: connectSource }
    }
    if (activeBridge) return { text: t('button.viewBridge'), spinner: false, accent: true, onClick: onShowBridge }
    if (isLimitSwap && isLimitSwapDisabled) {
      return { text: isMayaChain ? t('button.limitNotSupported') : t('button.temporarilyUnavailable'), spinner: false, accent: false }
    }

    if (!assetFrom || !assetTo) return { text: '', spinner: true, accent: false }

    if (valueFrom.eqValue(0)) return { text: t('button.enterAmount'), spinner: false, accent: false }

    if (isQuoting || isSimulating) return { text: t('button.quoting'), spinner: true, accent: false }

    // A halt is called out by the banner under the button, so every no-quote case reads the same here.
    if (!quote && minimum) return { text: t('button.minimum', { amount: minimum, ticker: assetFrom.ticker }), spinner: false, accent: false }
    if (!quote) return { text: t('button.noValidQuotes'), spinner: false, accent: false }

    if (isLimitSwap && limitSwapBuyAmount === '0') {
      return { text: t('button.enterLimitPrice'), spinner: false, accent: false }
    }

    // Native BCH needs only the THORChain route; a token also needs an indicative Cauldron route.
    if (bchToken) {
      if (tokenEstimate.isLoading) return { text: t('button.quoting'), spinner: true, accent: false }
      if (tokenEstimate.error || tokenEstimate.output === undefined || tokenEstimate.output <= 0n)
        return { text: t('button.noPusdRoute', { ticker: bchToken.ticker }), spinner: false, accent: false }
    }

    if (isDepositOnlyPrivateSell(isPrivateSwap, assetFrom.chain)) {
      return { text: actionLabel, spinner: false, accent: true, onClick: () => onInstantSwap(quote) }
    }

    if (!selectedAccount) {
      if (instantSwapSupported) {
        const label = actionLabel
        if (!instantSwapAvailable) {
          return { text: label, spinner: false, accent: false }
        }

        return { text: label, spinner: false, accent: true, onClick: () => onInstantSwap(quote) }
      } else {
        return {
          text: t('button.connectWallet', { chain: chainLabel(assetFrom.chain) }),
          spinner: false,
          accent: false,
          onClick: connectSource
        }
      }
    }

    if (isMayaChain && selectedAccount.network === Chain.Bitcoin && isTaprootAddress(selectedAccount.address)) {
      return { text: t('button.taprootNotSupported'), spinner: false, accent: false }
    }

    // A balance still loading or failed to load is not a zero balance.
    if (isBalanceLoading) return { text: t('button.checkingBalance'), spinner: true, accent: false }
    if (balanceError || !balance) return { text: t('button.balanceUnavailable'), spinner: false, accent: false, onClick: () => refetchBalance() }

    if (balance.spendable.lt(valueFrom)) {
      return {
        text: t('button.insufficientBalance'),
        spinner: false,
        accent: false
      }
    }

    if (approveData) {
      return {
        text: t('button.approve', { ticker: assetFrom.ticker }),
        spinner: isApproving,
        accent: false,
        onClick: isApproving ? undefined : onApprove
      }
    }

    return {
      text: actionLabel,
      spinner: false,
      accent: true,
      onClick: () => onSwap(quote)
    }
  }

  const state = getState()

  // The notice belongs to the transfer that failed: a different amount, asset or mode clears it.
  const transferKey = `${assetFrom?.identifier}|${valueFrom.toSignificant()}|${automatic}`
  useEffect(() => setRouterDown(false), [transferKey])

  // A private swap leaves the native protocols, so it cannot start until the disclaimer is accepted.
  if (isPrivateSwap && !privateSwapAcknowledged && state.accent) {
    state.accent = false
    state.onClick = undefined
  }

  return (
    <>
      <AnimatedButton
        aria-label={state.text || t('button.enterAmount')}
        colorType={state.accent ? 'accent' : 'default'}
        className="bridge-primary w-full"
        onClick={state.onClick}
        disabled={!state.onClick}
        loading={state.spinner}
      >
        {state.text}
      </AnimatedButton>
      {routerDown && (
        <RouterUnavailable
          onRetry={() => {
            setRouterDown(false)
            if (quote) void onSwap(quote)
          }}
        />
      )}
    </>
  )
}
