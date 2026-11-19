'use client'

import { useEffect, useRef, useState } from 'react'

// After Magic UI's Number Ticker: counts from the last shown value to `value` with an ease-out once on screen,
// and jumps straight there under reduced motion. Screen readers get the final value only.
export function NumberTicker({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(0)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const node = ref.current
    const from = shown.current
    if (!node || from === value) return
    const show = (n: number) => {
      shown.current = n
      setDisplay(n)
    }
    let frame = 0
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return show(value)
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 900)
        show(Math.round(from + (value - from) * (1 - (1 - t) ** 4)))
        if (t < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  return (
    <span ref={ref} className="ticker">
      <span aria-hidden>{display}</span>
      <span className="sr-only">{value}</span>
    </span>
  )
}
