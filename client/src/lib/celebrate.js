// A task done: a little celebration around its tick, and a moment to see it done before
// it is (struck through, then moved where its rules put it).
import { useEffect, useRef, useState } from 'react'

const COLORS = ['var(--success)', 'var(--accent)', '#f2b441', '#ee6f98', '#5aa8f2', 'var(--success)']

/**
 * A ring and a burst of dots from the middle of `el` (a tick), drawn over the page —
 * fixed, so nothing moves — and gone in a moment. Just the ring for reduced motion.
 */
export function celebrate(el) {
  const r = el?.getBoundingClientRect?.()
  if (!r || !r.width) return
  const box = document.createElement('div')
  box.className = 'celebrate'
  box.setAttribute('aria-hidden', 'true')
  box.style.left = `${r.left + r.width / 2}px`
  box.style.top = `${r.top + r.height / 2}px`
  const ring = document.createElement('i')
  ring.className = 'celebrate-ring'
  box.append(ring)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const n = 10
    for (let i = 0; i < n; i++) {
      const dot = document.createElement('i')
      dot.className = `celebrate-dot ${i % 3 === 0 ? 'long' : ''}`
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
      const d = 15 + Math.random() * 9
      dot.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`)
      dot.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(1)}px`)
      dot.style.setProperty('--rot', `${Math.round((a * 180) / Math.PI)}deg`)
      dot.style.background = COLORS[i % COLORS.length]
      box.append(dot)
    }
  }
  document.body.append(box)
  setTimeout(() => box.remove(), 900)
}

/**
 * Marking something done is shown before it is made: `settle(el)` celebrates around `el`
 * and reports `settling` (to draw it done: the tick filled, the words struck through),
 * and `commit` runs `ms` later — when it really is done, and moves as its rules say. A
 * second `settle` before then takes it back. (Gone from the screen in the meantime, it
 * is done there and then: a click is never lost.)
 */
export function useSettle(commit, ms = 700) {
  const [settling, setSettling] = useState(false)
  const timer = useRef(null)
  const latest = useRef(commit)
  latest.current = commit
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        latest.current()
      }
    },
    [],
  )
  const settle = (el) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      setSettling(false)
      return
    }
    setSettling(true)
    celebrate(el)
    timer.current = setTimeout(() => {
      timer.current = null
      setSettling(false)
      latest.current()
    }, ms)
  }
  return [settling, settle]
}
