import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Chain } from '@tcswap/core'
import { register } from 'node:module'
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, TransactionMessage } from '@solana/web3.js'

// Solflare's adapter ships extensionless ESM that only a bundler resolves; this stand-in records its `initialize`.
const solflareAdapter = 'export const initialize = options => (globalThis.solflareInitialized ??= []).push(options)'
const loader = `export async function resolve(specifier, context, next) {
  if (specifier === '@solflare-wallet/wallet-adapter') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(solflareAdapter)}), shortCircuit: true }
  return next(specifier, context)
}`
register(`data:text/javascript,${encodeURIComponent(loader)}`)

// Wallet Standard Solana wallets in the real registry, signing with a throwaway key: no extension or network call here.
let reloads = 0
globalThis.window = Object.assign(new EventTarget(), { location: { origin: 'http://localhost', reload: () => reloads++ } })
const { getWallets } = await import('@mysten/wallet-standard')
const { solanaStandardWallet, standardSigner, SOLFLARE, BACKPACK, findSolanaWallet } = await import('../src/lib/solana-wallet.ts')
const { NIGHTLY } = await import('../src/lib/sui-wallet.ts')
let added
const connect = solanaStandardWallet.connectSolanaWallet.connectWallet({
  addChain: wallet => {
    added = wallet
  }
})

const key = Keypair.generate()
const ACCOUNT = {
  address: key.publicKey.toBase58(),
  chains: ['solana:mainnet'],
  features: ['solana:signTransaction'],
  publicKey: key.publicKey.toBytes()
}
const standardWallet = (name, features = ['solana:signTransaction']) => {
  const wallet = {
    name,
    version: '1.0.0',
    icon: 'data:image/svg+xml,',
    chains: ['solana:mainnet'],
    accounts: [],
    calls: [],
    granted: false,
    listeners: new Set(),
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async ({ silent } = {}) => {
          wallet.calls.push(silent ? 'silent' : 'prompt')
          return { accounts: silent && !wallet.granted ? [] : [ACCOUNT] }
        }
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event, listener) => {
          wallet.listeners.add(listener)
          return () => wallet.listeners.delete(listener)
        }
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          wallet.calls.push('disconnect')
        }
      },
      // Signs the serialized transaction it is handed, as the Wallet Standard's `solana:signTransaction` does.
      ...(features.includes('solana:signTransaction') && {
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: async (...inputs) =>
            inputs.map(({ account, chain, transaction }) => {
              wallet.calls.push(`sign:${chain}:${account.address === ACCOUNT.address}`)
              try {
                const versioned = VersionedTransaction.deserialize(transaction)
                versioned.sign([key])
                return { signedTransaction: versioned.serialize() }
              } catch {
                const legacy = Transaction.from(transaction)
                legacy.partialSign(key)
                return { signedTransaction: legacy.serialize() }
              }
            })
        }
      })
    }
  }
  return wallet
}
const solflare = standardWallet('Solflare')
getWallets().register(solflare, standardWallet('Backpack', []))

const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(7)).toBase58()
const transfer = () => SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1_000 })

beforeEach(() => {
  added = undefined
  reloads = 0
  solflare.accounts = []
  solflare.calls = []
  solflare.granted = false
  solflare.listeners.clear()
})

test('a Solana wallet is found by name only when it can sign Solana mainnet transactions', () => {
  assert.equal(findSolanaWallet(SOLFLARE), solflare)
  assert.equal(findSolanaWallet(BACKPACK), undefined)
  assert.equal(findSolanaWallet(NIGHTLY), undefined)
})

test('a connect files the account under the picked wallet with the SDK toolbox around it', async () => {
  assert.equal(await connect([Chain.Solana], { walletType: SOLFLARE }), true)
  assert.deepEqual(solflare.calls, ['prompt'])
  assert.equal(added.chain, Chain.Solana)
  assert.equal(added.walletType, SOLFLARE)
  assert.equal(added.address, ACCOUNT.address)
  assert.equal(typeof added.transfer, 'function')
  assert.equal(added.getAddress(), ACCOUNT.address)
  // Solflare's own adapter registers its wallet first, without taking over MetaMask's Solana Snap.
  assert.deepEqual(globalThis.solflareInitialized.at(-1), { disableMetaMask: true })
})

test('legacy and versioned transactions come back signed by the wallet, in the same form', async () => {
  const signer = await standardSigner(solflare, ACCOUNT.address)
  assert.equal(signer.publicKey.toBase58(), ACCOUNT.address)
  await assert.rejects(signer.signTransaction(new Transaction()), /no longer shares/)
  solflare.accounts = [ACCOUNT]

  const legacy = new Transaction({ feePayer: key.publicKey, recentBlockhash: BLOCKHASH }).add(transfer())
  const signedLegacy = await signer.signTransaction(legacy)
  assert.ok(signedLegacy instanceof Transaction)
  assert.equal(signedLegacy.verifySignatures(), true)

  const message = new TransactionMessage({ payerKey: key.publicKey, recentBlockhash: BLOCKHASH, instructions: [transfer()] }).compileToV0Message()
  const signedVersioned = await signer.signTransaction(new VersionedTransaction(message))
  assert.ok(signedVersioned instanceof VersionedTransaction)
  assert.equal(
    signedVersioned.signatures[0].some(byte => byte !== 0),
    true
  )
  assert.deepEqual(solflare.calls, ['sign:solana:mainnet:true', 'sign:solana:mainnet:true'])
})

test('a restore takes the accounts the wallet already lists, else connects silently; a missing wallet is refused by name', async () => {
  await assert.rejects(connect([Chain.Solana], { walletType: SOLFLARE, restoreOnly: true }), /no Solana mainnet account that can sign/)
  solflare.granted = true
  assert.equal(await connect([Chain.Solana], { walletType: SOLFLARE, restoreOnly: true }), true)
  assert.deepEqual(solflare.calls, ['silent', 'silent'])
  solflare.calls = []
  solflare.accounts = [ACCOUNT]
  assert.equal(await connect([Chain.Solana], { walletType: SOLFLARE, restoreOnly: true }), true)
  assert.deepEqual(solflare.calls, [])
  await assert.rejects(connect([Chain.Solana], { walletType: BACKPACK }), /Backpack with Solana is not installed/)
})

test('an account switch in the wallet reloads; our own disconnect stops listening', async () => {
  await connect([Chain.Solana], { walletType: SOLFLARE })
  for (const listener of solflare.listeners) listener({ accounts: [{ ...ACCOUNT, address: Keypair.generate().publicKey.toBase58() }] })
  assert.equal(reloads, 1)
  added.disconnect()
  assert.equal(solflare.listeners.size, 0)
  assert.deepEqual(solflare.calls, ['prompt', 'disconnect'])
})
