'use client'

import { Check, Coins, Gamepad2, Hand, RotateCcw, ShoppingBag, Trophy, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { GenericButton } from '@/components/generic-button'
import { drawCharacter } from './characters'
import { drawHero } from './draw'
import { type HeroState, WORLD, cancelHold, isAnimating, newHero, press, release, stepHero } from './game'
import { startWorld } from './scene'
import { CHARACTERS, type CharacterId, type Wallet, addRun, buyOrSelect, readWallet, saveWallet } from './wallet'
import styles from './bridge-hero.module.css'

const freshSeed = () => (Math.random() * 2 ** 32) >>> 0
const isHoldKey = (key: string) => key === ' ' || key === 'Enter'
const load = () => readWallet(key => localStorage.getItem(key))
const store = (wallet: Wallet) => saveWallet(wallet, (key, value) => localStorage.setItem(key, value))

// Offered only while the transfer runs on its own. The moment it needs the user (a signature, a
// hash, an error) or ends, the game closes so the transfer card is all that is left.
// `chain` is the transfer's source chain: the run starts in that chain's world.
export const BridgeHero = ({ eligible, chain }: { eligible: boolean; chain?: string }) => {
  const t = useTranslations('bridgeHero')
  const [open, setOpen] = useState(false)
  const launch = useRef<HTMLButtonElement>(null)
  const closedByUser = useRef(false)
  // Closed for good when the transfer needs the user, so it never reopens on its own later.
  if (!eligible && open) setOpen(false)
  useEffect(() => {
    if (!open && closedByUser.current) launch.current?.focus()
    closedByUser.current = false
  }, [open])
  if (!eligible) return null
  return (
    <section className={styles.shell} aria-label={t('title')}>
      {open ? (
        <Game
          start={startWorld(chain)}
          onClose={() => {
            closedByUser.current = true
            setOpen(false)
          }}
        />
      ) : (
        <button ref={launch} type="button" className={styles.launch} onClick={() => setOpen(true)}>
          <Gamepad2 size={18} aria-hidden="true" />
          {t('play')}
        </button>
      )}
    </section>
  )
}

const Game = ({ start, onClose }: { start: number; onClose: () => void }) => {
  const t = useTranslations('bridgeHero')
  const canvas = useRef<HTMLCanvasElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => newHero(freshSeed()))
  const game = useRef<HeroState>(initial)
  const [view, setView] = useState({ phase: initial.phase, score: 0, collected: 0 })
  const [wallet, setWallet] = useState(load)
  const saved = useRef(wallet)
  // The record before this run, so the end screen can tell a new one.
  const [record, setRecord] = useState(wallet.best)
  const [shop, setShop] = useState(false)
  const frame = useRef<number | undefined>(undefined)
  const scale = useRef(1)
  const still = useRef(false)
  const onScreen = useRef(true)
  const counted = useRef(0)

  const keep = (next: Wallet) => {
    saved.current = next
    setWallet(next)
    store(next)
  }
  const paint = (time = performance.now()) => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawHero(ctx, game.current, scale.current, { start, character: saved.current.selected, time: still.current ? 0 : time / 1000 })
  }
  // Every coin and every new record is saved the moment it happens, so closing mid-run loses nothing.
  const sync = () => {
    const { phase, score, collected } = game.current
    setView(view => (view.phase === phase && view.score === score && view.collected === collected ? view : { phase, score, collected }))
    if (score > saved.current.best || collected > counted.current) {
      keep(addRun(saved.current, score, collected - counted.current))
      counted.current = collected
    }
  }
  const stop = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }
  // The weather keeps moving while the game is on screen; with reduced motion, frames run only
  // while the hero moves.
  const run = () => {
    if (frame.current !== undefined || document.hidden) return
    let last: number | undefined
    const tick = (now: number) => {
      if (last !== undefined) game.current = stepHero(game.current, (now - last) / 1000, still.current)
      last = now
      paint(now)
      sync()
      const ambient = !still.current && onScreen.current
      frame.current = ambient || isAnimating(game.current) ? requestAnimationFrame(tick) : undefined
    }
    frame.current = requestAnimationFrame(tick)
  }
  const restart = () => {
    game.current = newHero(freshSeed())
    counted.current = 0
    setRecord(saved.current.best)
    sync()
    paint()
    field.current?.focus()
  }
  const hold = () => {
    if (game.current.phase === 'over') return restart()
    game.current = press(game.current)
    run()
  }
  const letGo = () => {
    game.current = release(game.current)
    run()
  }
  const pick = (id: CharacterId) => {
    keep(buyOrSelect(saved.current, id))
    paint()
  }

  useEffect(() => {
    const element = canvas.current!
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      element.width = Math.round(element.clientWidth * ratio)
      element.height = Math.round((element.clientWidth * ratio * WORLD.height) / WORLD.width)
      scale.current = element.width / WORLD.width
      paint()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const seen = new IntersectionObserver(([entry]) => {
      onScreen.current = entry.isIntersecting
      if (entry.isIntersecting) run()
    })
    seen.observe(element)
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotion = () => {
      still.current = motion.matches
      run()
    }
    const visibility = () => {
      if (!document.hidden) return run()
      stop()
      game.current = cancelHold(game.current)
      sync()
      paint()
    }
    syncMotion()
    resize()
    field.current?.focus()
    motion.addEventListener('change', syncMotion)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      stop()
      observer.disconnect()
      seen.disconnect()
      motion.removeEventListener('change', syncMotion)
      document.removeEventListener('visibilitychange', visibility)
    }
    // The handlers only touch refs; one setup for the life of the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    hold()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isHoldKey(event.key)) return
    event.preventDefault()
    if (!event.repeat) hold()
  }
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isHoldKey(event.key)) letGo()
  }
  const over = view.phase === 'over'
  const newRecord = over && view.score > record

  return (
    <div className={styles.game}>
      <div className={styles.bar}>
        <strong className={styles.title}>{t('title')}</strong>
        <span className={styles.stat} aria-label={t('coins', { count: wallet.coins })}>
          <Coins size={13} aria-hidden="true" />
          <span key={wallet.coins} className={styles.bump}>
            {wallet.coins}
          </span>
        </span>
        <span className={styles.stat} aria-label={t('best', { score: wallet.best })}>
          <Trophy size={13} aria-hidden="true" />
          {wallet.best}
        </span>
        <button type="button" className={styles.icon} aria-label={t('shop')} aria-pressed={shop} onClick={() => setShop(!shop)}>
          <ShoppingBag size={15} aria-hidden="true" />
        </button>
        <button type="button" className={styles.icon} aria-label={t('close')} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.stage}>
        <div
          ref={field}
          role="button"
          tabIndex={0}
          aria-label={t('field')}
          className={styles.field}
          onPointerDown={onPointerDown}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onLostPointerCapture={letGo}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onContextMenu={event => event.preventDefault()}
        >
          <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
          {!over && (
            <span key={view.score} className={styles.score} aria-hidden="true">
              {view.score}
            </span>
          )}
          {view.phase === 'ready' && view.score === 0 && (
            <span className={styles.hint} aria-hidden="true">
              <span>
                <Hand size={14} />
                {t('hold')}
              </span>
              <span>
                <Coins size={14} />
                {t('hop')}
              </span>
            </span>
          )}
        </div>
        {over && !shop && (
          <div className={styles.over}>
            {newRecord && <span className={styles.record}>{t('newRecord')}</span>}
            <strong className={styles.overScore}>{view.score}</strong>
            <span className={styles.overStats}>
              <span>
                <Trophy size={13} aria-hidden="true" />
                {wallet.best}
              </span>
              <span>
                <Coins size={13} aria-hidden="true" />+{view.collected}
              </span>
            </span>
            <GenericButton type="button" size="medium" colorType="3" icon={<RotateCcw aria-hidden="true" />} onClick={restart}>
              {t('again')}
            </GenericButton>
          </div>
        )}
        {shop && <Shop wallet={wallet} onPick={pick} onClose={() => setShop(false)} />}
      </div>
      <p className={styles.note}>{t('note')}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {over ? t('missed', { score: view.score }) : view.score ? t('crossed', { score: view.score }) : ''}
      </p>
    </div>
  )
}

const Shop = ({ wallet, onPick, onClose }: { wallet: Wallet; onPick: (id: CharacterId) => void; onClose: () => void }) => {
  const t = useTranslations('bridgeHero')
  return (
    <div className={styles.shop} role="dialog" aria-label={t('shop')}>
      <div className={styles.shopHead}>
        <strong>{t('shop')}</strong>
        <button type="button" className={styles.icon} aria-label={t('closeShop')} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.shopGrid}>
        {CHARACTERS.map(character => {
          const owned = wallet.owned.includes(character.id)
          const selected = wallet.selected === character.id
          const short = !owned && wallet.coins < character.price
          return (
            <button
              key={character.id}
              type="button"
              className={styles.tile}
              data-selected={selected || undefined}
              disabled={short}
              aria-label={owned ? character.name : t('buy', { name: character.name, price: character.price })}
              aria-pressed={selected}
              onClick={() => onPick(character.id)}
            >
              <Preview id={character.id} />
              <span>{character.name}</span>
              <span className={styles.price}>
                {selected ? <Check size={13} aria-hidden="true" /> : owned ? null : (
                  <>
                    <Coins size={12} aria-hidden="true" />
                    {character.price}
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const Preview = ({ id }: { id: CharacterId }) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current!
    const ratio = window.devicePixelRatio || 1
    element.width = element.height = Math.round(30 * ratio)
    const ctx = element.getContext('2d')
    if (!ctx) return
    // 30px shows 22.5 world units: the character with room for ears and antenna.
    ctx.setTransform((ratio * 30) / 22.5, 0, 0, (ratio * 30) / 22.5, 0, 0)
    drawCharacter(ctx, id, 11.25, 12, 0)
  }, [id])
  return <canvas ref={canvas} className={styles.preview} aria-hidden="true" />
}
