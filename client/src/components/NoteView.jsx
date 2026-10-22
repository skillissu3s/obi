import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, MoreHorizontal, Eye, Pencil, Code2, LayoutGrid, Share2, History, Star, Trash2, Copy, Link2,
  FolderInput, SplitSquareHorizontal, Info, Globe, AlertTriangle, FileWarning, Wifi, WifiOff, Bold, Italic, List, ListChecks,
  Heading1, Heading2, Quote, Link as LinkIcon, Image as ImageIcon, Undo2, Redo2, IndentIncrease, IndentDecrease, Hash, FileText,
  ChevronDown, Printer, Download, PanelRight, BookmarkCheck, BookmarkPlus, BookmarkX, CornerDownRight, X,
} from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { conn } from '../lib/socket.js'
import { placeLine, plainLine, savePlace, usePlace } from '../lib/places.js'
import { setPlace } from '../editor/place.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { useUI, toast } from '../store/ui.js'
import { useNoteZoom } from '../store/zoom.js'
import { Editor } from './Editor.jsx'
import { Reader } from './Reader.jsx'
import { ProjectBoard } from './ProjectBoard.jsx'
import { NoteCanvas } from '../canvas/NoteCanvas.jsx'
import { menuFromElement } from './ui.jsx'
import { PeopleButton, OffscreenCursors } from './People.jsx'
import { useCollaborators } from '../lib/collab.js'
import { isBoardContent } from '../lib/kanban.js'
import { basename, dirname, stripExt, joinPath, isNote } from '@shared/paths.js'
import { renameEntry, deleteEntry, duplicateNote, toggleBookmark, isBookmarked, copyNoteLink, openPath, uploadFiles, moveEntry, moveTo } from '../lib/actions.js'
import { api } from '../lib/api.js'
import { setActiveEditorView } from '../lib/commands.js'
import { slugify } from '@shared/markdown.js'
import { plainSnippet, downloadBlob } from '../lib/util.js'

export function useDocHandle(ws, path, enabled = true) {
  const [handle, setHandle] = useState(null)
  useEffect(() => {
    if (!ws || !path || !enabled) {
      setHandle(null)
      return
    }
    const h = conn.openDoc(ws, path)
    setHandle(h)
    return () => conn.releaseDoc(h)
  }, [ws, path, enabled])
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

// Zooms a note by scaling it whole, text and canvas together, without changing
// how it lays out: its lines wrap exactly where they do at 100%, so the
// drawings pinned to them stay where they were put. A transform leaves the
// layout size alone, so the margin stands in for the height the scaled note
// takes up and the page scrolls to the right length. `reflow` (reading view of a
// note with no drawings to keep in place) lets the text re-wrap to the room there
// is instead, as browser zoom does: the note is laid out as wide as the pane is
// at this zoom and scaled from its left edge, so it fills the pane exactly. (Laid
// out wider than the pane and scaled about its middle, a zoomed-out note slid
// off to the right.)
function ZoomFrame({ zoom, reflow, children }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ height: 0, room: 0, column: 0 }) // layout px: the note, the pane it scrolls in, the column inside it
  useLayoutEffect(() => {
    const el = ref.current
    const scroller = el?.closest('.note-scroll')
    if (!el || !scroller) return undefined
    const measure = () => setSize({ height: el.offsetHeight, room: scroller.clientWidth, column: el.firstElementChild?.offsetWidth || 0 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [])
  const { height, room, column } = size
  // scaled about its middle, a column wider than the pane overflows both edges, and
  // the left one can't be scrolled to: start it at the left edge instead
  const shift = Math.max(0, (column * zoom - room) / 2)

  // keep the same part of the page under the pointer (or in the middle)
  const prev = useRef(zoom)
  useLayoutEffect(() => {
    const k = zoom / prev.current
    prev.current = zoom
    const scroller = ref.current?.closest('.note-scroll')
    if (!scroller || k === 1) return
    const at = useNoteZoom.getState().anchorY ?? scroller.clientHeight / 2
    scroller.scrollTop = (scroller.scrollTop + at) * k - at
  }, [zoom])

  const style =
    zoom === 1
      ? undefined
      : reflow
        ? { width: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: '0 0', marginBottom: (zoom - 1) * height }
        : { transform: `translateX(${shift}px) scale(${zoom})`, transformOrigin: '50% 0', marginBottom: (zoom - 1) * height }
  return (
    <div className="note-zoom" ref={ref} style={style}>
      {children}
    </div>
  )
}

// How many drawings a note's canvas has (null until its layer has loaded): the
// reading view of a note with drawings shows them, over the note laid out as it is
// for editing, so they stay on the lines they were pinned to
function useDrawingCount(ws, path, enabled) {
  const [count, setCount] = useState(null)
  useEffect(() => {
    if (!enabled || !ws || !path) return setCount(null)
    const h = conn.openDoc(ws, path, 'layer')
    const update = () => setCount(h.status === 'loading' ? null : h.status === 'ready' ? h.ymap.size : 0)
    update()
    const offs = ['status', 'change', 'reset', 'synced'].map((t) => h.on(t, update))
    return () => {
      offs.forEach((off) => off())
      conn.releaseDoc(h)
    }
  }, [ws, path, enabled])
  return count
}

// ---- your place in a note, in the rendered reading view (lib/places.js) ----
const READ_BLOCKS = '.markdown :is(p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr)'
const firstWords = (el) => el.innerText.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 60)

// the rendered block that shows source line `n` (found by its words), else the nearest heading before it
function blockForLine(scroller, lines, n) {
  const want = plainLine(lines[n] || '').slice(0, 60)
  if (want) {
    const hit = [...scroller.querySelectorAll(READ_BLOCKS)].find((b) => firstWords(b).startsWith(want) || (want.startsWith(firstWords(b)) && firstWords(b).length > 8))
    if (hit) return hit
  }
  let best = null
  for (const h of scroller.querySelectorAll('.markdown [data-line]')) if (Number(h.dataset.line) <= n && (!best || Number(h.dataset.line) >= Number(best.dataset.line))) best = h
  return best
}

// the source line a rendered block shows (by its words), else its nearest heading's, else -1
function lineForBlock(scroller, el, lines) {
  const text = firstWords(el)
  if (text) {
    const n = lines.findIndex((l) => {
      const p = plainLine(l)
      return p && (p.startsWith(text) || (text.startsWith(p) && p.length > 8))
    })
    if (n >= 0) return n
  }
  let line = -1
  for (const h of scroller.querySelectorAll('.markdown [data-line]')) if (h === el || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) line = Number(h.dataset.line)
  return line
}

export function NoteView({ tab, paneId, active }) {
  // a note we just created isn't on the server yet — wait before joining its document
  const creating = useApp((s) => s.pending[`${tab.ws}:${tab.path}`]) === 'creating'
  const handle = useDocHandle(tab.ws, tab.path, !creating)
  useHandleState(handle)
  const prefs = usePrefs()
  const layout = useLayout()
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const version = useApp((s) => s.version)
  const [stats, setStats] = useState(null)
  const [view, setView] = useState(null)
  const [heading, setHeading] = useState(null)
  const scrollRef = useRef(null)
  // DOM nodes the canvas layer attaches to
  const [scrollEl, setScrollEl] = useState(null)
  const [innerEl, setInnerEl] = useState(null)
  const [originEl, setOriginEl] = useState(null)
  const [stageEl, setStageEl] = useState(null)
  const zoom = useNoteZoom((z) => z.zoom)
  const setScroll = useCallback((el) => {
    scrollRef.current = el
    setScrollEl(el)
  }, [])
  const ws = workspaces.find((w) => w.id === tab.ws)
  const foreign = tab.ws !== wsId

  const content = handle?.status === 'ready' ? handle.ytext.toString() : ''
  const isBoard = useMemo(() => (handle?.status === 'ready' ? isBoardContent(content.slice(0, 400)) : false), [handle?.status, content.slice(0, 400)])
  const mode = tab.mode || (isBoard ? 'board' : prefs.defaultMode)
  const readOnly = handle?.role === 'viewer'
  // Reading view: a note with drawings is shown as it is laid out for editing (read
  // only, the drawings over it, view only), so every drawing stays on its line and
  // a zoom scales the two together; one without is rendered for reading. Printing
  // takes the rendered one (the editor only draws the lines on screen).
  const [printing, setPrinting] = useState(false)
  const drawings = useDrawingCount(tab.ws, tab.path, mode === 'read' && !printing)
  const readingDrawings = mode === 'read' && !printing && drawings > 0
  const rendered = mode === 'read' && !readingDrawings

  // ---- your place (lib/places.js): marked from the header, shown on its line, offered when you come back ----
  const place = usePlace(tab.ws, tab.path)
  const [offer, setOffer] = useState(false)
  const offered = useRef(null)
  const sourceLines = () => (handle?.status === 'ready' ? handle.ytext.toString().split('\n') : [])
  // the line being read now: a little way down from the top of what is on screen
  const lineHere = () => {
    const lines = sourceLines()
    if (!scrollEl || !lines.length) return null
    const box = scrollEl.getBoundingClientRect()
    const y = box.top + Math.min(140, box.height * 0.25)
    if (!rendered && view) {
      const c = view.contentDOM.getBoundingClientRect()
      const line = view.state.doc.lineAt(view.posAtCoords({ x: c.left + 10, y }, false))
      return { line: line.number - 1, text: line.text }
    }
    const el = [...scrollEl.querySelectorAll(READ_BLOCKS)].find((b) => b.getBoundingClientRect().bottom > y)
    const n = Math.max(0, el ? lineForBlock(scrollEl, el, lines) : 0)
    return { line: n, text: lines[n] }
  }
  const markHere = () => {
    const at = lineHere()
    if (!at) return
    savePlace(tab.ws, tab.path, at)
    setOffer(false)
    toast.success(`Place marked at line ${at.line + 1} — it’ll be here next time`)
  }
  const goToPlace = () => {
    setOffer(false)
    if (!place) return
    if (!rendered && view) {
      const n = placeLine(view.state.doc.toString().split('\n'), place)
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(n + 1).from, { y: 'start', yMargin: 90 }) })
    } else if (scrollEl) {
      const el = scrollEl.querySelector('.reading-place')
      if (el) scrollEl.scrollTop += el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - 90
    }
  }
  const placeMenu = (e) => {
    if (!place) return markHere()
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Go to my place', icon: CornerDownRight, run: goToPlace },
      { label: 'Mark here instead', icon: BookmarkPlus, run: markHere },
      { label: 'Remove my place', icon: BookmarkX, danger: true, run: () => savePlace(tab.ws, tab.path, null) },
    ])
  }
  // shown on its line: in the editor…
  useEffect(() => {
    if (!view || rendered) return
    const n = place ? placeLine(view.state.doc.toString().split('\n'), place) : null
    view.dispatch({ effects: setPlace.of(n == null ? null : view.state.doc.line(n + 1).from) })
  }, [view, rendered, place])
  // …and in the rendered reading view (which may draw itself again: it is marked again)
  useEffect(() => {
    if (!rendered || !scrollEl) return undefined
    const apply = () => {
      for (const el of scrollEl.querySelectorAll('.reading-place')) el.classList.remove('reading-place')
      if (!place) return
      const lines = sourceLines()
      const n = placeLine(lines, place)
      if (n != null) blockForLine(scrollEl, lines, n)?.classList.add('reading-place')
    }
    apply()
    const mo = new MutationObserver(() => place && !scrollEl.querySelector('.reading-place') && apply())
    mo.observe(scrollEl, { childList: true, subtree: true })
    return () => mo.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, scrollEl, place, handle])
  // coming back to a note whose place is further on: offer to go there
  useEffect(() => {
    if (!place || !scrollEl || handle?.status !== 'ready' || offered.current === `${tab.ws}:${tab.path}`) return undefined
    offered.current = `${tab.ws}:${tab.path}`
    const t = setTimeout(() => {
      const r = scrollEl.querySelector('.cm-reading-place, .reading-place')?.getBoundingClientRect()
      const box = scrollEl.getBoundingClientRect()
      if (!r || r.top > box.bottom - 40 || r.bottom < box.top) setOffer(true)
    }, 600)
    return () => clearTimeout(t)
  }, [place, scrollEl, handle?.status, tab.ws, tab.path])
  // …which goes once the place is on screen
  useEffect(() => {
    if (!offer || !scrollEl) return undefined
    const seen = () => {
      const r = scrollEl.querySelector('.cm-reading-place, .reading-place')?.getBoundingClientRect()
      const box = scrollEl.getBoundingClientRect()
      if (r && r.top < box.bottom - 40 && r.bottom > box.top) setOffer(false)
    }
    scrollEl.addEventListener('scroll', seen, { passive: true })
    return () => scrollEl.removeEventListener('scroll', seen)
  }, [offer, scrollEl])

  // register the focused editor for global commands
  useEffect(() => {
    if (active && view) setActiveEditorView(view)
  }, [active, view])

  // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives the same way) zooms the
  // note about the pointer
  useEffect(() => {
    if (!scrollEl) return undefined
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !scrollEl.querySelector('.note-zoom')) return
      e.preventDefault()
      const delta = Math.max(-100, Math.min(100, e.deltaY * (e.deltaMode === 1 ? 16 : 1)))
      const { zoom: z, setZoom } = useNoteZoom.getState()
      setZoom(z * Math.exp(-delta * 0.002), e.clientY - scrollEl.getBoundingClientRect().top)
    }
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel)
  }, [scrollEl])

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

  // The note header is hidden on phones, so the mobile header asks for this
  // note's own menu instead of building a second copy of it.
  useEffect(() => {
    if (!active) return
    const onMenu = (e) => noteMenuRef.current?.(e.detail)
    window.addEventListener('obi:note-menu', onMenu)
    return () => window.removeEventListener('obi:note-menu', onMenu)
  }, [active])

  const setMode = (m) => useLayout.getState().updateTab(tab.id, { mode: m })

  const collab = useCollaborators({ path: tab.path, handle, view, foreign })
  const rightOpen = useLayout((st) => st.right)

  const noteMenuRef = useRef(null)
  const noteMenu = (e) => {
    const bookmarked = isBookmarked(tab.path, tab.ws)
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Open to the right', icon: SplitSquareHorizontal, run: () => useLayout.getState().splitRight(tab) },
      { label: bookmarked ? 'Remove bookmark' : 'Bookmark', icon: Star, run: () => toggleBookmark(tab.path, tab.ws) },
      { label: 'Copy link to note', icon: Link2, run: () => copyNoteLink(tab.ws, tab.path) },
      { label: 'Copy note path', icon: Copy, run: () => navigator.clipboard?.writeText(tab.path) },
      'divider',
      { label: 'Version history', icon: History, run: () => useUI.getState().openModal('history', { ws: tab.ws, path: tab.path }) },
      { label: 'Print or save as PDF', icon: Printer, run: printNote },
      { label: 'Download as markdown', icon: Download, run: downloadNote },
      { label: 'Share & publish', icon: Share2, run: () => useUI.getState().openModal('share', { ws: tab.ws, path: tab.path }) },
      isBoard && { label: mode === 'board' ? 'Open as markdown' : 'Open as board', icon: LayoutGrid, run: () => setMode(mode === 'board' ? 'live' : 'board') },
      !foreign && { label: 'Move to folder…', icon: FolderInput, run: () => useUI.getState().openModal('move', { path: tab.path }) },
      !foreign && { label: 'Duplicate', icon: Copy, run: () => duplicateNote(tab.path) },
      !foreign && 'divider',
      !foreign && { label: 'Rename…', icon: Pencil, run: () => renameEntry(tab.path) },
      !foreign && { label: 'Delete note', icon: Trash2, danger: true, run: () => deleteEntry(tab.path) },
    ])
  }
  noteMenuRef.current = noteMenu

  // Printing reads the page, and live preview only renders the lines on screen —
  // so switch to reading view first and let it lay out.
  const printNote = async () => {
    setPrinting(true)
    if (mode !== 'read') setMode('read')
    await new Promise((r) => setTimeout(r, 450))
    window.print()
    setPrinting(false)
  }

  const downloadNote = async () => {
    try {
      const { content } = await api.readNote(tab.ws, tab.path)
      downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), basename(tab.path))
    } catch (e) {
      toast.error(e)
    }
  }

  const crumbs = tab.path.split('/')
  const title = stripExt(basename(tab.path))

  const body = () => {
    if (creating)
      return (
        <div className={`note-inner ${prefs.readableWidth ? '' : 'full'}`}>
          <div className="inline-title" style={{ color: 'var(--text-3)' }}>
            {title}
          </div>
          <div className="note-banner">
            <span className="spinner sm" /> Creating note…
          </div>
        </div>
      )
    // (a reading view waits for the drawings too, to know which kind it is)
    if (!handle || handle.status === 'loading' || (mode === 'read' && !printing && drawings == null))
      // same column, title and line rhythm as the real note, so nothing jumps when it arrives
      return (
        <div className={`note-inner ${prefs.readableWidth ? '' : 'full'}`}>
          {prefs.inlineTitle && <div className="inline-title">{title}</div>}
          <NoteSkeleton />
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
    return (
      <ZoomFrame zoom={zoom} reflow={rendered}>
        <div className={`note-inner ${prefs.readableWidth ? '' : 'full'}`} ref={rendered ? undefined : setInnerEl}>
          {!rendered && <div className="nc-origin" ref={setOriginEl} />}
          {prefs.inlineTitle && <InlineTitle tab={tab} title={title} readOnly={readOnly || foreign} view={view} />}
          {readOnly && (
            <div className="note-banner">
              <Eye /> You have view-only access to this note.
            </div>
          )}
          {rendered ? (
            <Reader handle={handle} onStats={setStats} readOnly={readOnly} />
          ) : (
            <Editor
              handle={handle}
              tabId={tab.id}
              mode={readingDrawings ? 'live' : mode}
              readOnly={readOnly || readingDrawings}
              onStats={setStats}
              onViewReady={setView}
              line={tab.line}
              heading={heading}
              key={`${handle.key}:${handle.generation}`}
            />
          )}
          <LinkedMentions tab={tab} />
        </div>
      </ZoomFrame>
    )
  }

  useEffect(() => {
    if (active && stats) window.dispatchEvent(new CustomEvent('obi:stats', { detail: stats }))
  }, [active, stats])

  return (
    <div className={`note-view ${prefs.readableWidth ? 'readable' : ''} ${prefs.strikeDone ? 'strike-done' : ''}`} ref={setStageEl}>
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
        <PeopleButton collab={collab} />
        {handle?.status === 'ready' && conn.state !== 'online' && (
          <span className="badge warning" title="Changes are kept locally and will sync when you reconnect">
            <WifiOff /> Offline
          </span>
        )}
        {handle?.status === 'ready' && (
          <button
            className={`icon-btn place-btn ${place ? 'on' : ''}`}
            title={place ? `Your place: line ${place.line + 1} — go there, move it, or remove it` : 'Mark my place — pick up here next time'}
            aria-label={place ? 'Your place in this note' : 'Mark my place'}
            onClick={placeMenu}
          >
            {place ? <BookmarkCheck /> : <BookmarkPlus />}
          </button>
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
        {/* Opens the panel from the side it lives on. Once it is open, the
            panel's own close button is the only one, so this steps aside. */}
        {!rightOpen && mode !== 'board' && (
          <button className="icon-btn" title="Open right panel (Ctrl/⌘ Shift \)" onClick={() => useLayout.getState().toggleRight(true)}>
            <PanelRight />
          </button>
        )}
      </div>
      {/* a project (a board note) is a board of its own, which scrolls sideways */}
      {mode === 'board' && isBoard && !creating && handle?.status === 'ready' ? (
        <ProjectBoard
          key={`${handle.key}:${handle.generation}`}
          handle={handle}
          readOnly={readOnly}
          title={title}
          onRename={foreign ? undefined : () => renameEntry(tab.path)}
          onMarkdown={() => setMode('live')}
          onDelete={foreign ? undefined : () => deleteEntry(tab.path)}
        />
      ) : (
        <div className="note-scroll" ref={setScroll} tabIndex={-1}>
          {body()}
        </div>
      )}
      {view && mode !== 'read' && <OffscreenCursors collab={collab} view={view} scrollEl={scrollEl} />}
      {handle?.status === 'ready' && (mode === 'live' || mode === 'source' || readingDrawings) && view && originEl && scrollEl && (
        <NoteCanvas key={`${handle.key}:${handle.generation}`} tab={tab} view={view} scrollEl={scrollEl} innerEl={innerEl} originEl={originEl} stageEl={stageEl} mode={readingDrawings ? 'live' : mode} viewOnly={readingDrawings} />
      )}
      {view && !readOnly && mode !== 'read' && mode !== 'board' && <MobileToolbar view={view} handle={handle} />}
      {offer && place && (
        <div className="place-offer" role="status">
          <button type="button" className="place-offer-go" onClick={goToPlace}>
            <BookmarkCheck /> Continue where you left off
          </button>
          <button type="button" className="icon-btn sm" aria-label="Dismiss" title="Dismiss" onClick={() => setOffer(false)}>
            <X />
          </button>
        </div>
      )}
    </div>
  )
}

// Notes that point here, tucked under the note itself (collapsed until you want them).
function LinkedMentions({ tab }) {
  const version = useApp((s) => s.version)
  const wsId = useApp((s) => s.wsId)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(() => localStorage.getItem('obi:mentionsOpen') === '1')
  useEffect(() => {
    if (tab.ws !== wsId) return
    let alive = true
    const t = setTimeout(() => {
      api
        .backlinks(tab.ws, tab.path)
        .then((r) => alive && setData(r))
        .catch(() => {})
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [tab.ws, tab.path, wsId, version])

  const linked = data?.linked || []
  if (!linked.length) return null
  const total = linked.reduce((n, l) => n + l.hits.length, 0)
  return (
    <div className={`note-mentions ${open ? 'open' : ''}`}>
      <button
        className="nm-head"
        onClick={() => {
          setOpen(!open)
          localStorage.setItem('obi:mentionsOpen', open ? '0' : '1')
        }}
      >
        <ChevronDown className="nm-chev" />
        <Link2 />
        <span>
          {total} linked mention{total === 1 ? '' : 's'}
        </span>
        <span className="nm-count">
          in {linked.length} note{linked.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="nm-list">
          {linked.map((l) => (
            <div key={l.path} className="nm-note">
              <button className="nm-title" onClick={(e) => useLayout.getState().openNote(tab.ws, l.path, { newTab: e.metaKey || e.ctrlKey })}>
                <FileText />
                <span className="truncate">{stripExt(basename(l.path))}</span>
                {dirname(l.path) && <span className="nm-folder truncate">{dirname(l.path)}</span>}
              </button>
              {l.hits.slice(0, 3).map((h, i) => (
                <button key={i} className="nm-hit" onClick={() => useLayout.getState().openNote(tab.ws, l.path, { line: h.line })}>
                  {plainSnippet(h.text)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const SKELETON_LINES = [94, 88, 91, 52, null, 36, 90, 84, 68, null, 80, 74]

export function NoteSkeleton() {
  return (
    <div className="note-skeleton" aria-busy="true" aria-label="Loading note">
      {SKELETON_LINES.map((w, i) => (w == null ? <div key={i} className="note-skeleton-gap" /> : <div key={i} className="note-skeleton-line"><span className="skeleton" style={{ width: `${w}%` }} /></div>))}
    </div>
  )
}

function InlineTitle({ tab, title, readOnly, view }) {
  const ref = useRef(null)
  const [value, setValue] = useState(title)
  const renaming = useApp((s) => s.pending[`${tab.ws}:${tab.path}`]) === 'renaming'
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
    const moved = await moveTo(tab.path, target)
    if (!moved) setValue(title)
  }

  return (
    <input
      ref={ref}
      className="inline-title"
      value={value}
      readOnly={readOnly || renaming}
      style={renaming ? { opacity: 0.6 } : undefined}
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
