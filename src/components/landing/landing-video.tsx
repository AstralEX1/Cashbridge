'use client'

import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// A silent product loop that plays only while on screen, with a pause control (it runs longer than five
// seconds). Under reduced motion it waits on its poster until the viewer presses play.
export function LandingVideo({
  src,
  poster,
  label,
  className,
  eager
}: {
  src: string
  poster: string
  label: string
  className?: string
  eager?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(true)
  const userPaused = useRef(false)

  useEffect(() => {
    const node = video.current
    if (!node) return
    userPaused.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !userPaused.current) node.play().catch(() => setPaused(true))
        else node.pause()
      },
      { threshold: 0.2 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const toggle = () => {
    const node = video.current
    if (!node) return
    userPaused.current = !node.paused
    if (node.paused) node.play().catch(() => setPaused(true))
    else node.pause()
  }

  return (
    <figure className={`landing-video ${className ?? ''}`}>
      <video
        ref={video}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload={eager ? 'auto' : 'metadata'}
        aria-label={label}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
      />
      <button type="button" className="landing-video-toggle" onClick={toggle} aria-label={paused ? 'Play video' : 'Pause video'}>
        {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
      </button>
    </figure>
  )
}
