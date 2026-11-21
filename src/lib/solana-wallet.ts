import { Chain, WalletOption } from '@tcswap/core'
import { createWallet } from '@tcswap/wallets'
// The Wallet Standard registry is chain-agnostic; Mysten's package re-exports it with the standard features.
import {
  getWallets,
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
  type Wallet,
  type WalletAccount,
  type WalletWithFeatures
} from '@mysten/wallet-standard'
import type { Transaction, VersionedTransaction } from '@solana/web3.js'
import { NIGHTLY } from '@/lib/sui-wallet'

// Solana wallets the SDK has no connector for sign over the Wallet Standard (github.com/anza-xyz/wallet-standard):
// `standard:connect` shares the account, `solana:signTransaction` signs the transaction the SDK's Solana toolbox builds,
// and the toolbox broadcasts it over our Solana proxy, as it does for Phantom.
export const SOLFLARE = 'SOLFLARE' as string as WalletOption
export const BACKPACK = 'BACKPACK' as string as WalletOption

// What each wallet registers as, from its maker's own code; the first name is the label. Solflare:
// @solflare-wallet/wallet-adapter. Backpack: its wallet-standard package. Nightly: @nightlylabs/wallet-selector-solana.
export const SOLANA_WALLET_NAMES: Partial<Record<WalletOption, string[]>> = {
  [SOLFLARE]: ['Solflare'],
  [BACKPACK]: ['Backpack'],
  [NIGHTLY]: ['Nightly']
}

const SOLANA_MAINNET = 'solana:mainnet'
const SIGN_TRANSACTION = 'solana:signTransaction'

// @solana/wallet-standard-features: `supportedTransactionVersions` lists 'legacy' and/or 0.
type SignTransactionFeature = {
  [SIGN_TRANSACTION]: {
    version: string
    supportedTransactionVersions: readonly ('legacy' | 0 | 1)[]
    signTransaction: (
      ...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]
    ) => Promise<{ signedTransaction: Uint8Array }[]>
  }
}
type SolanaStandardWallet = WalletWithFeatures<
  StandardConnectFeature & StandardEventsFeature & SignTransactionFeature & Partial<StandardDisconnectFeature>
>

// The toolbox builds legacy transactions, so the wallet has to sign those.
const isSolanaWallet = (wallet: Wallet): wallet is SolanaStandardWallet =>
  wallet.chains.includes(SOLANA_MAINNET) &&
  StandardConnect in wallet.features &&
  StandardEvents in wallet.features &&
  !!(wallet.features as Partial<SignTransactionFeature>)[SIGN_TRANSACTION]?.supportedTransactionVersions?.includes('legacy')

export const findSolanaWallet = (option: WalletOption) => {
  const names = SOLANA_WALLET_NAMES[option]
  if (!names || typeof window === 'undefined') return undefined
  return getWallets()
    .get()
    .find(wallet => names.includes(wallet.name) && isSolanaWallet(wallet)) as SolanaStandardWallet | undefined
}

// Solflare's docs have the dapp register its Wallet Standard wallet with `initialize()` (@solflare-wallet/wallet-adapter);
// it signs with the extension when installed and with Solflare's web wallet otherwise.
const registerSolflare = async () => {
  const { initialize } = await import('@solflare-wallet/wallet-adapter')
  initialize({ disableMetaMask: true })
}

// Extensions register a moment after load, which a restore on page load can beat.
const waitForWallet = async (option: WalletOption) => {
  if (option === SOLFLARE) await registerSolflare()
  for (let waited = 0; waited < 1_000 && !findSolanaWallet(option); waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  return findSolanaWallet(option)
}

const canSign = (account: WalletAccount) => account.chains.includes(SOLANA_MAINNET) && account.features.includes(SIGN_TRANSACTION)
const isVersioned = (transaction: Transaction | VersionedTransaction): transaction is VersionedTransaction => 'version' in transaction

// The wallet signs serialized bytes; the toolbox and the Solana plugin hand over and expect transaction objects. The
// account object is looked up again at signing time, as a wallet may refuse one from before an account change.
export const standardSigner = async (wallet: SolanaStandardWallet, address: string) => {
  const { PublicKey, Transaction, VersionedTransaction } = await import('@solana/web3.js')
  const publicKey = new PublicKey(address)
  const signTransaction = async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
    const account = wallet.accounts.find(a => a.address === address)
    if (!account) throw new Error(`${wallet.name} no longer shares ${address}; connect it again`)
    const bytes = isVersioned(transaction) ? transaction.serialize() : transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
    const [signed] = await wallet.features[SIGN_TRANSACTION].signTransaction({ account, transaction: new Uint8Array(bytes), chain: SOLANA_MAINNET })
    if (!signed) throw new Error(`${wallet.name} returned no signed transaction`)
    return (isVersioned(transaction) ? VersionedTransaction.deserialize(signed.signedTransaction) : Transaction.from(signed.signedTransaction)) as T
  }
  return { publicKey, signTransaction, connect: async () => ({ publicKey }), disconnect: async () => {} }
}

export const solanaStandardWallet = createWallet({
  name: 'connectSolanaWallet',
  supportedChains: [Chain.Solana],
  walletType: SOLFLARE,
  connect:
    ({ addChain }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean; walletType?: WalletOption }) => {
      const walletType = config?.walletType ?? SOLFLARE
      const label = SOLANA_WALLET_NAMES[walletType]?.[0] ?? 'This wallet'
      if (!chains.includes(Chain.Solana)) throw new Error(`${label} connects only Solana here`)
      const wallet = await waitForWallet(walletType)
      if (!wallet) throw new Error(`${label} with Solana is not installed`)

      // A restore takes the accounts the wallet already lists for this site, then asks with `silent`, as the Solana
      // wallet adapter's autoconnect does; the spec says a wallet may ignore `silent`.
      const granted = config?.restoreOnly ? wallet.accounts.find(canSign) : undefined
      const accounts = granted ? [granted] : (await wallet.features[StandardConnect].connect({ silent: !!config?.restoreOnly })).accounts
      const account = accounts.find(canSign)
      if (!account) throw new Error(`${label} shared no Solana mainnet account that can sign`)

      const signer = await standardSigner(wallet, account.address)
      const { getSolanaToolbox } = await import('@tcswap/toolboxes/solana')
      const toolbox = await getSolanaToolbox({ signer })

      // Signing follows the wallet's current account, so a switch reloads, as the TronLink connector does.
      const stopEvents = wallet.features[StandardEvents].on('change', ({ accounts: next }) => {
        if (next && !next.some(a => a.address === account.address)) window.location.reload()
      })

      addChain({
        ...toolbox,
        address: account.address,
        chain: Chain.Solana,
        walletType,
        disconnect: () => {
          stopEvents()
          void wallet.features[StandardDisconnect]?.disconnect()
        }
      })
      return true
    }
})
