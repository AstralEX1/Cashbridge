import { type AssetValue, Chain, WalletOption } from '@tcswap/core'
import { createWallet } from '@tcswap/wallets'
import { toBaseUnits } from '@/lib/bridge'
import { catalogBalance, nearCatalogAsset, nearCatalogAssets } from '@/lib/near-intents'

// Cardano browser wallets expose the CIP-30 dApp-Wallet bridge (cips.cardano.org/cip/CIP-30) at
// `window.cardano.<id>`: `enable()` asks for access, and the wallet hands over its UTXOs and change address, signs
// with `signTx` and submits with `submitTx`. Mesh's BrowserWallet wraps that API; the transaction is built from the
// wallet's own UTXOs, so no chain indexer or API key is involved.
export const LACE = 'LACE' as string as WalletOption
export const ETERNL = 'ETERNL' as string as WalletOption
export const YOROI = 'YOROI' as string as WalletOption

// Mainnet in CIP-30 `getNetworkId()`.
const MAINNET = 1

interface Cip30Entry {
  enable: () => Promise<unknown>
  isEnabled: () => Promise<boolean>
}

export const cip30Entry = (id: string): Cip30Entry | undefined => {
  if (typeof window === 'undefined') return undefined
  const entry = (window as unknown as { cardano?: Record<string, Cip30Entry | undefined> }).cardano?.[id]
  return typeof entry?.enable === 'function' ? entry : undefined
}

// Extensions inject `window.cardano` a moment after load, which a restore on page load can beat.
const waitForEntry = async (id: string) => {
  for (let waited = 0; waited < 1_000 && !cip30Entry(id); waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  return cip30Entry(id)
}

const createCardanoWallet = <const Name extends string>(name: Name, option: WalletOption, id: string, label: string) =>
  createWallet({
    name,
    supportedChains: [Chain.Cardano],
    walletType: option,
    connect:
      ({ addChain, walletType }) =>
      async (chains: Chain[], config?: { restoreOnly?: boolean }) => {
        if (!chains.includes(Chain.Cardano)) throw new Error(`${label} only supports Cardano`)
        const entry = await waitForEntry(id)
        if (!entry) throw new Error(`${label} is not installed`)
        // `isEnabled` is true once this site was granted access; a restore then reconnects without a prompt.
        if (config?.restoreOnly && !(await entry.isEnabled())) throw new Error(`${label} has not authorized this site`)

        const { BrowserWallet } = await import('@meshsdk/wallet')
        const wallet = await BrowserWallet.enable(id)
        if ((await wallet.getNetworkId()) !== MAINNET) throw new Error(`Switch ${label} to Cardano mainnet and connect again`)
        const address = await wallet.getChangeAddress()

        const getBalance = async () => {
          const [ada] = await nearCatalogAssets(Chain.Cardano).then(assets => assets.filter(asset => !asset.address))
          return ada ? [catalogBalance(ada, await wallet.getLovelace())] : []
        }

        const transfer = async ({ assetValue, recipient }: { assetValue: AssetValue; recipient: string }) => {
          const asset = await nearCatalogAsset(Chain.Cardano, assetValue)
          if (asset.address) throw new Error('Only ADA can be sent from a Cardano wallet here')
          const lovelace = toBaseUnits(assetValue.getValue('string'), asset.decimals)
          const { MeshTxBuilder } = await import('@meshsdk/transaction')
          const unsigned = await new MeshTxBuilder()
            .txOut(recipient, [{ unit: 'lovelace', quantity: lovelace.toString() }])
            .changeAddress(address)
            .selectUtxosFrom(await wallet.getUtxos())
            .complete()
          const signed = await wallet.signTx(unsigned, false)
          return wallet.submitTx(signed)
        }

        const { deserializeAddress } = await import('@meshsdk/core-cst')
        addChain({
          address,
          chain: Chain.Cardano,
          walletType,
          getBalance,
          transfer,
          validateAddress: (candidate: string) => {
            try {
              deserializeAddress(candidate)
              return candidate.startsWith('addr1')
            } catch {
              return false
            }
          }
        })
        return true
      }
  })

export const laceWallet = createCardanoWallet('connectLace', LACE, 'lace', 'Lace')
export const eternlWallet = createCardanoWallet('connectEternl', ETERNL, 'eternl', 'Eternl')
export const yoroiWallet = createCardanoWallet('connectYoroi', YOROI, 'yoroi', 'Yoroi')

export const CIP30_IDS: Partial<Record<WalletOption, string>> = { [LACE]: 'lace', [ETERNL]: 'eternl', [YOROI]: 'yoroi' }
