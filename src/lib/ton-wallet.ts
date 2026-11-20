import { type AssetValue, Chain, WalletOption } from '@tcswap/core'
import { createWallet } from '@tcswap/wallets'
import type { TonConnectUI } from '@tonconnect/ui'
import { toBaseUnits } from '@/lib/bridge'
import { catalogBalance, nearCatalogAsset, nearCatalogAssets } from '@/lib/near-intents'

// TON wallets (Tonkeeper, MyTonWallet, Telegram Wallet, …) connect over TON Connect
// (docs.ton.org/applications/ton-connect): its modal lists them, with a QR code for phone wallets, and the wallet
// signs and broadcasts the messages the dapp asks for.
export const TONCONNECT = 'TONCONNECT' as string as WalletOption

const MAINNET = '-239'
const TONCENTER = 'https://toncenter.com/api/v3'
// Gas attached to a jetton transfer, and the 1 nanoton that makes the jetton wallet notify the deposit address
// (docs.ton.org/applications/ton-connect/how-to/send-transaction#jetton-transfer).
const JETTON_GAS = 50_000_000n
const JETTON_FORWARD = 1n

// @ton/core builds cells on Node's Buffer.
const tonCore = async () => {
  const { Buffer } = await import('buffer')
  globalThis.Buffer ??= Buffer
  return import('@ton/core')
}

let connector: Promise<TonConnectUI> | undefined
const tonConnect = () =>
  (connector ??= import('@tonconnect/ui').then(({ TonConnectUI }) => new TonConnectUI({ manifestUrl: `${window.location.origin}/tonconnect-manifest.json` })))

// Closing the modal is a cancel, not a failure, as WalletConnect's dismissal is.
class TonConnectDismissed extends Error {}
export const isTonConnectDismissed = (error: unknown) => error instanceof TonConnectDismissed

// Resolves once a wallet is connected; rejects when the user closes the modal.
const openModal = (ui: TonConnectUI, tonWallet?: 'tonkeeper') =>
  new Promise<void>((resolve, reject) => {
    const stop = () => {
      stopStatus()
      stopModal()
      stopSingleModal()
    }
    const stopStatus = ui.onStatusChange(
      wallet => {
        if (!wallet) return
        stop()
        resolve()
      },
      error => {
        stop()
        reject(error)
      }
    )
    const onModalChange = (state: { status: string; closeReason: string | null }) => {
      if (state.status !== 'closed' || state.closeReason !== 'action-cancelled') return
      stop()
      reject(new TonConnectDismissed('TON Connect was closed before a wallet connected'))
    }
    const stopModal = ui.onModalStateChange(onModalChange)
    const stopSingleModal = ui.onSingleWalletModalStateChange(onModalChange)
    const opened = tonWallet ? ui.openSingleWalletModal(tonWallet) : ui.openModal()
    opened.catch(error => {
      stop()
      reject(error)
    })
  })

// Keyless toncenter allows about one request a second, so a 429 is retried after a pause.
const toncenter = async <T,>(path: string): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${TONCENTER}${path}`, { signal: AbortSignal.timeout(15_000) })
    if (response.status === 429 && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1_100))
      continue
    }
    if (!response.ok) throw new Error(`toncenter answered ${response.status}`)
    return response.json() as Promise<T>
  }
}

type JettonWallets = { jetton_wallets: { address: string; balance: string }[] }
const jettonWallet = async (owner: string, master: string) =>
  (await toncenter<JettonWallets>(`/jetton/wallets?owner_address=${encodeURIComponent(owner)}&jetton_address=${encodeURIComponent(master)}&limit=1&offset=0`))
    .jetton_wallets[0]

// TEP-467: the hash explorers and RPC providers index an external message by, whatever form the wallet sent it in.
const normalizedMessageHash = async (boc: string) => {
  const { beginCell, Cell, loadMessage, storeMessage } = await tonCore()
  const message = loadMessage(Cell.fromBase64(boc).beginParse())
  if (message.info.type !== 'external-in') throw new Error('TON wallet returned no external message')
  const normalized = { ...message, init: null, info: { ...message.info, src: undefined, importFee: 0n } }
  return beginCell().store(storeMessage(normalized, { forceRef: true })).endCell().hash().toString('hex')
}

export const tonconnectWallet = createWallet({
  name: 'connectTonConnect',
  supportedChains: [Chain.Ton],
  walletType: TONCONNECT,
  connect:
    ({ addChain, walletType }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean; tonWallet?: 'tonkeeper' }) => {
      if (!chains.includes(Chain.Ton)) throw new Error('TON Connect only supports TON')
      const ui = await tonConnect()
      await ui.connectionRestored
      if (!ui.account) {
        // A restore on page load never opens the modal; with no stored session the wallet stays disconnected.
        if (config?.restoreOnly) throw new Error('No TON Connect session to restore')
        await openModal(ui, config?.tonWallet)
      }
      const account = ui.account
      if (!account) throw new Error('TON Connect returned no account')
      if (account.chain !== MAINNET) throw new Error('Switch the TON wallet to mainnet and connect again')

      const { Address, beginCell } = await tonCore()
      // The wallet reports the raw form (0:…); 1Click and explorers take the user-friendly one.
      const address = Address.parse(account.address).toString({ urlSafe: true, bounceable: false })

      const getBalance = async () => {
        const balances = []
        // One after another: keyless toncenter rate-limits parallel calls.
        for (const asset of await nearCatalogAssets(Chain.Ton)) {
          const raw = asset.address
            ? ((await jettonWallet(address, asset.address))?.balance ?? '0')
            : (await toncenter<{ balance: string }>(`/addressInformation?address=${encodeURIComponent(address)}&use_v2=false`)).balance
          balances.push(catalogBalance(asset, raw))
        }
        return balances
      }

      const transfer = async ({ assetValue, recipient }: { assetValue: AssetValue; recipient: string }) => {
        const asset = await nearCatalogAsset(Chain.Ton, assetValue)
        const amount = toBaseUnits(assetValue.getValue('string'), asset.decimals)
        let message: { address: string; amount: string; payload?: string }
        if (asset.address) {
          const source = await jettonWallet(address, asset.address)
          if (!source) throw new Error(`This TON wallet holds no ${asset.ticker}`)
          const body = beginCell()
            .storeUint(0x0f8a7ea5, 32)
            .storeUint(0, 64)
            .storeCoins(amount)
            .storeAddress(Address.parse(recipient))
            .storeAddress(Address.parse(address))
            .storeBit(0)
            .storeCoins(JETTON_FORWARD)
            .storeBit(0)
            .endCell()
          message = {
            address: Address.parse(source.address).toString({ urlSafe: true, bounceable: true }),
            amount: JETTON_GAS.toString(),
            payload: body.toBoc().toString('base64')
          }
        } else {
          // Sent to the address as 1Click gives it: a non-bounceable UQ… for its not yet deployed deposit account.
          message = { address: recipient, amount: amount.toString() }
        }
        const { boc } = await ui.sendTransaction({ validUntil: Math.floor(Date.now() / 1000) + 600, network: MAINNET, messages: [message] })
        return normalizedMessageHash(boc)
      }

      // Signing follows the wallet's current account, so a switch or a disconnect from the wallet side reloads.
      const stopStatus = ui.onStatusChange(wallet => {
        if (!wallet || wallet.account.address !== account.address) window.location.reload()
      })

      addChain({
        address,
        chain: Chain.Ton,
        walletType,
        getBalance,
        transfer,
        validateAddress: (candidate: string) => Address.isFriendly(candidate) || Address.isRaw(candidate),
        disconnect: () => {
          stopStatus()
          void ui.disconnect()
        }
      })
      return true
    }
})
