import { type AssetValue, Chain, type WalletOption } from '@tcswap/core'
import { createWallet } from '@tcswap/wallets'
import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect'
import { pageNonce } from '@/lib/csp'

// NEAR wallets (HOT, Meteor, Intear, MyNearWallet, …) connect through NEAR Connect, the connector NEAR's docs name in
// place of the deprecated Wallet Selector (docs.near.org/tools/near-connect): its picker lists the wallets from a
// shared manifest, each runs in a sandboxed iframe, and the wallet signs and sends the actions the dapp asks for.
export const NEARCONNECT = 'NEARCONNECT' as string as WalletOption

// NEP-141 calls (docs.near.org/primitives/ft): `ft_transfer` takes exactly 1 yoctoNEAR; `storage_deposit` with
// `registration_only` registers a new receiver and refunds the whole deposit when it is registered already (NEP-145).
const ONE_YOCTO = '1'
const STORAGE_DEPOSIT = '1250000000000000000000'
const GAS = '100000000000000'

let connector: Promise<NearConnector> | undefined
const nearConnect = () =>
  (connector ??= import('@hot-labs/near-connect').then(async ({ NearConnector }) => {
    // Each wallet runs in a srcdoc frame, which inherits this page's CSP: its inline script needs the page's nonce.
    const instance = new NearConnector({ network: 'mainnet', cspNonce: pageNonce() })
    await instance.whenManifestLoaded.catch(() => {})
    return instance
  }))

// Closing the picker is a cancel, not a failure, as WalletConnect's dismissal is.
class NearConnectDismissed extends Error {}
export const isNearConnectDismissed = (error: unknown) => error instanceof NearConnectDismissed

type FunctionCall = { args: object; attachedDeposit?: string; contractId: string; gas?: string; methodName: string }
type Action =
  | { type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }
  | { type: 'Transfer'; params: { deposit: string } }
type Unsigned = { receiverId: string; actions: Action[] }

const functionCall = ({ methodName, args, gas = GAS, attachedDeposit = '0' }: Omit<FunctionCall, 'contractId'>): Action => ({
  type: 'FunctionCall',
  params: { methodName, args, gas, deposit: attachedDeposit }
})

export const nearconnectWallet = createWallet({
  name: 'connectNearConnect',
  supportedChains: [Chain.Near],
  walletType: NEARCONNECT,
  connect:
    ({ addChain, walletType }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean }) => {
      if (!chains.includes(Chain.Near)) throw new Error('NEAR Connect only supports NEAR')
      const near = await nearConnect()

      let wallet: NearWalletBase
      let accountId: string | undefined
      try {
        // A restore on page load never opens the picker; with no signed-in wallet it stays disconnected.
        const connected = await near.getConnectedWallet()
        wallet = connected.wallet
        accountId = connected.accounts[0]?.accountId
      } catch {
        if (config?.restoreOnly) throw new Error('No NEAR Connect session to restore')
        try {
          wallet = await near.connect()
        } catch (error) {
          if (error instanceof Error && error.message === 'User rejected') throw new NearConnectDismissed(error.message)
          throw error
        }
        accountId = (await wallet.getAccounts())[0]?.accountId
      }
      if (!accountId) throw new Error('The NEAR wallet returned no account')

      const send = async (transaction: Unsigned) => (await wallet.signAndSendTransaction({ ...transaction, signerId: accountId })).transaction.hash

      // Native NEAR is a Transfer action; a token is `ft_transfer` on its contract, after registering the receiver.
      const transfer = ({ assetValue, recipient }: { assetValue: AssetValue; recipient: string }) => {
        const amount = assetValue.getBaseValue('string')
        if (assetValue.isGasAsset || !assetValue.address)
          return send({ receiverId: recipient, actions: [{ type: 'Transfer', params: { deposit: amount } }] })
        return send({
          receiverId: assetValue.address,
          actions: [
            functionCall({
              methodName: 'storage_deposit',
              args: { account_id: recipient, registration_only: true },
              attachedDeposit: STORAGE_DEPOSIT
            }),
            functionCall({ methodName: 'ft_transfer', args: { receiver_id: recipient, amount }, attachedDeposit: ONE_YOCTO })
          ]
        })
      }

      const stop = () => near.off('wallet:signOut', onSignOut)
      // Signing follows the wallet's current account, so a sign-out from the wallet side reloads.
      const onSignOut = () => window.location.reload()
      near.on('wallet:signOut', onSignOut)

      addChain({
        address: accountId,
        chain: Chain.Near,
        walletType,
        // Balances come from the SDK's NEAR toolbox, as for the other NEAR wallets; signing never goes through it,
        // since a sandboxed wallet signs and sends whole actions rather than a transaction the toolbox built.
        getBalance: async (address: string, scamFilter?: boolean) => {
          const { getNearToolbox } = await import('@tcswap/toolboxes/near')
          return (await getNearToolbox()).getBalance(address, scamFilter)
        },
        transfer,
        // The swap plugin sends a NEP-141 deposit as a contract call it builds with these two.
        createContractFunctionCall: async ({ contractId, ...call }: FunctionCall) => ({ receiverId: contractId, actions: [functionCall(call)] }),
        signAndSendTransaction: send,
        disconnect: () => {
          stop()
          void near.disconnect(wallet).catch(() => {})
        }
      })
      return true
    }
})
