'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// One-shot section entrance for marketing blocks. Opacity-only under reduced motion.
// SSR / no-JS stays visible; client only hides briefly when motion is allowed.
export function LandingReveal({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = root.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    setPending(true)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setShown(true)
        setPending(false)
        observer.disconnect()
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={root}
      className={`landing-reveal${className ? ` ${className}` : ''}`}
      data-pending={pending && !shown ? '' : undefined}
      data-shown={shown ? '' : undefined}
    >
      {children}
    </div>
  )
}
