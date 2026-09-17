import { useEffect, useState } from 'react'
import {
  ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2, Copy, Link2, FolderInput, SplitSquareHorizontal, AlertTriangle,
  FileWarning, WifiOff, Star, Download, Image as ImageIcon, Shapes, Eye,
} from 'lucide-react'
import { conn } from '../lib/socket.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { useUI } from '../store/ui.js'
import { AvatarStack, Spinner, menuFromElement } from './ui.jsx'
import { BoardCanvas, exportBoard } from '../canvas/BoardCanvas.jsx'
import { basename, stripExt, joinPath } from '@shared/paths.js'
import { renameEntry, deleteEntry, duplicateFile, toggleBookmark, isBookmarked, copyNoteLink } from '../lib/actions.js'

function useHandle(ws, path, enabled) {
  const [handle, setHandle] = useState(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (!ws || !path || !enabled) {
      setHandle(null)
      return
    }
    const h = conn.openDoc(ws, path)
    setHandle(h)
    const rerender = () => force((n) => n + 1)
    const offs = ['status', 'role', 'reset', 'synced', 'offline'].map((t) => h.on(t, rerender))
    const offMoved = h.on('moved', (to) => useLayout.getState().renamePaths(ws, path, to))
    return () => {
      offs.forEach((o) => o())
      offMoved()
      conn.releaseDoc(h)
    }
  }, [ws, path, enabled])
  return handle
}

export function BoardView({ tab, paneId, active }) {
  const creating = useApp((s) => s.pending[`${tab.ws}:${tab.path}`]) === 'creating'
  const handle = useHandle(tab.ws, tab.path, !creating)
  const presence = useApp((s) => s.presence)
  const user = useApp((s) => s.user)
  const wsId = useApp((s) => s.wsId)
  const connection = useApp((s) => s.connection)
  const foreign = tab.ws !== wsId
  const viewers = (presence[tab.path] || []).filter((u) => u.id !== user?.id)
  const crumbs = tab.path.split('/')
  const readOnly = handle?.role === 'viewer'

  useEffect(() => {
    if (active) document.title = `${stripExt(basename(tab.path))} · Obi`
  }, [active, tab.path])

  const menu = (e) => {
    const bookmarked = isBookmarked(tab.path, tab.ws)
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Open to the right', icon: SplitSquareHorizontal, run: () => useLayout.getState().splitRight(tab) },
      { label: bookmarked ? 'Remove bookmark' : 'Bookmark', icon: Star, run: () => toggleBookmark(tab.path, tab.ws) },
      { label: 'Copy link', icon: Link2, run: () => copyNoteLink(tab.ws, tab.path) },
      { label: 'Copy embed code', icon: Copy, run: () => navigator.clipboard?.writeText(`![[${basename(tab.path)}]]`) },
      'divider',
      handle?.status === 'ready' && { label: 'Export as PNG', icon: ImageIcon, run: () => exportBoard(ctlFor(handle), tab.ws, tab.path, 'png') },
      handle?.status === 'ready' && { label: 'Export as SVG', icon: Download, run: () => exportBoard(ctlFor(handle), tab.ws, tab.path, 'svg') },
      !foreign && 'divider',
      !foreign && { label: 'Move to folder…', icon: FolderInput, run: () => useUI.getState().openModal('move', { path: tab.path }) },
      !foreign && { label: 'Duplicate', icon: Copy, run: () => duplicateFile(tab.path) },
      !foreign && { label: 'Rename…', icon: Pencil, run: () => renameEntry(tab.path) },
      !foreign && { label: 'Delete whiteboard', icon: Trash2, danger: true, run: () => deleteEntry(tab.path) },
    ])
  }

  let body
  if (creating || !handle || handle.status === 'loading') {
    body = (
      <div className="ws-status-panel">
        <Spinner />
        <p>{creating ? 'Creating whiteboard…' : 'Opening whiteboard…'}</p>
      </div>
    )
  } else if (handle.status === 'missing' || handle.status === 'deleted') {
    body = (
      <div className="ws-status-panel">
        <FileWarning style={{ width: 30, height: 30, color: 'var(--text-3)' }} />
        <h3>{handle.status === 'deleted' ? 'This whiteboard was deleted' : 'Whiteboard not found'}</h3>
        <p>{tab.path}</p>
        <button className="btn" onClick={() => useLayout.getState().closeTab(paneId, tab.id)}>
          Close tab
        </button>
      </div>
    )
  } else if (handle.status === 'error') {
    body = (
      <div className="ws-status-panel">
        <AlertTriangle style={{ width: 30, height: 30, color: 'var(--warning)' }} />
        <h3>Could not open this whiteboard</h3>
        <p>{handle.error}</p>
      </div>
    )
  } else {
    body = <BoardCanvas key={`${handle.key}:${handle.generation}`} handle={handle} ws={tab.ws} path={tab.path} />
  }

  return (
    <div className="board-view">
      <div className="note-header">
        <button className="icon-btn" disabled={!tab.back?.length} onClick={() => useLayout.getState().navigate(tab.id, -1)} title="Back">
          <ChevronLeft />
        </button>
        <button className="icon-btn" disabled={!tab.fwd?.length} onClick={() => useLayout.getState().navigate(tab.id, 1)} title="Forward">
          <ChevronRight />
        </button>
        <div className="crumbs">
          <Shapes size={13} style={{ flexShrink: 0, marginRight: 3, color: 'var(--accent)' }} />
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <span className="sep">/</span>}
              <span
                className={`crumb ${i === crumbs.length - 1 ? 'current' : ''}`}
                onClick={() => {
                  if (i === crumbs.length - 1) return !foreign && renameEntry(tab.path)
                  useApp.getState().revealPath(joinPath(crumbs.slice(0, i + 1).join('/'), 'x'))
                  useLayout.getState().setLeftTab('files')
                }}
              >
                {i === crumbs.length - 1 ? stripExt(c) : c}
              </span>
            </span>
          ))}
        </div>
        {viewers.length > 0 && <AvatarStack users={viewers} size={22} />}
        {readOnly && (
          <span className="badge">
            <Eye /> View only
          </span>
        )}
        {handle?.status === 'ready' && connection !== 'online' && (
          <span className="badge warning" title="Changes are kept locally and will sync when you reconnect">
            <WifiOff /> Offline
          </span>
        )}
        <button className="icon-btn" title="More" onClick={menu}>
          <MoreHorizontal />
        </button>
      </div>
      <div className="board-stage">{body}</div>
    </div>
  )
}

// A throwaway controller-like object for exporting from the header menu.
function ctlFor(handle) {
  return {
    store: {
      getSnapshot: () => ({ list: handle.elements.sort((a, b) => (a.z || 0) - (b.z || 0)) }),
    },
  }
}
