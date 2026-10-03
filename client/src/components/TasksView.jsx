import { useEffect, useMemo, useState } from 'react'
import { ListChecks, Search, X } from 'lucide-react'
import { BUCKETS, PRIORITIES, PRIORITY_EMOJI, bucketOf, compareTasks, isOpen, todayIso } from '@shared/tasks.js'
import { basename, stripExt, dirname } from '@shared/paths.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import * as A from '../lib/actions.js'
import { TaskRow, QuickAdd, TaskEditor, taskKey } from './TaskParts.jsx'

const STORE = 'obi:tasksView'
const DEFAULT_VIEW = { status: 'open', group: 'date', query: '', tag: null, priority: null }

function loadView() {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(STORE) || '{}') }
  } catch {
    return DEFAULT_VIEW
  }
}

const PRIORITY_GROUPS = [...PRIORITIES.slice(0, 3), 'none', ...PRIORITIES.slice(3)]
const PRIORITY_NAME = { highest: 'Highest', high: 'High', medium: 'Medium', none: 'No priority', low: 'Low', lowest: 'Lowest' }

// how deep a task sits under others in its note (for showing subtasks nested)
function depthOf(task, byLine) {
  let d = 0
  for (let p = byLine.get(`${task.path}:${task.parent}`); p && d < 6; p = byLine.get(`${p.path}:${p.parent}`)) d++
  return d
}

export function TasksView() {
  const version = useApp((s) => s.version)
  const wsId = useApp((s) => s.wsId)
  const [view, setViewState] = useState(loadView)
  const [editing, setEditing] = useState(null) // { key, anchor }
  const { status, group, query, tag, priority } = view
  const setView = (patch) =>
    setViewState((v) => {
      const next = { ...v, ...patch }
      try {
        localStorage.setItem(STORE, JSON.stringify(next))
      } catch {}
      return next
    })

  // the day rolls over while the view stays open
  const [today, setToday] = useState(todayIso)
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60000)
    return () => clearInterval(t)
  }, [])

  const all = useMemo(() => A.allTasks(), [version])
  const byLine = useMemo(() => new Map(all.map((t) => [taskKey(t), t])), [all])

  const tasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((t) => (status === 'all' ? true : status === 'open' ? isOpen(t.status) : !isOpen(t.status)))
      .filter((t) => !priority || (priority === 'none' ? !t.priority : t.priority === priority))
      .filter((t) => !tag || t.tags?.some((x) => x.toLowerCase() === tag.toLowerCase()))
      .filter((t) => !q || t.text.toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
      .sort(compareTasks)
  }, [all, status, priority, tag, query])

  const groups = useMemo(() => {
    const out = new Map()
    const push = (key, task) => (out.has(key) ? out.get(key).push(task) : out.set(key, [task]))
    for (const task of tasks) {
      if (group === 'note') push(task.path, task)
      else if (group === 'priority') push(task.priority || 'none', task)
      else push(bucketOf(task, today), task)
    }
    const order = group === 'date' ? BUCKETS.map((b) => b.id) : group === 'priority' ? PRIORITY_GROUPS : null
    const entries = [...out.entries()].sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : a[0].localeCompare(b[0])))
    // in a note, in the order they are written, so subtasks follow their parents
    if (group === 'note') for (const [, list] of entries) list.sort((a, b) => a.line - b.line)
    return entries
  }, [tasks, group, today])

  const counts = useMemo(() => {
    const open = all.filter((t) => isOpen(t.status))
    return { open: open.length, overdue: open.filter((t) => t.due && t.due < today).length, done: all.length - open.length }
  }, [all, today])

  const topTags = useMemo(() => {
    const n = new Map()
    for (const t of all) if (isOpen(t.status)) for (const x of t.tags || []) n.set(x, (n.get(x) || 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  }, [all])

  const labelOf = (key) => (group === 'date' ? BUCKETS.find((b) => b.id === key)?.label : group === 'priority' ? `${PRIORITY_EMOJI[key] || ''} ${PRIORITY_NAME[key]}`.trim() : key)
  const editedTask = editing ? byLine.get(editing.key) : null

  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head">
          <h2>Tasks</h2>
          <span className="badge">{counts.open} open</span>
          {counts.overdue > 0 && <span className="badge danger">{counts.overdue} overdue</span>}
          <span className="badge success">{counts.done} done</span>
        </div>

        <QuickAdd />

        <div className="tasks-head">
          <div className="search-box grow" style={{ margin: 0, maxWidth: 300 }}>
            <Search />
            <input className="input" placeholder="Filter tasks…" value={query} onChange={(e) => setView({ query: e.target.value })} />
          </div>
          <div className="segmented">
            {[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([f, label]) => (
              <button key={f} className={status === f ? 'active' : ''} onClick={() => setView({ status: f })}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented">
            {[['date', 'By date'], ['priority', 'By priority'], ['note', 'By note']].map(([g, label]) => (
              <button key={g} className={group === g ? 'active' : ''} onClick={() => setView({ group: g })}>
                {label}
              </button>
            ))}
          </div>
          <select className="input task-filter" value={priority || ''} onChange={(e) => setView({ priority: e.target.value || null })} title="Only this priority">
            <option value="">Any priority</option>
            {[...PRIORITIES, 'none'].map((p) => (
              <option key={p} value={p}>
                {PRIORITY_EMOJI[p] || ''} {PRIORITY_NAME[p] || p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {(topTags.length > 0 || tag) && (
          <div className="task-tags">
            {tag && !topTags.some(([t]) => t === tag) && (
              <button className="task-tag on" onClick={() => setView({ tag: null })}>
                #{tag} <X />
              </button>
            )}
            {topTags.map(([t, n]) => (
              <button key={t} className={`task-tag ${tag === t ? 'on' : ''}`} onClick={() => setView({ tag: tag === t ? null : t })}>
                #{t} <span className="faint">{n}</span>
              </button>
            ))}
          </div>
        )}

        {!tasks.length && (
          <div className="empty">
            <ListChecks />
            No tasks {status === 'open' ? 'open' : 'found'}. Add one above, or write <span className="code-inline">- [ ] something</span> in any note.
          </div>
        )}

        {groups.map(([key, list]) => (
          <div className="task-group" key={key}>
            <div className={`task-group-title ${key === 'overdue' ? 'overdue' : ''}`}>
              {group === 'note' ? (
                <span style={{ cursor: 'pointer' }} onClick={() => useLayout.getState().openNote(wsId, key)}>
                  {stripExt(basename(key))} <span className="faint">{dirname(key)}</span>
                </span>
              ) : (
                labelOf(key)
              )}
              <span className="badge">{list.length}</span>
            </div>
            {list.map((t) => (
              <TaskRow
                key={taskKey(t)}
                task={t}
                showSource={group !== 'note'}
                depth={group === 'note' ? depthOf(t, byLine) : 0}
                wsId={wsId}
                onTag={(x) => setView({ tag: x })}
                editing={editing?.key === taskKey(t)}
                onEdit={(task, anchor) => setEditing(editing?.key === taskKey(task) ? null : { key: taskKey(task), anchor })}
              />
            ))}
          </div>
        ))}
      </div>
      {editedTask && editing.anchor.isConnected && (
        <TaskEditor
          task={editedTask}
          anchor={editing.anchor}
          onClose={() => setEditing(null)}
          onOpenNote={() => {
            useLayout.getState().openNote(wsId, editedTask.path, { line: editedTask.line })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
