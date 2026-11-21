import { type AssetValue, Chain, WalletOption } from '@tcswap/core'
import { createWallet } from '@tcswap/wallets'
import {
  getWallets,
  signAndExecuteTransaction,
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  SUI_MAINNET_CHAIN,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
  type SuiWalletFeatures,
  type Wallet,
  type WalletAccount,
  type WalletWithFeatures
} from '@mysten/wallet-standard'
import { toBaseUnits } from '@/lib/bridge'
import { catalogBalance, nearCatalogAsset, nearCatalogAssets } from '@/lib/near-intents'

// Sui wallets announce themselves over the Wallet Standard (docs.sui.io/standards/wallet-standard): a dapp asks the
// registry for wallets on `sui:mainnet`, connects with `standard:connect` and has the wallet sign and submit with
// `sui:signAndExecuteTransaction` (older wallets: `…TransactionBlock`, which the helper bridges). Every Sui wallet goes
// through this one connector; a multi-chain wallet's own row (OneKey) hands its Sui account here.
export const SLUSH = 'SLUSH' as string as WalletOption
export const SUIET = 'SUIET' as string as WalletOption
export const NIGHTLY = 'NIGHTLY' as string as WalletOption

// What each wallet registers as, from its maker's own code; the first name is the label. Slush's extension carries the
// id Mysten's dapp kit matches (@mysten/slush-wallet) and the names its wallet defaults list (@mysten/dapp-kit); the id
// comes first, as OneKey can also register under Slush's names. Suiet: @suiet/wallet-sdk. Nightly: nightly-labs/connect
// (selector-sui). OneKey: OneKeyHQ/cross-inpage-provider (onekey-sui-provider).
export const SUI_WALLETS: Partial<Record<WalletOption, { id?: string; names: string[] }>> = {
  [SLUSH]: { id: 'com.mystenlabs.suiwallet', names: ['Slush', 'Sui Wallet'] },
  [SUIET]: { names: ['Suiet'] },
  [NIGHTLY]: { names: ['Nightly'] },
  [WalletOption.ONEKEY]: { names: ['OneKey Wallet'] }
}

type SuiStandardWallet = WalletWithFeatures<StandardConnectFeature & StandardEventsFeature & Partial<StandardDisconnectFeature & SuiWalletFeatures>>

// Like dapp-kit's default filter, a wallet that cannot sign on Sui mainnet is no Sui wallet here.
const isSuiWallet = (wallet: Wallet): wallet is SuiStandardWallet =>
  wallet.chains.includes(SUI_MAINNET_CHAIN) &&
  StandardConnect in wallet.features &&
  StandardEvents in wallet.features &&
  ('sui:signAndExecuteTransaction' in wallet.features || 'sui:signAndExecuteTransactionBlock' in wallet.features)

export const findSuiWallet = (option: WalletOption) => {
  const known = SUI_WALLETS[option]
  if (!known || typeof window === 'undefined') return undefined
  const wallets = getWallets().get().filter(isSuiWallet)
  return (
    (known.id ? wallets.find(wallet => (wallet as { id?: string }).id === known.id) : undefined) ??
    wallets.find(wallet => known.names.includes(wallet.name))
  )
}

// Extensions register a moment after load, which a restore on page load can beat.
const waitForWallet = async (option: WalletOption) => {
  for (let waited = 0; waited < 1_000 && !findSuiWallet(option); waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  return findSuiWallet(option)
}

const onMainnet = (account: WalletAccount) => account.chains.includes(SUI_MAINNET_CHAIN)

// Public full nodes answer gRPC-web only: JSON-RPC was switched off in July 2026
// (docs.sui.io/develop/accessing-data/json-rpc-migration).
const suiClient = async () => {
  const { SuiGrpcClient } = await import('@mysten/sui/grpc')
  return new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
}

export const suiWallet = createWallet({
  name: 'connectSuiWallet',
  supportedChains: [Chain.Sui],
  walletType: SLUSH,
  connect:
    ({ addChain }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean; walletType?: WalletOption }) => {
      const walletType = config?.walletType ?? SLUSH
      const label = SUI_WALLETS[walletType]?.names[0] ?? 'This wallet'
      if (!chains.includes(Chain.Sui)) throw new Error(`${label} connects only Sui here`)
      const wallet = await waitForWallet(walletType)
      if (!wallet) throw new Error(`${label} with Sui is not installed`)

      // A restore takes the accounts the wallet already lists for this site, then asks with `silent`, as dapp-kit's
      // autoconnect does: docs.sui.io marks `silent` for deprecation in favour of accounts filled on load.
      const granted = config?.restoreOnly ? wallet.accounts.find(onMainnet) : undefined
      const accounts = granted ? [granted] : (await wallet.features[StandardConnect].connect({ silent: !!config?.restoreOnly })).accounts
      const account = accounts.find(onMainnet)
      if (!account) throw new Error(`${label} shared no Sui mainnet account`)
      const address = account.address

      const getBalance = async () => {
        const client = await suiClient()
        const assets = await nearCatalogAssets(Chain.Sui)
        return Promise.all(
          assets.map(async asset => {
            // Coin objects plus the address balance, which `tx.coin()` also spends from.
            const { balance } = await client.getBalance({ owner: address, ...(asset.address && { coinType: asset.address }) })
            return catalogBalance(asset, balance.balance)
          })
        )
      }

      const transfer = async ({ assetValue, recipient }: { assetValue: AssetValue; recipient: string }) => {
        const asset = await nearCatalogAsset(Chain.Sui, assetValue)
        const amount = toBaseUnits(assetValue.getValue('string'), asset.decimals)
        const { Transaction } = await import('@mysten/sui/transactions')
        const tx = new Transaction()
        tx.setSender(address)
        // `tx.coin()` draws from coin objects and the address balance; SUI splits from the gas coin
        // (sdk.mystenlabs.com/sui/transactions/coins-and-balances).
        tx.transferObjects([tx.coin({ balance: amount, ...(asset.address && { type: asset.address }) })], recipient)
        const client = await suiClient()
        // The wallet rebuilds the transaction from JSON, so the coin intent is resolved before it is handed over.
        const { digest } = await signAndExecuteTransaction(wallet, {
          transaction: { toJSON: () => tx.toJSON({ client, supportedIntents: [] }) },
          account,
          chain: SUI_MAINNET_CHAIN
        })
        return digest
      }

      const { isValidSuiAddress } = await import('@mysten/sui/utils')
      // Signing follows the wallet's current account, so a switch reloads, as the TronLink connector does.
      const stopEvents = wallet.features[StandardEvents].on('change', ({ accounts: next }) => {
        if (next && !next.some(a => a.address === address)) window.location.reload()
      })

      addChain({
        address,
        chain: Chain.Sui,
        walletType,
        getBalance,
        transfer,
        validateAddress: (candidate: string) => isValidSuiAddress(candidate),
        disconnect: () => {
          stopEvents()
          void wallet.features[StandardDisconnect]?.disconnect()
        }
      })
      return true
    }
})
