'use client'

import { type PropsWithChildren, useLayoutEffect, useRef } from 'react'

export const BridgeInputSwitcher = ({ selecting, children }: PropsWithChildren<{ selecting: boolean }>) => {
  const switcher = useRef<HTMLDivElement>(null)
  const lastHeight = useRef<number | null>(null)
  const lastSelecting = useRef<boolean | null>(null)

  useLayoutEffect(() => {
    const element = switcher.current
    if (!element) return

    element.style.height = 'auto'
    lastHeight.current = element.getBoundingClientRect().height

    const observer = new ResizeObserver(() => {
      if (element.style.height === 'auto') lastHeight.current = element.getBoundingClientRect().height
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = switcher.current
    if (!element) return

    if (lastSelecting.current === null) {
      lastSelecting.current = selecting
      return
    }
    if (lastSelecting.current === selecting) return
    lastSelecting.current = selecting

    const currentHeight = element.style.height === 'auto'
      ? lastHeight.current ?? element.getBoundingClientRect().height
      : element.getBoundingClientRect().height
    const duration = Number.parseFloat(getComputedStyle(element).transitionDuration)

    element.style.transition = 'none'
    element.style.height = 'auto'
    const nextHeight = element.getBoundingClientRect().height
    element.style.height = `${currentHeight}px`
    void element.offsetHeight
    element.style.removeProperty('transition')

    const finish = () => {
      element.style.height = 'auto'
      lastHeight.current = element.getBoundingClientRect().height
    }

    if (duration === 0 || Math.abs(currentHeight - nextHeight) < 1) {
      element.style.height = `${nextHeight}px`
      finish()
      return
    }

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== element || event.propertyName !== 'height') return
      element.removeEventListener('transitionend', onTransitionEnd)
      finish()
    }

    element.addEventListener('transitionend', onTransitionEnd)
    element.style.height = `${nextHeight}px`

    return () => element.removeEventListener('transitionend', onTransitionEnd)
  }, [selecting])

  return (
    <div ref={switcher} className="bridge-input-switcher" data-selecting={selecting}>
      {children}
    </div>
  )
}
