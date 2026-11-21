import { readBest } from '@/components/bridge-hero/game'

// What a player keeps on this device: the record, the BCH coins picked up in the game, and the
// characters bought with them. Game coins only: they never touch a wallet or a transfer.

export const CHARACTERS = [
  { id: 'cash', name: 'Cash', price: 0 },
  { id: 'gold', name: 'Gold', price: 15 },
  { id: 'jelly', name: 'Jelly', price: 30 },
  { id: 'block', name: 'Block', price: 50 },
  { id: 'cat', name: 'Cat', price: 80 },
  { id: 'astro', name: 'Astro', price: 120 }
] as const
export type CharacterId = (typeof CHARACTERS)[number]['id']
export type Wallet = { best: number; coins: number; owned: CharacterId[]; selected: CharacterId }

export const WALLET_KEY = 'cashbridge:bridge-hero:wallet'
const OLD_BEST_KEY = 'cashbridge:bridge-hero:best'
const isCharacter = (id: unknown): id is CharacterId => CHARACTERS.some(c => c.id === id)
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0)

// Storage is the player's own and may be edited, blocked or corrupt: anything odd falls back.
export const readWallet = (read: (key: string) => string | null): Wallet => {
  let saved: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(read(WALLET_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') saved = parsed
  } catch {
    // Unreadable record: start fresh below.
  }
  const owned = Array.isArray(saved.owned) ? saved.owned.filter(isCharacter) : []
  if (!owned.includes('cash')) owned.unshift('cash')
  return {
    best: Math.max(count(saved.best), readBest(() => read(OLD_BEST_KEY))),
    coins: count(saved.coins),
    owned: [...new Set(owned)],
    selected: isCharacter(saved.selected) && owned.includes(saved.selected) ? saved.selected : 'cash'
  }
}

export const saveWallet = (wallet: Wallet, write: (key: string, value: string) => void) => {
  try {
    write(WALLET_KEY, JSON.stringify(wallet))
  } catch {
    // Private browsing or full storage: this visit still keeps its progress.
  }
}

// After a run: the record only goes up, every coin picked up is kept.
export const addRun = (wallet: Wallet, score: number, coins: number): Wallet => ({
  ...wallet,
  best: Math.max(wallet.best, score),
  coins: wallet.coins + coins
})

export const buyOrSelect = (wallet: Wallet, id: CharacterId): Wallet => {
  if (wallet.owned.includes(id)) return { ...wallet, selected: id }
  const price = CHARACTERS.find(c => c.id === id)!.price
  if (wallet.coins < price) return wallet
  return { ...wallet, coins: wallet.coins - price, owned: [...wallet.owned, id], selected: id }
}
