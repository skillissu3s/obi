import { useMemo, useState } from 'react'
import { ListChecks, Search, FileText, Filter } from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { api } from '../lib/api.js'
import { toast } from '../store/ui.js'
import * as A from '../lib/actions.js'
import { renderInline } from '../lib/render.js'
import { formatDate, dueLabel } from '../lib/util.js'
import { basename, stripExt, dirname } from '@shared/paths.js'

const today = () => formatDate(new Date(), 'YYYY-MM-DD')

export function TasksView() {
  const version = useApp((s) => s.version)
  const wsId = useApp((s) => s.wsId)
  const [filter, setFilter] = useState('open')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('due')
  const [busy, setBusy] = useState(null)

  const tasks = useMemo(() => {
    let list = A.allTasks()
    if (filter === 'open') list = list.filter((t) => !t.checked)
    if (filter === 'done') list = list.filter((t) => t.checked)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((t) => t.text.toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
    }
    return list
  }, [version, filter, query])

  const groups = useMemo(() => {
    const t = today()
    const out = new Map()
    const push = (key, task) => {
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(task)
    }
    for (const task of tasks) {
      if (group === 'note') push(task.path, task)
      else if (task.checked) push('Completed', task)
      else if (!task.due) push('No date', task)
      else if (task.due < t) push('Overdue', task)
      else if (task.due === t) push('Today', task)
      else if (task.due <= formatDate(new Date(Date.now() + 7 * 86400000), 'YYYY-MM-DD')) push('Next 7 days', task)
      else push('Later', task)
    }
    const order = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No date', 'Completed']
    return [...out.entries()].sort((a, b) => {
      if (group === 'note') return a[0].localeCompare(b[0])
      return order.indexOf(a[0]) - order.indexOf(b[0])
    })
  }, [tasks, group])

  const toggle = async (task) => {
    setBusy(`${task.path}:${task.line}`)
    try {
      await api.toggleTask(wsId, task.path, task.line)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }

  const total = A.allTasks()
  const open = total.filter((t) => !t.checked).length

  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head">
          <h2>Tasks</h2>
          <span className="badge">{open} open</span>
          <span className="badge success">{total.length - open} done</span>
        </div>
        <div className="tasks-head">
          <div className="search-box grow" style={{ margin: 0, maxWidth: 320 }}>
            <Search />
            <input className="input" placeholder="Filter tasks…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="segmented">
            {['open', 'done', 'all'].map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="segmented">
            {[
              ['due', 'By date'],
              ['note', 'By note'],
            ].map(([g, label]) => (
              <button key={g} className={group === g ? 'active' : ''} onClick={() => setGroup(g)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {!tasks.length && (
          <div className="empty">
            <ListChecks />
            No tasks {filter === 'open' ? 'open' : 'found'}. Add <span className="code-inline">- [ ] something</span> to a note.
          </div>
        )}

        {groups.map(([key, list]) => (
          <div className="task-group" key={key}>
            <div className={`task-group-title ${key === 'Overdue' ? 'overdue' : ''}`}>
              {group === 'note' ? (
                <span style={{ cursor: 'pointer' }} onClick={() => useLayout.getState().openNote(wsId, key)}>
                  {stripExt(basename(key))} <span className="faint">{dirname(key)}</span>
                </span>
              ) : (
                key
              )}
              <span className="badge">{list.length}</span>
            </div>
            {list.map((t) => (
              <div className={`task-row ${t.checked ? 'done' : ''} ${busy === `${t.path}:${t.line}` ? 'busy' : ''}`} key={`${t.path}:${t.line}`}>
                <input type="checkbox" className="task-cb" checked={t.checked} disabled={busy === `${t.path}:${t.line}`} onChange={() => toggle(t)} />
                <div
                  className="task-text"
                  title="Open this line"
                  onClick={(e) => {
                    if (e.target.closest('a')) return
                    useLayout.getState().openNote(wsId, t.path, { line: t.line })
                  }}
                  dangerouslySetInnerHTML={{ __html: renderInline(t.text.replace(/📅\s*(\d{4}-\d{2}-\d{2})/, ''), { ws: wsId, path: t.path }) }}
                />
                {t.due && (
                  <span className={`due-chip ${!t.checked && t.due < today() ? 'overdue' : t.due === today() ? 'today' : ''}`} title={t.due}>
                    {dueLabel(t.due)}
                  </span>
                )}
                {group !== 'note' && (
                  <span className="task-source" onClick={() => useLayout.getState().openNote(wsId, t.path, { line: t.line })}>
                    {stripExt(basename(t.path))}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
