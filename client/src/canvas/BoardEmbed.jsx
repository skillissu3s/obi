import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Shapes, Pencil, Maximize2, AlertTriangle, Check } from 'lucide-react'
import { boardToSvg } from '@shared/boardsvg.js'
import { conn } from '../lib/socket.js'
import { api } from '../lib/api.js'
import * as A from '../lib/actions.js'
import { BoardCanvas } from './BoardCanvas.jsx'

function useLiveBoard(ws, path) {
  const [handle, setHandle] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!ws || !path) return
    const h = conn.openDoc(ws, path)
    setHandle(h)
    let raf = 0
    const bump = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setTick((n) => n + 1)
      })
    }
    const offs = ['change', 'status', 'role', 'reset', 'synced'].map((t) => h.on(t, bump))
    return () => {
      cancelAnimationFrame(raf)
      offs.forEach((o) => o())
      conn.releaseDoc(h)
    }
  }, [ws, path])
  return [handle, tick]
}

export function BoardEmbed({ ws, path, label, height = 420, onExit }) {
  const [handle, tick] = useLiveBoard(ws, path)
  const [editing, setEditing] = useState(false)
  const [svg, setSvg] = useState(null)
  const ready = handle?.status === 'ready'
  const canEdit = ready && handle.role !== 'viewer'

  useEffect(() => {
    if (!ready || editing) return
    const t = setTimeout(() => {
      const { svg: out, empty } = boardToSvg(handle.elements, { fileUrl: (p) => api.fileUrl(ws, p), maxHeight: height - 40 })
      setSvg(empty ? '' : out)
    }, 60)
    return () => clearTimeout(t)
  }, [ready, tick, editing, handle, ws, height])

  const done = () => {
    setEditing(false)
    onExit?.()
  }

  let body
  if (!handle || handle.status === 'loading') body = <div className="board-embed-preview"><span className="spinner sm" /></div>
  else if (handle.status !== 'ready')
    body = (
      <div className="board-embed-preview board-embed-empty">
        <AlertTriangle size={14} /> {handle.status === 'missing' || handle.status === 'deleted' ? 'Whiteboard not found' : handle.error || 'Could not load whiteboard'}
      </div>
    )
  else if (editing)
    body = (
      <div className="board-embed-live" style={{ height }}>
        <BoardCanvas handle={handle} ws={ws} path={path} embedded onDone={done} />
      </div>
    )
  else
    body = (
      <div
        className="board-embed-preview"
        style={{ maxHeight: height }}
        title={canEdit ? 'Double-click to draw here' : undefined}
        onDoubleClick={() => canEdit && setEditing(true)}
      >
        {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="board-embed-empty">{canEdit ? 'Empty whiteboard — double-click to start drawing' : 'Empty whiteboard'}</div>}
      </div>
    )

  return (
    <div
      className={`board-embed ${editing ? 'editing' : ''}`}
      // clicks here must not move the note's text selection (that would swap the embed for its source)
      onMouseDown={(e) => {
        if (!e.target.closest('input, textarea, select')) e.preventDefault()
      }}
    >
      {!editing && (
        <div className="board-embed-title">
          <Shapes /> {label}
        </div>
      )}
      <div className="board-embed-bar">
        {!editing && canEdit && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit here
          </button>
        )}
        <button className="btn btn-sm" title="Open as a full whiteboard" onClick={(e) => A.openPath(ws, path, { newTab: e.metaKey || e.ctrlKey })}>
          <Maximize2 /> Open
        </button>
        {editing && (
          <button className="btn btn-sm btn-primary" title="Back to the note (Esc)" onClick={done}>
            <Check /> Done
          </button>
        )}
      </div>
      {body}
    </div>
  )
}

// Mount into a plain DOM node (CodeMirror widgets, reading view).
export function mountBoardEmbed(node, props) {
  const root = createRoot(node)
  root.render(<BoardEmbed {...props} />)
  return () => {
    // unmount outside React's render cycle
    setTimeout(() => root.unmount(), 0)
  }
}
