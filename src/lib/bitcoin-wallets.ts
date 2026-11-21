import { Chain, WalletOption } from '@tcswap/core'
import { createWallet } from '@tcswap/wallets'
import { Psbt } from 'bitcoinjs-lib'

// Bitcoin wallets without an SDK connector. The SDK's UTXO toolbox builds the PSBT (memo included) and broadcasts it;
// the wallet only signs, as the SDK's Bitget connector has Bitget's Unisat-style provider do.
export const UNISAT = 'UNISAT' as string as WalletOption
export const LEATHER = 'LEATHER' as string as WalletOption

// docs.unisat.io/dev/unisat-wallet-api
interface UnisatProvider {
  requestAccounts: () => Promise<string[]>
  getAccounts: () => Promise<string[]>
  getChain: () => Promise<{ enum: string }>
  switchChain: (chain: string) => Promise<unknown>
  signPsbt: (psbtHex: string, options?: { autoFinalized?: boolean }) => Promise<string>
  on?: (event: 'accountsChanged', listener: (accounts: string[]) => void) => void
  removeListener?: (event: 'accountsChanged', listener: (accounts: string[]) => void) => void
}

// app.leather.io/posts/api-get-addresses and /api-sign-psbt (shapes from @leather.io/rpc)
interface LeatherProvider {
  request: (method: string, params?: unknown) => Promise<{ result: any }>
}

export const unisatProvider = () => (typeof window === 'undefined' ? undefined : (window as unknown as { unisat?: UnisatProvider }).unisat)
export const leatherProvider = () =>
  typeof window === 'undefined' ? undefined : (window as unknown as { LeatherProvider?: LeatherProvider }).LeatherProvider

// Extensions inject a moment after load, which a restore on page load can beat.
const waitFor = async <T>(find: () => T | undefined) => {
  for (let waited = 0; waited < 1_000 && !find(); waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  return find()
}

const addBitcoinChain = async (
  addChain: Parameters<Parameters<typeof createWallet>[0]['connect']>[0]['addChain'],
  walletType: WalletOption,
  address: string,
  sign: (psbt: Psbt) => Promise<Psbt>,
  disconnect?: () => void
) => {
  const { getUtxoToolbox } = await import('@tcswap/toolboxes/utxo')
  // The toolbox may hold another bitcoinjs-lib copy; it re-reads the signed PSBT into its own before finalizing.
  const signTransaction = ((psbt: { toHex: () => string }) => sign(Psbt.fromHex(psbt.toHex()))) as never
  const toolbox = await getUtxoToolbox(Chain.Bitcoin, { signer: { getAddress: async () => address, signTransaction } })
  addChain({ ...toolbox, address, chain: Chain.Bitcoin, walletType, ...(disconnect && { disconnect }) })
}

// Signed, not finalized: the toolbox finalizes and broadcasts.
const unisatSigner = (unisat: UnisatProvider) => async (psbt: Psbt) => Psbt.fromHex(await unisat.signPsbt(psbt.toHex(), { autoFinalized: false }))

// Every input is the wallet's own payment address; Leather returns the PSBT without broadcasting it.
const leatherSigner = (leather: LeatherProvider) => async (psbt: Psbt) => {
  const signAtIndex = psbt.txInputs.map((_, index) => index)
  const { result } = await leather.request('signPsbt', { hex: psbt.toHex(), network: 'mainnet', broadcast: false, signAtIndex })
  return Psbt.fromHex(result.hex)
}

export const unisatWallet = createWallet({
  name: 'connectUnisat',
  supportedChains: [Chain.Bitcoin],
  walletType: UNISAT,
  connect:
    ({ addChain, walletType }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean }) => {
      if (!chains.includes(Chain.Bitcoin)) throw new Error('UniSat connects only Bitcoin here')
      const unisat = await waitFor(unisatProvider)
      if (!unisat) throw new Error('UniSat is not installed')

      // `getAccounts` answers without a prompt, empty until this site is connected; Fractal also uses bc1 addresses.
      const [address] = config?.restoreOnly ? await unisat.getAccounts() : await unisat.requestAccounts()
      if (!address) throw new Error('UniSat has not connected this site')
      if ((await unisat.getChain()).enum !== 'BITCOIN_MAINNET') {
        if (config?.restoreOnly) throw new Error('UniSat is not on Bitcoin mainnet')
        await unisat.switchChain('BITCOIN_MAINNET')
      }
      // UniSat adds the Taproot key itself, but not a redeem script: the toolbox's inputs carry only `witnessUtxo`.
      if (!/^bc1[qp]/.test(address)) throw new Error('Switch UniSat to a Native SegWit (bc1q) or Taproot (bc1p) address and connect again')

      // Signing follows the wallet's current account, so a switch reloads, as the TronLink connector does.
      const onAccounts = (accounts: string[]) => {
        if (!accounts.includes(address)) window.location.reload()
      }
      unisat.on?.('accountsChanged', onAccounts)

      await addBitcoinChain(addChain, walletType, address, unisatSigner(unisat), () => unisat.removeListener?.('accountsChanged', onAccounts))
      return true
    }
})

export const leatherWallet = createWallet({
  name: 'connectLeather',
  supportedChains: [Chain.Bitcoin],
  walletType: LEATHER,
  connect:
    ({ addChain, walletType }) =>
    async (chains: Chain[], config?: { restoreOnly?: boolean }) => {
      if (!chains.includes(Chain.Bitcoin)) throw new Error('Leather connects only Bitcoin here')
      // Leather documents no prompt-free account read, so a page-load restore leaves it for the user to reconnect.
      if (config?.restoreOnly) throw new Error('Leather reconnects only on request')
      const leather = await waitFor(leatherProvider)
      if (!leather) throw new Error('Leather is not installed')

      const { result } = await leather.request('getAddresses')
      const addresses: { symbol?: string; type?: string; address?: string }[] = result?.addresses ?? []
      // The payment (Native SegWit) address: the toolbox signs and sizes P2WPKH inputs.
      const address = addresses.find(a => a.symbol === 'BTC' && a.type === 'p2wpkh')?.address
      if (!address) throw new Error('Leather shared no Native SegWit Bitcoin address')

      await addBitcoinChain(addChain, walletType, address, leatherSigner(leather))
      return true
    }
})
