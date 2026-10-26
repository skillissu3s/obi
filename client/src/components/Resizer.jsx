import { useRef, useState } from 'react'

/**
 * The edge a side panel is dragged wider or narrower by. While dragging, the
 * panel's width is set straight on it, once a frame, with its open/close slide
 * switched off — nothing re-renders and nothing eases behind the pointer — and
 * the width is kept (onCommit) when the pointer lets go.
 * `side`: which side of the window the panel is on ('left' or 'right').
 */
export function Resizer({ panelRef, side, min, max, onCommit }) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const widthAt = (x) => {
    const r = drag.current.rect
    return Math.round(Math.max(min, Math.min(max, side === 'left' ? x - r.left : r.right - x)))
  }
  return (
    <div
      className={`resizer ${dragging ? 'dragging' : ''}`}
      onPointerDown={(e) => {
        const panel = panelRef.current
        if (!panel || e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { rect: panel.getBoundingClientRect(), x: e.clientX, raf: 0, width: null }
        panel.classList.add('resizing')
        document.body.classList.add('is-resizing')
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.x = e.clientX
        if (d.raf) return
        d.raf = requestAnimationFrame(() => {
          d.raf = 0
          if (drag.current !== d || !panelRef.current) return
          d.width = widthAt(d.x)
          panelRef.current.style.width = `${d.width}px`
        })
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        cancelAnimationFrame(d.raf)
        const width = widthAt(e.clientX)
        drag.current = null
        if (panelRef.current) {
          panelRef.current.style.width = `${width}px`
          panelRef.current.classList.remove('resizing')
        }
        document.body.classList.remove('is-resizing')
        setDragging(false)
        onCommit(width)
      }}
      onPointerCancel={() => {
        const d = drag.current
        if (!d) return
        cancelAnimationFrame(d.raf)
        drag.current = null
        panelRef.current?.classList.remove('resizing')
        document.body.classList.remove('is-resizing')
        setDragging(false)
        if (d.width) onCommit(d.width)
      }}
    />
  )
}
