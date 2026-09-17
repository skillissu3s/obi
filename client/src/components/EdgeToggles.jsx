import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayout } from '../store/layout.js'

const NEAR = 34 // px from an edge before its toggle fades in

// Invisible sidebar toggles that appear when the pointer comes close to a panel edge.
export function EdgeToggles() {
  const left = useLayout((s) => s.left)
  const right = useLayout((s) => s.right)
  const ref = useRef(null)
  const [hot, setHot] = useState(null) // { side, x, y }
  const pos = useRef({ left: { x: 0, y: 0 }, right: { x: 0, y: 0 } })
  if (hot) pos.current[hot.side] = { x: hot.x, y: hot.y }

  useEffect(() => {
    let raf = 0
    let last = null
    const compute = () => {
      raf = 0
      const host = ref.current?.parentElement
      if (!host || !last) return
      const body = host.getBoundingClientRect()
      const { clientX: x, clientY: y } = last
      if (y < body.top || y > body.bottom || x < body.left || x > body.right || last.buttons) return setHot(null)
      const leftPanel = host.querySelector(':scope > .sidebar.left') || host.querySelector(':scope > .ribbon')
      const rightPanel = host.querySelector(':scope > .sidebar.right')
      const leftEdge = leftPanel ? leftPanel.getBoundingClientRect().right : body.left
      const rightEdge = rightPanel ? rightPanel.getBoundingClientRect().left : body.right
      const clampY = (v) => Math.max(34, Math.min(body.height - 34, v - body.top))
      // only on the content side of the edge, so panels keep their own hover space
      if (x >= leftEdge - 6 && x - leftEdge < NEAR) setHot({ side: 'left', x: leftEdge - body.left, y: clampY(y) })
      else if (x <= rightEdge + 6 && rightEdge - x < NEAR) setHot({ side: 'right', x: rightEdge - body.left, y: clampY(y) })
      else setHot((h) => (h ? null : h))
    }
    const onMove = (e) => {
      last = e
      if (!raf) raf = requestAnimationFrame(compute)
    }
    const onLeave = () => setHot(null)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  const leftOpen = left
  const rightOpen = right
  return (
    <div ref={ref} className="edge-toggles">
      <button
        className={`edge-toggle left ${hot?.side === 'left' ? 'show' : ''}`}
        style={{ left: pos.current.left.x + 6, top: pos.current.left.y }}
        title={leftOpen ? 'Close sidebar (Ctrl/⌘ \\)' : 'Open sidebar (Ctrl/⌘ \\)'}
        aria-label={leftOpen ? 'Close sidebar' : 'Open sidebar'}
        tabIndex={-1}
        onClick={() => {
          useLayout.getState().toggleLeft()
          setHot(null)
        }}
      >
        {leftOpen ? <ChevronLeft /> : <ChevronRight />}
      </button>
      <button
        className={`edge-toggle right ${hot?.side === 'right' ? 'show' : ''}`}
        style={{ left: pos.current.right.x - 6, top: pos.current.right.y }}
        title={rightOpen ? 'Close right panel (Ctrl/⌘ Shift \\)' : 'Open right panel (Ctrl/⌘ Shift \\)'}
        aria-label={rightOpen ? 'Close right panel' : 'Open right panel'}
        tabIndex={-1}
        onClick={() => {
          useLayout.getState().toggleRight()
          setHot(null)
        }}
      >
        {rightOpen ? <ChevronRight /> : <ChevronLeft />}
      </button>
    </div>
  )
}
