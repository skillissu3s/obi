import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, MoreHorizontal, Eye, Pencil, Code2, LayoutGrid, Share2, History, Star, Trash2, Copy, Link2,
  FolderInput, SplitSquareHorizontal, Info, Globe, AlertTriangle, FileWarning, Wifi, WifiOff, Bold, Italic, List, ListChecks,
  Heading1, Heading2, Quote, Link as LinkIcon, Image as ImageIcon, Undo2, Redo2, IndentIncrease, IndentDecrease, Hash, FileText,
} from 'lucide-react'
import { conn } from '../lib/socket.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { useUI, toast } from '../store/ui.js'
import { Editor } from './Editor.jsx'
import { Reader } from './Reader.jsx'
import { Board } from './Board.jsx'
import { AvatarStack, menuFromElement } from './ui.jsx'
import { isBoardContent } from '../lib/kanban.js'
import { basename, dirname, stripExt, joinPath, isNote } from '@shared/paths.js'
import { renameEntry, deleteEntry, duplicateNote, toggleBookmark, isBookmarked, copyNoteLink, openPath, uploadFiles, moveEntry } from '../lib/actions.js'
import { api } from '../lib/api.js'
import { setActiveEditorView } from '../lib/commands.js'
import { slugify } from '@shared/markdown.js'

export function useDocHandle(ws, path) {
  const [handle, setHandle] = useState(null)
  useEffect(() => {
    if (!ws || !path) return
    const h = conn.openDoc(ws, path)
    setHandle(h)
    return () => conn.releaseDoc(h)
  }, [ws, path])
  return handle
}

function useHandleState(handle) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!handle) return
    const rerender = () => force((n) => n + 1)
    const offs = [handle.on('status', rerender), handle.on('role', rerender), handle.on('reset', rerender), handle.on('offline', rerender), handle.on('synced', rerender)]
    return () => offs.forEach((o) => o())
  }, [handle])
  return handle
}

export function NoteView({ tab, paneId, active }) {
  const handle = useDocHandle(tab.ws, tab.path)
  useHandleState(handle)
  const prefs = usePrefs()
  const layout = useLayout()
  const presence = useApp((s) => s.presence)
  const user = useApp((s) => s.user)
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const version = useApp((s) => s.version)
  const [stats, setStats] = useState(null)
  const [view, setView] = useState(null)
  const [heading, setHeading] = useState(null)
  const scrollRef = useRef(null)
  const ws = workspaces.find((w) => w.id === tab.ws)
  const foreign = tab.ws !== wsId

  const content = handle?.status === 'ready' ? handle.ytext.toString() : ''
  const isBoard = useMemo(() => (handle?.status === 'ready' ? isBoardContent(content.slice(0, 400)) : false), [handle?.status, content.slice(0, 400)])
  const mode = tab.mode || (isBoard ? 'board' : prefs.defaultMode)
  const readOnly = handle?.role === 'viewer'

  // register the focused editor for global commands
  useEffect(() => {
    if (active && view) setActiveEditorView(view)
  }, [active, view])

  // doc lifecycle events
  useEffect(() => {
    if (!handle) return
    const offMoved = handle.on('moved', (to) => {
      useLayout.getState().renamePaths(handle.ws, handle.path, to)
    })
    return offMoved
  }, [handle])

  // heading scroll requests
  useEffect(() => {
    if (!active) return
    const onScrollTo = (e) => {
      const sub = e.detail?.subpath
      if (!sub) return
      setHeading(sub)
      setTimeout(() => setHeading(null), 800)
      if (mode === 'read' && scrollRef.current) {
        const el = scrollRef.current.querySelector(`#${CSS.escape(slugify(sub.replace(/^#+/, '')))}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    window.addEventListener('obi:scroll-to', onScrollTo)
    return () => window.removeEventListener('obi:scroll-to', onScrollTo)
  }, [active, mode])

  const setMode = (m) => useLayout.getState().updateTab(tab.id, { mode: m })

  const viewers = (presence[tab.path] || []).filter((u) => u.id !== user?.id)

  const noteMenu = (e) => {
    const bookmarked = isBookmarked(tab.path, tab.ws)
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Open to the right', icon: SplitSquareHorizontal, run: () => useLayout.getState().splitRight(tab) },
      { label: bookmarked ? 'Remove bookmark' : 'Bookmark', icon: Star, run: () => toggleBookmark(tab.path, tab.ws) },
      { label: 'Copy link to note', icon: Link2, run: () => copyNoteLink(tab.ws, tab.path) },
      { label: 'Copy note path', icon: Copy, run: () => navigator.clipboard?.writeText(tab.path) },
      'divider',
      { label: 'Version history', icon: History, run: () => useUI.getState().openModal('history', { ws: tab.ws, path: tab.path }) },
      { label: 'Share & publish', icon: Share2, run: () => useUI.getState().openModal('share', { ws: tab.ws, path: tab.path }) },
      isBoard && { label: mode === 'board' ? 'Open as markdown' : 'Open as board', icon: LayoutGrid, run: () => setMode(mode === 'board' ? 'live' : 'board') },
      !foreign && { label: 'Move to folder…', icon: FolderInput, run: () => useUI.getState().openModal('move', { path: tab.path }) },
      !foreign && { label: 'Duplicate', icon: Copy, run: () => duplicateNote(tab.path) },
      !foreign && 'divider',
      !foreign && { label: 'Rename…', icon: Pencil, run: () => renameEntry(tab.path) },
      !foreign && { label: 'Delete note', icon: Trash2, danger: true, run: () => deleteEntry(tab.path) },
    ])
  }

  const crumbs = tab.path.split('/')
  const title = stripExt(basename(tab.path))

  const body = () => {
    if (!handle) return null
    if (handle.status === 'loading')
      return (
        <div className="note-loading">
          <div className="skeleton" style={{ height: 34, width: '45%' }} />
          <div className="skeleton" style={{ height: 14, width: '90%' }} />
          <div className="skeleton" style={{ height: 14, width: '80%' }} />
          <div className="skeleton" style={{ height: 14, width: '85%' }} />
        </div>
      )
    if (handle.status === 'missing' || handle.status === 'deleted')
      return (
        <div className="ws-status-panel">
          <FileWarning style={{ width: 30, height: 30, color: 'var(--text-3)' }} />
          <h3>{handle.status === 'deleted' ? 'This note was deleted' : 'Note not found'}</h3>
          <p>{tab.path}</p>
          <button className="btn" onClick={() => useLayout.getState().closeTab(paneId, tab.id)}>
            Close tab
          </button>
        </div>
      )
    if (handle.status === 'error')
      return (
        <div className="ws-status-panel">
          <AlertTriangle style={{ width: 30, height: 30, color: 'var(--warning)' }} />
          <h3>Could not open this note</h3>
          <p>{handle.error}</p>
        </div>
      )
    if (mode === 'board') return <Board handle={handle} readOnly={readOnly} />
    return (
      <div className={`note-inner ${prefs.readableWidth ? '' : 'full'}`}>
        {prefs.inlineTitle && <InlineTitle tab={tab} title={title} readOnly={readOnly || foreign} view={view} />}
        {readOnly && (
          <div className="note-banner">
            <Eye /> You have view-only access to this note.
          </div>
        )}
        {mode === 'read' ? (
          <Reader handle={handle} onStats={setStats} readOnly={readOnly} />
        ) : (
          <Editor
            handle={handle}
            tabId={tab.id}
            mode={mode}
            readOnly={readOnly}
            onStats={setStats}
            onViewReady={setView}
            line={tab.line}
            heading={heading}
            key={`${handle.key}:${handle.generation}`}
          />
        )}
      </div>
    )
  }

  useEffect(() => {
    if (active && stats) window.dispatchEvent(new CustomEvent('obi:stats', { detail: stats }))
  }, [active, stats])

  return (
    <div className={`note-view ${prefs.readableWidth ? 'readable' : ''} ${prefs.strikeDone ? 'strike-done' : ''}`}>
      <div className="note-header">
        <button className="icon-btn" disabled={!tab.back?.length} onClick={() => useLayout.getState().navigate(tab.id, -1)} title="Back">
          <ChevronLeft />
        </button>
        <button className="icon-btn" disabled={!tab.fwd?.length} onClick={() => useLayout.getState().navigate(tab.id, 1)} title="Forward">
          <ChevronRight />
        </button>
        <div className="crumbs">
          {foreign && ws && (
            <span className="crumb foreign">
              <Share2 size={11} /> {ws.name}
              <span className="sep">/</span>
            </span>
          )}
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <span className="sep">/</span>}
              <span
                className={`crumb ${i === crumbs.length - 1 ? 'current' : ''}`}
                onClick={() => {
                  if (i === crumbs.length - 1) return
                  const folder = crumbs.slice(0, i + 1).join('/')
                  useApp.getState().revealPath(joinPath(folder, 'x'))
                  useLayout.getState().setLeftTab('files')
                }}
              >
                {i === crumbs.length - 1 ? stripExt(c) : c}
              </span>
            </span>
          ))}
        </div>
        {viewers.length > 0 && <AvatarStack users={viewers} size={22} />}
        {handle?.status === 'ready' && conn.state !== 'online' && (
          <span className="badge warning" title="Changes are kept locally and will sync when you reconnect">
            <WifiOff /> Offline
          </span>
        )}
        <div className="segmented">
          <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')} title="Live preview (Ctrl/⌘ E)">
            <Pencil />
          </button>
          <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')} title="Markdown source">
            <Code2 />
          </button>
          <button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')} title="Reading view (Ctrl/⌘ E)">
            <Eye />
          </button>
          {isBoard && (
            <button className={mode === 'board' ? 'active' : ''} onClick={() => setMode('board')} title="Board view">
              <LayoutGrid />
            </button>
          )}
        </div>
        {ws?.type === 'online' && (
          <button className="icon-btn" title="Share" onClick={() => useUI.getState().openModal('share', { ws: tab.ws, path: tab.path })}>
            <Share2 />
          </button>
        )}
        <button className="icon-btn" title="More" onClick={noteMenu}>
          <MoreHorizontal />
        </button>
      </div>
      <div className="note-scroll" ref={scrollRef}>
        {body()}
      </div>
      {view && !readOnly && mode !== 'read' && mode !== 'board' && <MobileToolbar view={view} handle={handle} />}
    </div>
  )
}

function InlineTitle({ tab, title, readOnly, view }) {
  const ref = useRef(null)
  const [value, setValue] = useState(title)
  useEffect(() => setValue(title), [title, tab.path])
  useEffect(() => {
    if (tab.focusTitle && ref.current) {
      ref.current.focus()
      ref.current.select()
      useLayout.getState().updateTab(tab.id, { focusTitle: false })
    }
  }, [tab.focusTitle, tab.id])

  const commit = async () => {
    const clean = value.trim()
    if (!clean || clean === title) {
      setValue(title)
      return
    }
    const target = joinPath(dirname(tab.path), `${clean.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()}.md`)
    try {
      await api.move(tab.ws, tab.path, target)
      useLayout.getState().renamePaths(tab.ws, tab.path, target)
      useApp.getState().refreshTree()
    } catch (e) {
      toast.error(e)
      setValue(title)
    }
  }

  return (
    <input
      ref={ref}
      className="inline-title"
      value={value}
      readOnly={readOnly}
      placeholder="Untitled"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          view?.focus()
        }
        if (e.key === 'Escape') setValue(title)
        if (e.key === 'ArrowDown' && e.target.selectionStart === value.length) view?.focus()
      }}
    />
  )
}

function MobileToolbar({ view, handle }) {
  const run = (fn) => (e) => {
    e.preventDefault()
    fn()
    view.focus()
  }
  const insert = (text, back = 0) => () => {
    const sel = view.state.selection.main
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length - back } })
  }
  const cmd = (id) => () => window.dispatchEvent(new CustomEvent('obi:command', { detail: { id } }))
  return (
    <div className="mobile-toolbar">
      <button className="icon-btn" onMouseDown={run(cmd('undo'))} title="Undo">
        <Undo2 />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('redo'))} title="Redo">
        <Redo2 />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('toggle-task'))} title="Checkbox">
        <ListChecks />
      </button>
      <button className="icon-btn" onMouseDown={run(insert('- '))} title="List">
        <List />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('bold'))} title="Bold">
        <Bold />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('italic'))} title="Italic">
        <Italic />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('h1'))} title="Heading 1">
        <Heading1 />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('h2'))} title="Heading 2">
        <Heading2 />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('quote'))} title="Quote">
        <Quote />
      </button>
      <button className="icon-btn" onMouseDown={run(insert('[[]]', 2))} title="Link note">
        <FileText />
      </button>
      <button className="icon-btn" onMouseDown={run(insert('#'))} title="Tag">
        <Hash />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('link'))} title="Link">
        <LinkIcon />
      </button>
      <button
        className="icon-btn"
        title="Insert image"
        onMouseDown={(e) => {
          e.preventDefault()
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.multiple = true
          input.onchange = async () => {
            const paths = await uploadFiles([...input.files])
            const text = paths.map((p) => `![[${basename(p)}]]`).join('\n')
            const sel = view.state.selection.main
            view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } })
          }
          input.click()
        }}
      >
        <ImageIcon />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('outdent'))} title="Outdent">
        <IndentDecrease />
      </button>
      <button className="icon-btn" onMouseDown={run(cmd('indent'))} title="Indent">
        <IndentIncrease />
      </button>
    </div>
  )
}
