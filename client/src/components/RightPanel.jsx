import { useEffect, useMemo, useState } from 'react'
import { List, Link2, Network, CalendarDays, Info, FileText, ChevronLeft, ChevronRight, Plus, Hash, Clock, Users, PanelRightClose } from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { api } from '../lib/api.js'
import * as A from '../lib/actions.js'
import { LocalGraph } from './GraphView.jsx'
import { AvatarStack } from './ui.jsx'
import { basename, dirname, stripExt, isNote } from '@shared/paths.js'
import { formatDate, timeAgo, readingTime, formatBytes, plainSnippet } from '../lib/util.js'

export function RightPanel({ tab }) {
  const rightTab = useLayout((s) => s.rightTab)
  const width = useLayout((s) => s.rightWidth)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => useLayout.getState().setWidths({ rightWidth: Math.max(220, Math.min(520, window.innerWidth - e.clientX)) })
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  const tabs = [
    { id: 'outline', icon: List, title: 'Outline' },
    { id: 'backlinks', icon: Link2, title: 'Backlinks' },
    { id: 'graph', icon: Network, title: 'Local graph' },
    { id: 'calendar', icon: CalendarDays, title: 'Calendar' },
    { id: 'info', icon: Info, title: 'Note info' },
  ]

  return (
    <div className="sidebar right" style={{ width }}>
      <div className={`resizer ${dragging ? 'dragging' : ''}`} onMouseDown={() => setDragging(true)} />
      <div className="rp-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`icon-btn ${rightTab === t.id ? 'active' : ''}`} title={t.title} onClick={() => useLayout.getState().setRightTab(t.id)}>
            <t.icon />
          </button>
        ))}
        <button className="icon-btn rp-close" title="Close panel (Ctrl/⌘ Shift \)" onClick={() => useLayout.getState().toggleRight(false)}>
          <PanelRightClose />
        </button>
      </div>
      <div className="rp-body">
        {rightTab === 'outline' && <Outline tab={tab} />}
        {rightTab === 'backlinks' && <Backlinks tab={tab} />}
        {rightTab === 'graph' && (tab?.kind === 'note' ? <LocalGraph path={tab.path} /> : <Empty text="Open a note to see its local graph" />)}
        {rightTab === 'calendar' && <CalendarPanel />}
        {rightTab === 'info' && <NoteInfo tab={tab} />}
      </div>
    </div>
  )
}

function Empty({ text }) {
  return <div className="empty">{text}</div>
}

function Outline({ tab }) {
  const notes = useApp((s) => s.notes)
  const version = useApp((s) => s.version)
  const meta = tab?.kind === 'note' ? notes.get(tab.path) : null
  const headings = meta?.headings || []
  if (!tab || tab.kind !== 'note') return <Empty text="Open a note to see its outline" />
  if (!headings.length) return <Empty text="No headings yet" />
  const min = Math.min(...headings.map((h) => h.level))
  return (
    <>
      <div className="rp-title">Outline</div>
      {headings.map((h, i) => (
        <button
          key={i}
          className="outline-item"
          style={{ paddingLeft: 8 + (h.level - min) * 14, fontSize: h.level === min ? 13.5 : 12.5, fontWeight: h.level === min ? 550 : 400 }}
          onClick={() => useLayout.getState().openNote(tab.ws, tab.path, { line: h.line })}
        >
          {h.text}
        </button>
      ))}
    </>
  )
}

function Backlinks({ tab }) {
  const wsId = useApp((s) => s.wsId)
  const version = useApp((s) => s.version)
  const [data, setData] = useState(null)
  const path = tab?.kind === 'note' ? tab.path : null

  useEffect(() => {
    if (!path || tab.ws !== wsId) {
      setData(null)
      return
    }
    let cancelled = false
    api
      .backlinks(wsId, path)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setData({ linked: [], unlinked: [] }))
    return () => {
      cancelled = true
    }
  }, [path, wsId, version])

  if (!path) return <Empty text="Open a note to see backlinks" />
  if (!data) return <div className="empty">Loading…</div>
  return (
    <>
      <div className="rp-title">
        Linked mentions <span className="badge">{data.linked.length}</span>
      </div>
      {!data.linked.length && <div className="faint" style={{ padding: '0 6px 10px', fontSize: 12 }}>No notes link here yet.</div>}
      {data.linked.map((n) => (
        <BacklinkGroup key={n.path} note={n} ws={wsId} />
      ))}
      {data.unlinked.length > 0 && (
        <>
          <div className="rp-title" style={{ marginTop: 12 }}>
            Unlinked mentions <span className="badge">{data.unlinked.length}</span>
          </div>
          {data.unlinked.map((n) => (
            <BacklinkGroup key={n.path} note={n} ws={wsId} />
          ))}
        </>
      )}
    </>
  )
}

function BacklinkGroup({ note, ws }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="bl-note">
      <div className="bl-note-title">
        <button className="bl-fold" title={open ? 'Hide mentions' : 'Show mentions'} onClick={() => setOpen(!open)}>
          <ChevronRight style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
        </button>
        <span className="truncate grow" style={{ cursor: 'pointer' }} onClick={() => useLayout.getState().openNote(ws, note.path)}>
          {stripExt(basename(note.path))}
        </span>
        <span className="badge">{note.hits.length}</span>
      </div>
      {open &&
        note.hits.map((h, i) => (
          <div key={i} className="bl-hit" onClick={() => useLayout.getState().openNote(ws, note.path, { line: h.line })}>
            {plainSnippet(h.text, 220)}
          </div>
        ))}
    </div>
  )
}

export function CalendarPanel() {
  const [cursor, setCursor] = useState(() => new Date())
  const panes = useLayout((s) => s.panes)
  const openPath = useLayout.getState().activeTab()?.path || null
  void panes // re-read the active tab whenever the panes change
  const treeMap = useApp((s) => s.treeMap)
  const version = useApp((s) => s.version)
  const settings = A.wsSettings()
  const today = new Date()
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  const startDay = (first.getDay() + 6) % 7 // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()

  const tasksByDay = useMemo(() => {
    const map = new Map()
    for (const t of A.allTasks()) if (t.due && !t.checked) map.set(t.due, (map.get(t.due) || 0) + 1)
    return map
  }, [version])

  const cells = []
  for (let i = 0; i < startDay; i++) cells.push({ day: prevDays - startDay + 1 + i, other: true, date: new Date(year, month - 1, prevDays - startDay + 1 + i) })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: new Date(year, month, d) })
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - startDay - daysInMonth + 1, other: true, date: new Date(year, month + 1, cells.length - startDay - daysInMonth + 1) })

  return (
    <div className="calendar">
      <div className="cal-head">
        <div className="cal-month">{formatDate(cursor, 'MMMM YYYY')}</div>
        <button className="icon-btn sm" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          <ChevronLeft />
        </button>
        <button className="icon-btn sm" onClick={() => setCursor(new Date())} title="Today">
          <Clock />
        </button>
        <button className="icon-btn sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          <ChevronRight />
        </button>
      </div>
      <div className="cal-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div className="cal-dow" key={i}>
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          const path = A.dailyNotePath(c.date, settings)
          const has = treeMap.has(path)
          const isToday = formatDate(c.date, 'YYYY-MM-DD') === formatDate(today, 'YYYY-MM-DD')
          const tasks = tasksByDay.get(formatDate(c.date, 'YYYY-MM-DD'))
          return (
            <button
              key={i}
              className={`cal-day ${c.other ? 'other' : ''} ${isToday ? 'today' : ''} ${has ? 'has-note' : ''} ${tasks ? 'has-tasks' : ''} ${path === openPath ? 'active' : ''}`}
              title={`${formatDate(c.date, 'dddd D MMMM')}${has ? ' · daily note' : ''}${tasks ? ` · ${tasks} task(s) due` : ''}`}
              onClick={() => A.openDailyNote(c.date)}
            >
              {c.day}
            </button>
          )
        })}
      </div>
      <button className="btn btn-sm btn-block" style={{ marginTop: 10 }} onClick={() => A.openDailyNote(new Date())}>
        <Plus /> Today's note
      </button>
    </div>
  )
}

function NoteInfo({ tab }) {
  const notes = useApp((s) => s.notes)
  const treeMap = useApp((s) => s.treeMap)
  const presence = useApp((s) => s.presence)
  const user = useApp((s) => s.user)
  if (!tab || tab.kind !== 'note') return <Empty text="Open a note to see details" />
  const meta = notes.get(tab.path)
  const entry = treeMap.get(tab.path)
  const viewers = (presence[tab.path] || []).filter((u) => u.id !== user?.id)
  const tasks = meta?.tasks || []
  const done = tasks.filter((t) => t.checked).length
  return (
    <>
      <div className="rp-title">Note details</div>
      <dl className="info-grid">
        <dt>Words</dt>
        <dd>{meta?.words ?? '—'}</dd>
        <dt>Reading time</dt>
        <dd>{meta ? readingTime(meta.words) : '—'}</dd>
        <dt>Headings</dt>
        <dd>{meta?.headings?.length ?? 0}</dd>
        <dt>Links out</dt>
        <dd>{meta?.links?.length ?? 0}</dd>
        <dt>Tasks</dt>
        <dd>
          {done}/{tasks.length}
        </dd>
        <dt>Size</dt>
        <dd>{entry ? formatBytes(entry.size) : '—'}</dd>
        <dt>Modified</dt>
        <dd>{entry ? timeAgo(entry.mtime) : '—'}</dd>
        <dt>Folder</dt>
        <dd className="truncate">{dirname(tab.path) || '/'}</dd>
      </dl>
      {!!meta?.tags?.length && (
        <>
          <div className="rp-title">Tags</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 5, padding: '0 6px' }}>
            {meta.tags.map((t) => (
              <button key={t} className="badge accent" style={{ cursor: 'pointer' }} onClick={() => A.openTagSearch(t)}>
                #{t}
              </button>
            ))}
          </div>
        </>
      )}
      {viewers.length > 0 && (
        <>
          <div className="rp-title" style={{ marginTop: 12 }}>
            <Users size={12} /> Here now
          </div>
          <div className="row" style={{ padding: '0 6px', gap: 8 }}>
            <AvatarStack users={viewers} size={24} />
            <span className="faint">{viewers.map((v) => v.name).join(', ')}</span>
          </div>
        </>
      )}
    </>
  )
}
