'use client'

import { Gamepad2, Hand, RotateCcw, Trophy, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { GenericButton } from '@/components/generic-button'
import { drawHero } from './draw'
import { type HeroState, WORLD, cancelHold, isAnimating, newHero, press, readBest, release, saveBest, stepHero } from './game'
import styles from './bridge-hero.module.css'

const BEST_KEY = 'cashbridge:bridge-hero:best'
const freshSeed = () => (Math.random() * 2 ** 32) >>> 0
const isHoldKey = (key: string) => key === ' ' || key === 'Enter'

// Offered only while the transfer runs on its own. The moment it needs the user (a signature, a
// hash, an error) or ends, the game closes so the transfer card is all that is left.
export const BridgeHero = ({ eligible }: { eligible: boolean }) => {
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

const Game = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslations('bridgeHero')
  const canvas = useRef<HTMLCanvasElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => newHero(freshSeed()))
  const game = useRef<HeroState>(initial)
  const [view, setView] = useState({ phase: initial.phase, score: 0 })
  const [best, setBest] = useState(() => readBest(() => localStorage.getItem(BEST_KEY)))
  const bestSoFar = useRef(best)
  const frame = useRef<number | undefined>(undefined)
  const scale = useRef(1)
  const still = useRef(false)

  const paint = () => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawHero(ctx, game.current, scale.current)
  }
  const sync = () => {
    const { phase, score } = game.current
    setView(view => (view.phase === phase && view.score === score ? view : { phase, score }))
    if (score <= bestSoFar.current) return
    bestSoFar.current = score
    setBest(score)
    saveBest(score, value => localStorage.setItem(BEST_KEY, value))
  }
  const stop = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }
  // Frames run only while something moves; a resting scene costs nothing.
  const run = () => {
    if (frame.current !== undefined || document.hidden) return
    let last: number | undefined
    const tick = (now: number) => {
      if (last !== undefined) game.current = stepHero(game.current, (now - last) / 1000, still.current)
      last = now
      paint()
      sync()
      frame.current = isAnimating(game.current) ? requestAnimationFrame(tick) : undefined
    }
    frame.current = requestAnimationFrame(tick)
  }
  const restart = () => {
    game.current = newHero(freshSeed())
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
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotion = () => (still.current = motion.matches)
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

  return (
    <div className={styles.game}>
      <div className={styles.bar}>
        <strong className={styles.title}>{t('title')}</strong>
        <span className={styles.best} aria-label={t('best', { score: best })}>
          <Trophy size={13} aria-hidden="true" />
          {best}
        </span>
        <button type="button" className={styles.close} aria-label={t('close')} onClick={onClose}>
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
              <Hand size={14} />
              {t('hold')}
            </span>
          )}
        </div>
        {over && (
          <div className={styles.over}>
            <strong className={styles.overScore}>{view.score}</strong>
            <GenericButton type="button" size="medium" colorType="3" icon={<RotateCcw aria-hidden="true" />} onClick={restart}>
              {t('again')}
            </GenericButton>
          </div>
        )}
      </div>
      <p className={styles.note}>{t('note')}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {over ? t('missed', { score: view.score }) : view.score ? t('crossed', { score: view.score }) : ''}
      </p>
    </div>
  )
}
