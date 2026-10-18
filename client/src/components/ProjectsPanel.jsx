// The workspace's boards (projects: boards of lists and cards, see ProjectBoard),
// in two places: the Projects tab of the sidebar — with every task at a glance
// and the calendar — and the Boards section at the foot of the Files tab, which
// opens and closes like a panel in VS Code. The boards live in the Projects
// folder; the Files tab shows them there instead of in its tree.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Eye, EyeOff, ExternalLink, FolderOpen, Inbox, ListChecks, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { isOpen } from '@shared/tasks.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { useUI } from '../store/ui.js'
import * as A from '../lib/actions.js'
import { createProject, projectName, projectsFolder, setBoardOrder, useProjects } from '../lib/projects.js'
import { colorFor } from '../lib/util.js'
import { warmOnHover } from '../lib/socket.js'
import { useTasks } from '../lib/planner.js'
import { menuFromElement } from './ui.jsx'

function NewProject({ onDone }) {
  const [name, setName] = useState('')
  const submit = () => {
    const v = name.replace(/\s+/g, ' ').trim()
    onDone()
    if (v) createProject(v)
  }
  return (
    <input
      className="input pj-new-input"
      autoFocus
      aria-label="Name of the new board"
      placeholder="Board name, then Enter"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit()
        else if (e.key === 'Escape') onDone()
      }}
      onBlur={submit}
    />
  )
}

const useActive = () =>
  useLayout((s) => {
    const pane = s.panes.find((p) => p.id === s.activePane)
    return pane?.tabs.find((t) => t.id === pane.active) || null
  })

const useCanEditWs = () => useApp((s) => s.workspaces.find((w) => w.id === s.wsId)?.role) !== 'viewer'

// Shows a board in the Files tree: boards in the Projects folder are left out of it
// (they are listed in the Boards section) until asked for
function revealBoard(path) {
  const inFolder = path.startsWith(`${projectsFolder()}/`)
  if (inFolder && !usePrefs.getState().showBoardFiles) usePrefs.getState().set({ showBoardFiles: true })
  useLayout.getState().setLeftTab('files')
  setTimeout(() => useApp.getState().revealPath(path))
}

/** Puts the board at `from` at `to` in the list (and keeps that order, see setBoardOrder) */
function moveBoard(projects, from, to) {
  if (to < 0 || to >= projects.length || to === from) return
  const paths = projects.map((p) => p.path)
  paths.splice(to, 0, ...paths.splice(from, 1))
  setBoardOrder(paths)
}

/**
 * Dragging a board up or down the list puts it where it belongs: the row follows the
 * pointer and the others make room for it. Returns the drag under way ({ from, to,
 * dy, pitch }) and what a row needs to start one.
 */
function useReorder(projects, canEdit) {
  const [drag, setDrag] = useState(null)
  const dragged = useRef(false)
  const start = (e, from) => {
    if (!canEdit || e.button !== 0 || projects.length < 2) return
    const rows = [...e.currentTarget.parentElement.querySelectorAll(':scope > [data-board]')]
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect()
      return b.top + b.height / 2
    })
    const pitch = rows.length > 1 ? mids[1] - mids[0] : e.currentTarget.offsetHeight
    const y0 = e.clientY
    let live = null
    const move = (ev) => {
      // (it stays within the list)
      const dy = Math.min(mids[mids.length - 1] - mids[from], Math.max(mids[0] - mids[from], ev.clientY - y0))
      if (!live && Math.abs(dy) < 4) return
      // where it would go: after every other row whose middle it has passed
      const y = mids[from] + dy
      live = { from, to: mids.filter((m, i) => i !== from && m < y).length, dy, pitch }
      setDrag(live)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!live) return
      // (the click that ends a drag doesn't open the board)
      dragged.current = true
      setTimeout(() => (dragged.current = false))
      setDrag(null)
      moveBoard(projects, live.from, live.to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  // how far a row is moved while a drag is under way: the dragged one with the pointer, the ones it passed make room
  const shift = (i) => {
    if (!drag) return undefined
    if (i === drag.from) return drag.dy
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.pitch
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.pitch
    return 0
  }
  return { drag, start, shift, dragged }
}

/**
 * The boards as rows: this workspace's (drag one up or down to put it in its place),
 * a way to make one (`adding`, from the outside, opens its name field), and the ones
 * other people shared.
 */
function BoardRows({ adding, setAdding, label = true }) {
  const projects = useProjects()
  const ws = useApp((s) => s.wsId)
  const canEdit = useCanEditWs()
  const active = useActive()
  const reorder = useReorder(projects, canEdit)
  // boards other people shared with this person (from any workspace)
  const shared = useApp((s) => s.shared).filter((n) => n.board)
  const open = (e, w, path) => useLayout.getState().openNote(w, path, { newTab: e.metaKey || e.ctrlKey })
  const isActive = (w, path) => active?.kind === 'note' && active.ws === w && active.path === path

  const menu = (e, p, i) => {
    e.preventDefault()
    useUI.getState().showContextMenu(e, [
      { label: 'Open in new tab', icon: ExternalLink, run: () => useLayout.getState().openNote(ws, p.path, { newTab: true }) },
      { label: 'Show in files', icon: FolderOpen, run: () => revealBoard(p.path) },
      canEdit && projects.length > 1 && 'divider',
      canEdit && i > 0 && { label: 'Move up', icon: ArrowUp, hint: 'Alt+↑', run: () => moveBoard(projects, i, i - 1) },
      canEdit && i < projects.length - 1 && { label: 'Move down', icon: ArrowDown, hint: 'Alt+↓', run: () => moveBoard(projects, i, i + 1) },
      canEdit && 'divider',
      canEdit && { label: 'Rename…', icon: Pencil, run: () => A.renameEntry(p.path) },
      canEdit && { label: 'Delete board', icon: Trash2, danger: true, run: () => A.deleteEntry(p.path) },
    ])
  }

  return (
    <>
      {label && <div className="pj-label">Boards</div>}
      {projects.map((p, i) => (
        <button
          key={p.path}
          type="button"
          data-board={p.path}
          className={`pj-row ${isActive(ws, p.path) ? 'active' : ''} ${reorder.drag ? (reorder.drag.from === i ? 'lifted' : 'making-room') : ''}`}
          style={reorder.drag ? { transform: `translateY(${reorder.shift(i)}px)` } : undefined}
          title={canEdit && projects.length > 1 ? `${p.path} — drag to move it up or down` : p.path}
          onPointerDown={(e) => reorder.start(e, i)}
          {...warmOnHover(ws, p.path)}
          onClick={(e) => !reorder.dragged.current && open(e, ws, p.path)}
          onKeyDown={(e) => {
            if (!canEdit || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
            e.preventDefault()
            const list = e.currentTarget.parentElement
            moveBoard(projects, i, i + (e.key === 'ArrowUp' ? -1 : 1))
            // (the focus stays on the board that moved)
            requestAnimationFrame(() => list?.querySelector(`[data-board="${CSS.escape(p.path)}"]`)?.focus())
          }}
          onContextMenu={(e) => menu(e, p, i)}
        >
          <span className="pj-tile" style={{ '--pj': p.color }}>
            {p.inbox ? <Inbox /> : p.name.trim()[0]?.toUpperCase()}
          </span>
          <span className="truncate">{p.name}</span>
          <span className="count" title={`${p.open} open of ${p.total}`}>
            {p.open || ''}
          </span>
        </button>
      ))}
      {canEdit &&
        (adding ? (
          <NewProject onDone={() => setAdding(false)} />
        ) : (
          <button type="button" className="pj-row pj-new" onClick={() => setAdding(true)}>
            <span className="pj-tile">
              <Plus />
            </span>
            New board
          </button>
        ))}
      {shared.length > 0 && (
        <>
          <div className="pj-label">Shared with me</div>
          {shared.map((n) => (
            <button
              key={`${n.ws}:${n.path}`}
              type="button"
              className={`pj-row ${isActive(n.ws, n.path) ? 'active' : ''}`}
              title={`${n.workspaceName} · shared by ${n.sharedBy || 'someone'}${n.role === 'viewer' ? ' · view only' : ''}`}
              onClick={(e) => open(e, n.ws, n.path)}
            >
              <span className="pj-tile" style={{ '--pj': colorFor(projectName(n.path).toLowerCase()) }}>
                <Users />
              </span>
              <span className="truncate">{projectName(n.path)}</span>
              <span className="count">{n.sharedBy?.split(' ')[0] || ''}</span>
            </button>
          ))}
        </>
      )}
      {!projects.length && !shared.length && (
        <p className="pj-empty">A board holds lists and cards, kept as a markdown note in your Projects folder. New tasks go to the Inbox until you make more.</p>
      )}
    </>
  )
}

export function ProjectsPanel() {
  const canEdit = useCanEditWs()
  const model = useTasks()
  const openTasks = useMemo(() => model.cards.filter((t) => isOpen(t.status)).length, [model])
  const active = useActive()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <div className="sidebar-toolbar">
        <span className="title">Projects</span>
        {canEdit && (
          <button className="icon-btn sm" title="New board" onClick={() => setAdding(true)}>
            <Plus />
          </button>
        )}
      </div>
      <div className="pj">
        <button type="button" className={`pj-row ${active?.kind === 'tasks' ? 'active' : ''}`} onClick={() => useLayout.getState().openView('tasks')}>
          <ListChecks /> All tasks
          <span className="count">{openTasks || ''}</span>
        </button>
        <button type="button" className={`pj-row ${active?.kind === 'calendar' ? 'active' : ''}`} onClick={() => useLayout.getState().openView('calendar')}>
          <CalendarDays /> Calendar
        </button>
        <BoardRows adding={adding} setAdding={setAdding} />
      </div>
    </>
  )
}

// ---------- the Boards section at the foot of the Files tab ----------

const DOCK_OPEN = 'obi:boardsDock'
const DOCK_HEIGHT = 'obi:boardsDockHeight'
const read = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    localStorage.setItem(k, v)
  } catch {}
}

export function BoardsDock() {
  const projects = useProjects()
  const canEdit = useCanEditWs()
  const showFiles = usePrefs((s) => s.showBoardFiles)
  const [open, setOpenState] = useState(() => read(DOCK_OPEN) !== '0')
  const [height, setHeight] = useState(() => Math.max(96, Number(read(DOCK_HEIGHT)) || 220))
  const [adding, setAdding] = useState(false)
  const [resizing, setResizing] = useState(false)
  const root = useRef(null)
  const setOpen = (v) => {
    setOpenState(v)
    write(DOCK_OPEN, v ? '1' : '0')
  }

  // drag the top edge to make it taller or shorter (the files above keep at least some room)
  useEffect(() => {
    if (!resizing) return undefined
    const sidebar = root.current?.closest('.sidebar')
    const startY = resizing.y
    const from = resizing.h
    const move = (e) => {
      const max = Math.max(120, (sidebar?.clientHeight || 600) - 220)
      setHeight(Math.round(Math.min(max, Math.max(96, from + startY - e.clientY))))
    }
    const up = () => setResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [resizing])
  useEffect(() => {
    if (!resizing) write(DOCK_HEIGHT, String(height))
  }, [resizing, height])

  const more = (e) => {
    e.stopPropagation()
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      canEdit && { label: 'New board', icon: Plus, run: () => (setOpen(true), setAdding(true)) },
      { label: 'All tasks', icon: ListChecks, run: () => useLayout.getState().openView('tasks') },
      { label: 'Calendar', icon: CalendarDays, run: () => useLayout.getState().openView('calendar') },
      'divider',
      {
        label: showFiles ? 'Hide the boards in the file list' : 'Show the boards in the file list too',
        icon: showFiles ? EyeOff : Eye,
        run: () => usePrefs.getState().set({ showBoardFiles: !showFiles }),
      },
    ])
  }

  return (
    <section ref={root} className={`boards-dock ${open ? 'open' : ''} ${resizing ? 'resizing' : ''}`} style={open ? { height } : undefined} aria-label="Boards">
      {open && <div className="boards-dock-sash" title="Drag to resize" onPointerDown={(e) => (e.preventDefault(), setResizing({ y: e.clientY, h: height }))} />}
      <header className="boards-dock-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(!open))}>
        <ChevronRight className="boards-dock-chev" />
        <span className="boards-dock-title">Boards</span>
        {projects.length > 0 && <span className="boards-dock-count">{projects.length}</span>}
        <span className="grow" />
        {canEdit && (
          <button
            type="button"
            className="icon-btn sm"
            title="New board"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(true)
              setAdding(true)
            }}
          >
            <Plus />
          </button>
        )}
        <button type="button" className="icon-btn sm" title="More" onClick={more}>
          <MoreHorizontal />
        </button>
      </header>
      {open && (
        <div className="boards-dock-body pj">
          <BoardRows adding={adding} setAdding={setAdding} label={false} />
        </div>
      )}
    </section>
  )
}
