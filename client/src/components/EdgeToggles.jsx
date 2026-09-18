import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayout } from '../store/layout.js'

const NEAR = 40 // px from the edge that counts as "reaching for the sidebar"
const TOP_GAP = 62 // leave the note's own header buttons alone
const BOTTOM_GAP = 48 // and the status bar

// A toggle for the left sidebar that shows up under the pointer when it comes
// near the edge, and tracks it while it stays there. The right panel has its
// own visible close button, so it doesn't get one of these.
export function EdgeToggles() {
  const left = useLayout((s) => s.left)
  const ref = useRef(null)
  const [hot, setHot] = useState(null) // { x, y } within the app body

  useEffect(() => {
    let raf = 0
    let last = null
    const compute = () => {
      raf = 0
      const host = ref.current?.parentElement
      if (!host || !last) return
      const body = host.getBoundingClientRect()
      const { clientX: x, clientY: y } = last
      if (last.buttons) return setHot(null) // not while dragging something
      const inBody = y >= body.top + TOP_GAP && y <= body.bottom - BOTTOM_GAP && x >= body.left && x <= body.right
      if (!inBody) return setHot(null)
      const panel = host.querySelector(':scope > .sidebar.left:not(.is-closed)') || host.querySelector(':scope > .ribbon:not(.is-closed)')
      const edge = panel ? panel.getBoundingClientRect().right : body.left
      // only on the content side of the edge, so the panel keeps its own hover space
      if (x >= edge - 6 && x - edge < NEAR) setHot({ x: edge - body.left, y: y - body.top })
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

  return (
    <div ref={ref} className="edge-toggles">
      {hot && (
        <button
          className="edge-toggle left show"
          style={{ left: hot.x + 6, top: hot.y }}
          title={left ? 'Close sidebar (Ctrl/⌘ \\)' : 'Open sidebar (Ctrl/⌘ \\)'}
          aria-label={left ? 'Close sidebar' : 'Open sidebar'}
          tabIndex={-1}
          onClick={() => {
            useLayout.getState().toggleLeft()
            setHot(null)
          }}
        >
          {left ? <ChevronLeft /> : <ChevronRight />}
        </button>
      )}
    </div>
  )
}
