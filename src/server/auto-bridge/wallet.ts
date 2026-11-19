import {
  binToHex,
  decodeHdPrivateKey,
  decodeHdPublicKey,
  deriveHdPrivateNodeChild,
  deriveHdPublicNodeChild,
  deriveHdPublicNode,
  encodeHdPublicKey,
  encodeTransaction,
  generateSigningSerializationBch,
  hash256,
  hexToBin,
  secp256k1,
  type Output,
  type Transaction
} from '@bitauth/libauth'
import { bindingFromPubkey, decodeTx, addressPaysScript } from '@/lib/bch'
import { checkPoolCovenants, checkSigned, parseP2pkhUnlock, reviewBuild, sourcesOf, type BuildResult } from '@/lib/cauldron'
import { orderBinding, orderRedeemScript, orderUnlock, parseOrderUnlock, type ContractFunction, type OrderTerms } from '@/lib/router-contract'
import { orderCategory, type Attempt, type Order } from '@/server/auto-bridge/types'

type ContractOrder = Pick<Order, 'contract' | 'recipientScript' | 'refundScript' | 'minPusd' | 'category'>
const termsOf = (order: ContractOrder, routerKey: string): OrderTerms => ({
  routerKey,
  recipientScript: order.recipientScript,
  refundScript: order.refundScript,
  category: orderCategory(order),
  minPusd: order.minPusd,
  refundAfter: order.contract!.refundAfter
})

// The bytes a signed contract input adds to the transaction (its unlocking script and the script's 3-byte length), for the fee.
export const orderUnlockBytes = (order: Order) =>
  order.contract ? orderUnlock(termsOf(order, order.binding.pubkey), 'convert', new Uint8Array(65)).length + 2 : undefined

const validIndex = (index: number) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 2 ** 31) throw new Error('Invalid HD address index')
}

export class PublicWallet {
  constructor(readonly xpub: string) {
    try {
      const decoded = decodeHdPublicKey(xpub)
      if (typeof decoded === 'string' || decoded.network !== 'mainnet') throw new Error()
    } catch {
      throw new Error('Invalid mainnet account public key')
    }
  }

  binding(index: number) {
    validIndex(index)
    const decoded = decodeHdPublicKey(this.xpub)
    if (typeof decoded === 'string') throw new Error('Invalid public wallet')
    const branch = deriveHdPublicNodeChild(decoded.node, 0)
    const child = deriveHdPublicNodeChild(branch, index)
    return bindingFromPubkey(child.publicKey, index)
  }

  // Where the order's BCH is paid: its contract when it has one, else the plain address at its index.
  deposit(order: ContractOrder & Pick<Order, 'addressIndex'>) {
    const plain = this.binding(order.addressIndex)
    return order.contract ? orderBinding(termsOf(order, plain.pubkey), order.addressIndex) : plain
  }
}

// The public web process never imports this module or receives the private account key.
export class WorkerWallet extends PublicWallet {
  #account: ReturnType<typeof decodeHdPrivateKey>

  constructor(accountKey: string) {
    let decoded: ReturnType<typeof decodeHdPrivateKey>
    try {
      decoded = decodeHdPrivateKey(accountKey)
    } catch {
      throw new Error('Invalid worker key file')
    }
    if (typeof decoded === 'string' || decoded.network !== 'mainnet') throw new Error('Invalid worker key file')
    super(encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(decoded.node) }).hdPublicKey)
    this.#account = decoded
  }

  #privateKey(index: number): Uint8Array {
    validIndex(index)
    if (typeof this.#account === 'string') throw new Error('Invalid worker wallet')
    const child = deriveHdPrivateNodeChild(deriveHdPrivateNodeChild(this.#account.node, 0), index)
    const pubkey = secp256k1.derivePublicKeyCompressed(child.privateKey)
    if (typeof pubkey === 'string' || binToHex(pubkey) !== this.binding(index).pubkey) throw new Error('Wallet derivation mismatch')
    return child.privateKey
  }

  #assertOrder(order: Order) {
    const binding = this.deposit(order)
    if (
      binding.lockingBytecode !== order.binding.lockingBytecode ||
      binding.pubkey !== order.binding.pubkey ||
      !addressPaysScript(order.recipientAddress, order.recipientScript) ||
      !addressPaysScript(order.refundAddress, order.refundScript) ||
      [order.recipientScript, order.refundScript].includes(binding.lockingBytecode) ||
      order.funding.length === 0 ||
      new Set(order.funding.map(c => `${c.txid}:${c.vout}`)).size !== order.funding.length ||
      order.funding.some(c => !c.unspent || BigInt(c.value) <= 0n)
    )
      throw new Error('Invalid signing intent')
  }

  #sign(order: Order, transaction: Transaction, sourceOutputs: Output[], indexes: number[], fn: ContractFunction) {
    this.#assertOrder(order)
    const unsignedHex = binToHex(encodeTransaction(transaction))
    const key = this.#privateKey(order.addressIndex)
    const pubkey = hexToBin(order.binding.pubkey)
    const terms = order.contract && termsOf(order, order.binding.pubkey)
    try {
      const signed = {
        ...transaction,
        inputs: transaction.inputs.map((input, inputIndex) => {
          if (!indexes.includes(inputIndex)) return input
          const preimage = generateSigningSerializationBch(
            { inputIndex, sourceOutputs, transaction },
            {
              coveredBytecode: terms ? orderRedeemScript(terms) : sourceOutputs[inputIndex].lockingBytecode,
              signingSerializationType: Uint8Array.of(0x61)
            }
          )
          const signature = secp256k1.signMessageHashSchnorr(key, hash256(preimage))
          if (typeof signature === 'string') throw new Error('BCH signing failed')
          const withType = Uint8Array.from([...signature, 0x61])
          return { ...input, unlockingBytecode: terms ? orderUnlock(terms, fn, withType) : Uint8Array.from([65, ...withType, 33, ...pubkey]) }
        })
      }
      const hex = binToHex(encodeTransaction(signed))
      return { hex, txid: checkSigned(unsignedHex, hex, indexes, sourceOutputs, order.binding.pubkey, terms ? parseOrderUnlock(terms) : parseP2pkhUnlock) }
    } finally {
      key.fill(0)
    }
  }

  signSwap(order: Order, build: BuildResult, sellSats: bigint): Attempt {
    this.#assertOrder(order)
    if (sellSats <= 0n || sellSats > order.funding.reduce((sum, coin) => sum + BigInt(coin.value), 0n)) throw new Error('Invalid sale amount')
    // The contract binds each coin to the payout at its own index, so a contract order swaps exactly one coin.
    if (order.contract && order.funding.length !== 1) throw new Error('A contract order swaps one coin')
    const reviewed = reviewBuild(build, {
      category: orderCategory(order),
      side: 'buy',
      funding: order.funding,
      lockingBytecode: order.binding.lockingBytecode,
      tokenAddress: order.recipientAddress,
      cashAddress: order.refundAddress,
      payout: { tokenScript: order.recipientScript, changeScript: order.refundScript },
      sell: sellSats,
      minOutput: BigInt(order.minPusd),
      ownUnlockBytes: orderUnlockBytes(order)
    })
    checkPoolCovenants(reviewed)
    return {
      ...this.#sign(order, decodeTx(reviewed.unsignedHex), sourcesOf(reviewed), reviewed.ownIndexes, 'convert'),
      kind: 'swap',
      pusdOut: reviewed.output.toString(),
      status: 'signed'
    }
  }

  signRefund(order: Order): Attempt {
    this.#assertOrder(order)
    const total = order.funding.reduce((sum, coin) => sum + BigInt(coin.value), 0n)
    const tx: Transaction = {
      version: 2,
      locktime: 0,
      inputs: order.funding.map(coin => ({
        outpointTransactionHash: hexToBin(coin.txid),
        outpointIndex: coin.vout,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array()
      })),
      // A contract pays each coin back at its own index; a plain address returns them all in one output.
      outputs: (order.contract ? order.funding.map(coin => BigInt(coin.value)) : [total]).map(valueSatoshis => ({ lockingBytecode: hexToBin(order.refundScript), valueSatoshis }))
    }
    const unlockBytes = orderUnlockBytes(order) ?? 100
    const fee = BigInt(encodeTransaction(tx).length + tx.inputs.length * unlockBytes)
    const share = (fee + BigInt(tx.outputs.length) - 1n) / BigInt(tx.outputs.length)
    if (tx.outputs.some(output => output.valueSatoshis - share < 546n)) throw new Error('BCH refund would be dust')
    tx.outputs.forEach(output => (output.valueSatoshis -= share))
    const sources = order.funding.map(coin => ({ lockingBytecode: hexToBin(order.binding.lockingBytecode), valueSatoshis: BigInt(coin.value) }))
    return {
      ...this.#sign(
        order,
        tx,
        sources,
        tx.inputs.map((_, index) => index),
        'giveBack'
      ),
      kind: 'refund',
      pusdOut: '0',
      status: 'signed'
    }
  }
}
