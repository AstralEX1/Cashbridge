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
import { addressToLockingBytecode, bindingFromPubkey, decodeTx, addressPaysScript } from '@/lib/bch'
import { checkPoolCovenants, checkSigned, parseP2pkhUnlock, reviewBuild, sourcesOf, type BuildResult } from '@/lib/cauldron'
import {
  memoScript,
  orderBinding,
  orderRedeemScript,
  orderUnlock,
  parseOrderUnlock,
  parseSaleUnlock,
  REFUND_FEE_CAP,
  saleBinding,
  saleRedeemScript,
  saleUnlock,
  type ContractFunction,
  type OrderTerms,
  type SaleFunction,
  type SaleTerms
} from '@/lib/router-contract'
import { BCH_DUST_THRESHOLD } from '@/lib/thorchain-deposit'
import { orderCategory, type Attempt, type Order, type SaleCoin } from '@/server/auto-bridge/types'

type ContractOrder = Pick<Order, 'contract' | 'recipientScript' | 'refundScript' | 'minPusd' | 'category'>
const termsOf = (order: ContractOrder, routerKey: string): OrderTerms => ({
  routerKey,
  recipientScript: order.recipientScript,
  refundScript: order.refundScript,
  category: orderCategory(order),
  minPusd: order.minPusd,
  refundAfter: order.contract!.refundAfter
})

type SaleOrder = Pick<Order, 'contract' | 'refundScript' | 'minPusd' | 'sale'>
export const saleTermsOf = (order: SaleOrder, routerKey: string): SaleTerms => ({
  routerKey,
  vaultScript: addressToLockingBytecode(order.sale!.vaultAddress) ?? '',
  memo: order.sale!.memo,
  refundScript: order.refundScript,
  minSats: order.minPusd,
  refundAfter: order.contract!.refundAfter,
  ...(order.sale!.depositSats !== undefined && { depositSats: order.sale!.depositSats })
})

// The bytes a signed contract input adds to the transaction (its unlocking script and the script's 3-byte length), for the fee.
export const orderUnlockBytes = (order: Order) =>
  order.sale
    ? saleUnlock(saleTermsOf(order, order.binding.pubkey), 'sell', new Uint8Array(65)).length + 2
    : order.contract ? orderUnlock(termsOf(order, order.binding.pubkey), 'convert', new Uint8Array(65)).length + 2 : undefined

// What a token output needs to relay, with room for its larger size.
const TOKEN_DUST = 800n

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

  // Where the order's BCH (a sale's tokens) is paid: its contract when it has one, else the plain address at its index.
  deposit(order: ContractOrder & Pick<Order, 'addressIndex' | 'sale'>) {
    const plain = this.binding(order.addressIndex)
    if (order.sale) return saleBinding(saleTermsOf(order, plain.pubkey), order.addressIndex)
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

  #assertOrder(order: Order, coins: SaleCoin[] = order.funding) {
    const binding = this.deposit(order)
    if (
      binding.lockingBytecode !== order.binding.lockingBytecode ||
      binding.pubkey !== order.binding.pubkey ||
      !addressPaysScript(order.recipientAddress, order.recipientScript) ||
      !addressPaysScript(order.refundAddress, order.refundScript) ||
      [order.recipientScript, order.refundScript].includes(binding.lockingBytecode) ||
      (order.sale && (!order.contract || order.recipientScript !== order.refundScript || !addressToLockingBytecode(order.sale.vaultAddress))) ||
      coins.length === 0 ||
      new Set(coins.map(c => `${c.txid}:${c.vout}`)).size !== coins.length ||
      coins.some(c => !c.unspent || BigInt(c.value) <= 0n)
    )
      throw new Error('Invalid signing intent')
  }

  #sign(order: Order, transaction: Transaction, sourceOutputs: Output[], indexes: number[], fn: ContractFunction | SaleFunction, coins?: SaleCoin[]) {
    this.#assertOrder(order, coins)
    const unsignedHex = binToHex(encodeTransaction(transaction))
    const key = this.#privateKey(order.addressIndex)
    const pubkey = hexToBin(order.binding.pubkey)
    const sale = order.sale && saleTermsOf(order, order.binding.pubkey)
    const terms = !sale && order.contract ? termsOf(order, order.binding.pubkey) : undefined
    const redeem = sale ? saleRedeemScript(sale) : terms && orderRedeemScript(terms)
    const unlock = (signature: Uint8Array) =>
      sale ? saleUnlock(sale, fn as SaleFunction, signature) : terms ? orderUnlock(terms, fn as ContractFunction, signature) : Uint8Array.from([65, ...signature, 33, ...pubkey])
    const parse = sale ? parseSaleUnlock(sale) : terms ? parseOrderUnlock(terms) : parseP2pkhUnlock
    try {
      const signed = {
        ...transaction,
        inputs: transaction.inputs.map((input, inputIndex) => {
          if (!indexes.includes(inputIndex)) return input
          const preimage = generateSigningSerializationBch(
            { inputIndex, sourceOutputs, transaction },
            {
              coveredBytecode: redeem ?? sourceOutputs[inputIndex].lockingBytecode,
              signingSerializationType: Uint8Array.of(0x61)
            }
          )
          const signature = secp256k1.signMessageHashSchnorr(key, hash256(preimage))
          if (typeof signature === 'string') throw new Error('BCH signing failed')
          return { ...input, unlockingBytecode: unlock(Uint8Array.from([...signature, 0x61])) }
        })
      }
      const hex = binToHex(encodeTransaction(signed))
      return { hex, txid: checkSigned(unsignedHex, hex, indexes, sourceOutputs, order.binding.pubkey, parse) }
    } finally {
      key.fill(0)
    }
  }

  signSwap(order: Order, build: BuildResult, sellSats: bigint): Attempt {
    this.#assertOrder(order)
    if (order.sale) throw new Error('A sale order sells tokens')
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
    if (order.sale) throw new Error('A sale order gives its coins back as they came')
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
  // A sale order, step 1: all the tokens of its one coin sold on Cauldron, the BCH back into the contract.
  signSale(order: Order, build: BuildResult): Attempt {
    const [coin] = order.funding as SaleCoin[]
    if (!order.sale || order.funding.length !== 1 || coin.token?.category !== order.sale.category || coin.token.nft) throw new Error('Invalid sale intent')
    const intent = {
      category: order.sale.category,
      side: 'sell' as const,
      funding: [{ txid: coin.txid, vout: coin.vout, value: coin.value, token: { category: coin.token.category, amount: coin.token.amount } }],
      lockingBytecode: order.binding.lockingBytecode,
      tokenAddress: order.binding.tokenAddress,
      cashAddress: order.binding.cashAddress,
      sell: BigInt(coin.token.amount),
      minOutput: BigInt(order.minPusd),
      ownUnlockBytes: orderUnlockBytes(order)
    }
    const reviewed = reviewBuild(build, intent)
    checkPoolCovenants(reviewed)
    const own = reviewed.ownIndexes[0]
    const transaction = decodeTx(reviewed.unsignedHex)
    // The contract checks this too; refusing here keeps a bad build from ever being signed.
    const back = transaction.outputs[own]
    if (reviewed.ownIndexes.length !== 1 || !back || binToHex(back.lockingBytecode) !== order.binding.lockingBytecode || back.token || back.valueSatoshis < BigInt(order.minPusd))
      throw new Error('The sale does not pay the contract its minimum')
    return { ...this.#sign(order, transaction, sourcesOf(reviewed), reviewed.ownIndexes, 'sell'), kind: 'swap', pusdOut: back.valueSatoshis.toString(), status: 'signed' }
  }

  // Step 2: the sale's BCH, alone, to the bridge's deposit address with the order memo; the miner fee at `feeRate` sats
  // per byte. An exact deposit (ShapeShift) pays the quoted amount and returns the rest to the customer.
  signDeposit(order: Order, sale: Attempt, feeRate = 1n): Attempt {
    if (!order.sale || sale.kind !== 'swap') throw new Error('Invalid sale intent')
    const sold = decodeTx(sale.hex)
    const vout = sold.outputs.findIndex(output => binToHex(output.lockingBytecode) === order.binding.lockingBytecode && !output.token)
    if (vout < 0) throw new Error('The sale pays nothing back to the contract')
    const value = sold.outputs[vout].valueSatoshis
    const terms = saleTermsOf(order, order.binding.pubkey)
    const exact = terms.depositSats === undefined ? undefined : BigInt(terms.depositSats)
    const tx: Transaction = {
      version: 2,
      locktime: 0,
      inputs: [{ outpointTransactionHash: hexToBin(sale.txid), outpointIndex: vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }],
      outputs: [
        { lockingBytecode: hexToBin(terms.vaultScript), valueSatoshis: exact ?? value },
        { lockingBytecode: memoScript(terms.memo), valueSatoshis: 0n },
        ...(exact === undefined ? [] : [{ lockingBytecode: hexToBin(order.refundScript), valueSatoshis: value - exact }])
      ]
    }
    const size = BigInt(encodeTransaction(tx).length + saleUnlock(terms, 'deposit', new Uint8Array(65)).length + 2)
    const fee = size * (feeRate < 1n ? 1n : feeRate) > REFUND_FEE_CAP ? REFUND_FEE_CAP : size * (feeRate < 1n ? 1n : feeRate)
    if (fee < size) throw new Error('The deposit cannot pay its fee')
    tx.outputs[exact === undefined ? 0 : 2].valueSatoshis -= fee
    if (tx.outputs[0].valueSatoshis < BCH_DUST_THRESHOLD) throw new Error('The deposit is below the bridge’s BCH minimum')
    if (exact !== undefined && tx.outputs[2].valueSatoshis < 546n) throw new Error('The change back to the customer would be dust')
    const coin = { txid: sale.txid, vout, value: value.toString(), confirmations: 0, unspent: true }
    const sources = [{ lockingBytecode: hexToBin(order.binding.lockingBytecode), valueSatoshis: value }]
    return { ...this.#sign(order, tx, sources, [0], 'deposit', [coin]), kind: 'deposit', parent: sale.txid, pusdOut: tx.outputs[0].valueSatoshis.toString(), status: 'signed' }
  }

  // The coins at a sale contract back to the customer as they came (tokens, or BCH), each at its own index.
  signGiveBack(order: Order, coins: SaleCoin[]): Attempt {
    if (!order.sale) throw new Error('Invalid sale intent')
    const tokenOf = (coin: SaleCoin): Output['token'] =>
      coin.token && {
        category: hexToBin(coin.token.category),
        amount: BigInt(coin.token.amount),
        ...(coin.token.nft && { nft: { capability: coin.token.nft.capability, commitment: hexToBin(coin.token.nft.commitment) } })
      }
    const tx: Transaction = {
      version: 2,
      locktime: 0,
      inputs: coins.map(coin => ({ outpointTransactionHash: hexToBin(coin.txid), outpointIndex: coin.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() })),
      outputs: coins.map(coin => ({ lockingBytecode: hexToBin(order.refundScript), valueSatoshis: BigInt(coin.value), ...(coin.token && { token: tokenOf(coin) }) }))
    }
    const unlockBytes = saleUnlock(saleTermsOf(order, order.binding.pubkey), 'giveBack', new Uint8Array(65)).length + 2
    const fee = BigInt(encodeTransaction(tx).length + tx.inputs.length * unlockBytes)
    const share = (fee + BigInt(tx.outputs.length) - 1n) / BigInt(tx.outputs.length)
    if (share > REFUND_FEE_CAP || tx.outputs.some(output => output.valueSatoshis - share < (output.token ? TOKEN_DUST : 546n))) throw new Error('A returned coin would be dust')
    tx.outputs.forEach(output => (output.valueSatoshis -= share))
    const sources = coins.map(coin => ({ lockingBytecode: hexToBin(order.binding.lockingBytecode), valueSatoshis: BigInt(coin.value), ...(coin.token && { token: tokenOf(coin) }) }))
    return { ...this.#sign(order, tx, sources, tx.inputs.map((_, index) => index), 'giveBack', coins), kind: 'refund', pusdOut: '0', status: 'signed' }
  }
}
