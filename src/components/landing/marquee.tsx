'use client'

import { Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { useInView } from './in-view'

// Infinite logo strip, after Magic UI's Marquee (magicui.design/docs/components/marquee): the children repeat so
// the strip loops without a seam, and the copies are hidden from assistive technology. It moves only while on
// screen, pauses under the pointer or with its button, and stands still under reduced motion. CSS in landing.css.
export function Marquee({ children, reverse, label, repeat = 3 }: { children: React.ReactNode; reverse?: boolean; label: string; repeat?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const [paused, setPaused] = useState(false)
  return (
    <div className="marquee-frame" role="region" aria-label={label}>
      <div ref={ref} className="marquee" data-play={inView} data-paused={paused || undefined} data-reverse={reverse || undefined}>
        {Array.from({ length: repeat }, (_, i) => (
          <ul key={i} className="marquee-track" aria-hidden={i > 0 || undefined}>
            {children}
          </ul>
        ))}
      </div>
      <button type="button" className="marquee-toggle" onClick={() => setPaused(!paused)} aria-label={paused ? `Play ${label}` : `Pause ${label}`}>
        {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
      </button>
    </div>
  )
}
