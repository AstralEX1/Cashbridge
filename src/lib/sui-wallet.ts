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
  type WalletWithFeatures
} from '@mysten/wallet-standard'
import { toBaseUnits } from '@/lib/bridge'
import { catalogBalance, nearCatalogAsset, nearCatalogAssets } from '@/lib/near-intents'

// Sui wallets announce themselves over the Wallet Standard (docs.sui.io/standards/wallet-standard): a dapp asks the
// registry for wallets on `sui:mainnet`, connects with `standard:connect` and has the wallet sign and submit with
// `sui:signAndExecuteTransaction` (older wallets: `…TransactionBlock`, which the helper bridges).
export const SLUSH = 'SLUSH' as string as WalletOption

// Mysten's wallet registered as "Sui Wallet" before its 2025 rename to Slush.
const SLUSH_NAMES = ['Slush', 'Sui Wallet']

type SuiStandardWallet = WalletWithFeatures<StandardConnectFeature & StandardEventsFeature & Partial<StandardDisconnectFeature & SuiWalletFeatures>>

const isSlush = (wallet: Wallet): wallet is SuiStandardWallet =>
  SLUSH_NAMES.includes(wallet.name) && wallet.chains.includes(SUI_MAINNET_CHAIN) && StandardConnect in wallet.features && StandardEvents in wallet.features

export const findSlush = () => (typeof window === 'undefined' ? undefined : getWallets().get().find(isSlush))

// Extensions register a moment after load, which a restore on page load can beat.
const waitForSlush = async () => {
  for (let waited = 0; waited < 1_000 && !findSlush(); waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  return findSlush()
}

// Public full nodes answer gRPC-web only: JSON-RPC was switched off in July 2026
// (docs.sui.io/develop/accessing-data/json-rpc-migration).
const suiClient = async () => {
  const { SuiGrpcClient } = await import('@mysten/sui/grpc')
  return new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
}

export const slushWallet = createWallet({
  name: 'connectSlush',
  supportedChains: [Chain.Sui],
  walletType: SLUSH,
  connect:
    ({ addChain, walletType }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean }) => {
      if (!chains.includes(Chain.Sui)) throw new Error('Slush only supports Sui')
      const wallet = await waitForSlush()
      if (!wallet) throw new Error('Slush is not installed')

      // `silent` answers with the accounts already granted to this site, without a prompt.
      const { accounts } = await wallet.features[StandardConnect].connect({ silent: !!config?.restoreOnly })
      const account = accounts.find(a => a.chains.includes(SUI_MAINNET_CHAIN)) ?? accounts[0]
      if (!account) throw new Error('Slush shared no Sui account')
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
