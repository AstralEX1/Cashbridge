'use client'

import { useEffect, useRef, useState } from 'react'

// True while the element is on screen, so loops run only then (and never before hydration).
export function useInView<T extends Element>(threshold = 0.15) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold })
    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold])
  return [ref, inView] as const
}

// A div whose CSS animations run under [data-play='true'].
export function InView(props: React.HTMLAttributes<HTMLDivElement>) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return <div ref={ref} data-play={inView} {...props} />
}
