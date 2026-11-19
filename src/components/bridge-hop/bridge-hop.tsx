'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { GenericButton } from '@/components/generic-button'
import { BchMark } from '@/components/swap/bridge-marks'
import type { BridgeOperation } from '@/store/transaction-store'
import { bridgeHopCanRun, bridgeHopEligible, jump, newHop, readBest, saveBest, stepHop } from './game'
import styles from './bridge-hop.module.css'

const bestKey = (still: boolean) => `cashbridge:bridge-hop:best:${still ? 'still' : 'runner'}`

export const BridgeHop = ({ operation }: { operation: BridgeOperation }) => {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const eligible = bridgeHopEligible(operation)
  if (!open && !eligible) return null
  return (
    <section className={styles.shell} aria-label="Bridge Hop game">
      {open ? (
        <HopGame
          eligible={eligible}
          onClose={() => {
            setOpen(false)
            trigger.current?.focus()
          }}
        />
      ) : null}
      <GenericButton
        ref={trigger}
        type="button"
        size="medium"
        className={styles.launch}
        hidden={open}
        onClick={() => setOpen(true)}
      >
        Play while you wait · Bridge Hop
      </GenericButton>
    </section>
  )
}

const HopGame = ({ eligible, onClose }: { eligible: boolean; onClose: () => void }) => {
  const hintId = useId()
  const field = useRef<HTMLButtonElement>(null)
  const frame = useRef<number | undefined>(undefined)
  const state = useRef(newHop())
  const [view, setView] = useState(newHop)
  const [running, setRunning] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [still, setStill] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [savedBest, setSavedBest] = useState(() => readBest(() => localStorage.getItem(bestKey(still))))
  const best = Math.max(savedBest, view.score)
  const storageKey = bestKey(still)
  const canRun = useRef(false)

  const stopFrame = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }

  useLayoutEffect(() => {
    canRun.current = bridgeHopCanRun(eligible, running, hidden)
    if (!canRun.current) stopFrame()
    // Drop permission before paint; returning to a wait stage must require an explicit resume.
    if (!eligible || hidden) setRunning(false)
  }, [eligible, running, hidden])

  useEffect(() => {
    field.current?.focus()
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const visibility = () => {
      if (document.hidden) {
        canRun.current = false
        stopFrame()
        setRunning(false)
      }
      setHidden(document.hidden)
    }
    const motion = () => {
      canRun.current = false
      stopFrame()
      setRunning(false)
      state.current = newHop()
      setView(state.current)
      setStill(media.matches)
      setSavedBest(readBest(() => localStorage.getItem(bestKey(media.matches))))
    }
    document.addEventListener('visibilitychange', visibility)
    media.addEventListener('change', motion)
    return () => {
      canRun.current = false
      stopFrame()
      document.removeEventListener('visibilitychange', visibility)
      media.removeEventListener('change', motion)
    }
  }, [])

  useEffect(() => {
    if (view.score <= savedBest) return
    saveBest(view.score, value => localStorage.setItem(storageKey, value))
  }, [view.score, savedBest, storageKey])

  useEffect(() => {
    if (!bridgeHopCanRun(eligible, running, hidden) || still) return
    let previous: number | undefined
    const tick = (now: number) => {
      if (!canRun.current) return
      if (previous !== undefined) {
        state.current = stepHop(state.current, (now - previous) / 1000)
        setView(state.current)
      }
      previous = now
      if (state.current.over) {
        setRunning(false)
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return stopFrame
  }, [eligible, running, hidden, still])

  const hop = () => {
    if (!bridgeHopCanRun(eligible, running, document.hidden)) return
    state.current = still ? { ...state.current, score: state.current.score + 1 } : jump(state.current)
    setView(state.current)
  }
  const start = () => {
    if (!eligible || document.hidden) return
    if (state.current.over) {
      setSavedBest(best)
      state.current = newHop()
      setView(state.current)
    }
    setRunning(true)
    field.current?.focus()
  }
  const status = !eligible
    ? 'Game paused. Your transfer needs attention or has ended. Check the transfer above.'
    : view.over
      ? `Run over. ${view.score} gaps cleared. Try again while you wait.`
      : running
        ? still ? 'Static mode: hop one gap at your own pace.' : 'Tap the track or press Space or Enter to hop.'
        : 'Paused. Start or resume when you are ready.'

  return (
    <div className={styles.game}>
      <div className={styles.header}>
        <strong>Bridge Hop</strong>
        <span>Gaps {view.score} · Best {best}</span>
      </div>
      <p id={hintId} className={styles.hint}>Just for fun. No rewards or effect on your transfer. Best stays on this device.</p>
      <button
        ref={field}
        type="button"
        className={styles.track}
        aria-label={still ? 'Hop one gap' : 'Hop over the next gap'}
        aria-describedby={hintId}
        aria-disabled={!running || !eligible}
        onClick={hop}
        onKeyDown={event => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            if (!event.repeat) hop()
          }
        }}
      >
        <span className={styles.scene} aria-hidden="true">
          <span className={styles.ground} />
          <span className={styles.gap} style={{ left: `${(still ? 300 : view.obstacle) / 6}%` }} />
          <span className={styles.runner} style={{ left: `${74 / 6}%`, bottom: `${24 + (still ? 0 : view.y) / 1.6}%` }}><BchMark size={24} /></span>
          <span className={styles.trackLabel}>{still ? 'One gap at a time' : 'Keep hopping'}</span>
        </span>
      </button>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
      <div className={styles.controls}>
        {running ? (
          <GenericButton type="button" size="medium" onClick={() => setRunning(false)}>Pause</GenericButton>
        ) : (
          <GenericButton type="button" size="medium" colorType="3" disabled={!eligible || hidden} onClick={start}>
            {view.over ? 'Try again' : view.score || view.obstacle !== 620 ? 'Resume' : 'Start game'}
          </GenericButton>
        )}
        <GenericButton type="button" size="medium" onClick={onClose}>Close game</GenericButton>
      </div>
    </div>
  )
}
