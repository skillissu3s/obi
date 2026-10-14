// The Projects tab of the sidebar: every task at a glance, the calendar, and the
// workspace's projects — each a board of lists and cards (see ProjectBoard).
import { useMemo, useState } from 'react'
import { CalendarDays, ExternalLink, FolderOpen, Inbox, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { isOpen } from '@shared/tasks.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { useUI } from '../store/ui.js'
import * as A from '../lib/actions.js'
import { createProject, useProjects } from '../lib/projects.js'
import { useTasks } from '../lib/planner.js'

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
      aria-label="Name of the new project"
      placeholder="Project name, then Enter"
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

export function ProjectsPanel() {
  const projects = useProjects()
  const ws = useApp((s) => s.wsId)
  const role = useApp((s) => s.workspaces.find((w) => w.id === s.wsId)?.role)
  const canEdit = role !== 'viewer'
  const model = useTasks()
  const openTasks = useMemo(() => model.cards.filter((t) => isOpen(t.status)).length, [model])
  const active = useLayout((s) => {
    const pane = s.panes.find((p) => p.id === s.activePane)
    return pane?.tabs.find((t) => t.id === pane.active) || null
  })
  const [adding, setAdding] = useState(false)
  const open = (e, path) => useLayout.getState().openNote(ws, path, { newTab: e.metaKey || e.ctrlKey })

  const menu = (e, p) => {
    e.preventDefault()
    useUI.getState().showContextMenu(e, [
      { label: 'Open in new tab', icon: ExternalLink, run: () => useLayout.getState().openNote(ws, p.path, { newTab: true }) },
      { label: 'Show in files', icon: FolderOpen, run: () => (useApp.getState().revealPath(p.path), useLayout.getState().setLeftTab('files')) },
      canEdit && 'divider',
      canEdit && { label: 'Rename…', icon: Pencil, run: () => A.renameEntry(p.path) },
      canEdit && { label: 'Delete project', icon: Trash2, danger: true, run: () => A.deleteEntry(p.path) },
    ])
  }

  return (
    <>
      <div className="sidebar-toolbar">
        <span className="title">Projects</span>
        {canEdit && (
          <button className="icon-btn sm" title="New project" onClick={() => setAdding(true)}>
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

        <div className="pj-label">Boards</div>
        {projects.map((p) => (
          <button
            key={p.path}
            type="button"
            className={`pj-row ${active?.kind === 'note' && active.ws === ws && active.path === p.path ? 'active' : ''}`}
            title={p.path}
            onClick={(e) => open(e, p.path)}
            onContextMenu={(e) => menu(e, p)}
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
              New project
            </button>
          ))}
        {!projects.length && (
          <p className="pj-empty">
            A project is a board of lists and cards, kept as a markdown note in your Projects folder. New tasks go to the Inbox until you make more.
          </p>
        )}
      </div>
    </>
  )
}
