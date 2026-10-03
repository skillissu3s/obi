import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Plus } from 'lucide-react'
import { addDays, addMonths, compareTasks, daysBetween, isIsoDate, isOpen, taskDate, todayIso, weekdayOf } from '@shared/tasks.js'
import { basename, isNote, stripExt } from '@shared/paths.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import * as A from '../lib/actions.js'
import { dateOfIso, formatDate, timeAgo } from '../lib/util.js'
import { TaskBox, TaskEditor, TaskRow, QuickAdd, dueClass, taskKey } from './TaskParts.jsx'

const STORE = 'obi:calendar'
const MODES = [
  ['month', 'Month'],
  ['week', 'Week'],
  ['agenda', 'Agenda'],
]
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const AGENDA_DAYS = 30
const CHIPS_IN_A_MONTH_CELL = 3

const loadMode = () => {
  try {
    const m = JSON.parse(localStorage.getItem(STORE) || '{}').mode
    return MODES.some(([id]) => id === m) ? m : 'month'
  } catch {
    return 'month'
  }
}

const monthStart = (iso) => `${iso.slice(0, 8)}01`
// the first day of the week containing `iso`; startDay is 0 (Sunday) or 1 (Monday)
const weekStartOf = (iso, startDay) => addDays(iso, -((weekdayOf(iso) - startDay + 7) % 7))

// the days a view shows
function daysOf(mode, selected, startDay) {
  if (mode === 'week') {
    const start = weekStartOf(selected, startDay)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }
  if (mode === 'agenda') return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(selected, i))
  const first = monthStart(selected)
  const start = weekStartOf(first, startDay)
  const weeks = Math.ceil(daysBetween(start, addMonths(first, 1)) / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
}

// What each day holds: its tasks (on their due, else scheduled, else start day —
// a finished one with no date of its own, on the day it was finished) and the
// notes that say `date:` in their properties.
function useDays(version) {
  return useMemo(() => {
    const days = new Map()
    const at = (d) => days.get(d) || days.set(d, { tasks: [], notes: [] }).get(d)
    for (const t of A.allTasks()) {
      const d = taskDate(t) || (isOpen(t.status) ? null : t.done || t.cancelled)
      if (d) at(d).tasks.push(t)
    }
    for (const [path, meta] of useApp.getState().notes) {
      const d = String(meta.fm?.date ?? '').slice(0, 10)
      if (isIsoDate(d)) at(d).notes.push(path)
    }
    for (const day of days.values()) {
      day.tasks.sort(compareTasks)
      day.notes.sort()
    }
    return days
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
}

const NONE = { tasks: [], notes: [] }
const openNote = (wsId, path) => useLayout.getState().openNote(wsId, path)

function TaskChip({ task, onEdit, editing }) {
  return (
    <div
      className={`calv-chip task ${isOpen(task.status) ? '' : 'done'} ${task.status === '-' ? 'cancelled' : ''} ${dueClass(task)} ${editing ? 'editing' : ''}`}
      title={task.text}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/obi-task', taskKey(task))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onEdit(task, e.currentTarget)
      }}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <TaskBox task={task} />
      </span>
      <span className="calv-chip-text">{task.text}</span>
    </div>
  )
}

function Cell({ iso, today, selected, dim, data, hasNote, limit, wsId, editingKey, onSelect, onOpenDay, onEdit, onDropTask }) {
  const [over, setOver] = useState(false)
  const shown = data.tasks.slice(0, limit)
  const more = data.tasks.length - shown.length
  const date = dateOfIso(iso)
  return (
    <div
      className={`calv-cell ${iso === today ? 'today' : ''} ${iso === selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${over ? 'over' : ''}`}
      onClick={() => onSelect(iso)}
      onDoubleClick={() => onOpenDay(iso)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/obi-task')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const key = e.dataTransfer.getData('text/obi-task')
        if (key) onDropTask(key, iso)
      }}
    >
      <div className="calv-cell-head">
        <span className="calv-num">{date.getDate() === 1 ? formatDate(date, 'D MMM') : date.getDate()}</span>
        <button
          className={`calv-daily ${hasNote ? 'has' : ''}`}
          title={hasNote ? "Open this day's note" : "Start this day's note"}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDay(iso)
          }}
        >
          {hasNote ? <FileText /> : <Plus />}
        </button>
      </div>
      <div className="calv-items">
        {shown.map((t) => (
          <TaskChip key={taskKey(t)} task={t} editing={editingKey === taskKey(t)} onEdit={onEdit} />
        ))}
        {limit === Infinity &&
          data.notes.map((p) => (
            <button
              key={p}
              className="calv-chip note"
              title={p}
              onClick={(e) => {
                e.stopPropagation()
                openNote(wsId, p)
              }}
            >
              <FileText />
              <span className="calv-chip-text">{stripExt(basename(p))}</span>
            </button>
          ))}
        {more > 0 && <div className="calv-more">+{more} more</div>}
        {limit !== Infinity && data.notes.length > 0 && (
          <div className="calv-more" title={data.notes.map((p) => stripExt(basename(p))).join(', ')}>
            <FileText /> {data.notes.length}
          </div>
        )}
      </div>
    </div>
  )
}

// The selected day in full: its note, a way to add to it, what is planned, what
// is dated, and what was written that day.
function DayPanel({ iso, data, hasNote, wsId, editingKey, onEdit, edited }) {
  const date = dateOfIso(iso)
  return (
    <>
      <div className="calv-side-head">
        <div>
          <div className="calv-side-day">{iso === todayIso() ? 'Today' : formatDate(date, 'dddd')}</div>
          <div className="calv-side-date">{formatDate(date, 'D MMMM YYYY')}</div>
        </div>
        <button className="btn btn-sm" onClick={() => A.openDailyNote(date, { announce: !hasNote })}>
          {hasNote ? (
            <>
              <FileText /> Open note
            </>
          ) : (
            <>
              <Plus /> Start the note
            </>
          )}
        </button>
      </div>
      <QuickAdd day={iso} />
      <div className="calv-side-title">Tasks</div>
      {data.tasks.length ? (
        data.tasks.map((t) => <TaskRow key={taskKey(t)} task={t} wsId={wsId} editing={editingKey === taskKey(t)} onEdit={onEdit} />)
      ) : (
        <div className="faint calv-empty">Nothing planned.</div>
      )}
      {data.notes.length > 0 && (
        <>
          <div className="calv-side-title">Notes for this day</div>
          {data.notes.map((p) => (
            <button key={p} className="calv-note" onClick={() => openNote(wsId, p)}>
              <FileText /> {stripExt(basename(p))}
            </button>
          ))}
        </>
      )}
      {edited.length > 0 && (
        <>
          <div className="calv-side-title">Edited this day</div>
          {edited.map((e) => (
            <button key={e.path} className="calv-note" onClick={() => openNote(wsId, e.path)}>
              <FileText /> {stripExt(basename(e.path))}
              <span className="faint">{timeAgo(e.mtime)}</span>
            </button>
          ))}
        </>
      )}
    </>
  )
}

export function CalendarView() {
  const version = useApp((s) => s.version)
  const wsId = useApp((s) => s.wsId)
  const treeMap = useApp((s) => s.treeMap)
  const startDay = usePrefs((s) => (s.weekStart === 'sunday' ? 0 : 1))
  const [mode, setModeState] = useState(loadMode)
  const [today, setToday] = useState(todayIso)
  const [selected, setSelected] = useState(today)
  const [editing, setEditing] = useState(null) // { key, anchor }
  const days = useDays(version)

  // the day rolls over while the view stays open
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60000)
    return () => clearInterval(t)
  }, [])

  const setMode = (m) => {
    setModeState(m)
    try {
      localStorage.setItem(STORE, JSON.stringify({ mode: m }))
    } catch {}
  }
  const shown = useMemo(() => daysOf(mode, selected, startDay), [mode, selected, startDay])
  const data = (iso) => days.get(iso) || NONE
  const hasNote = (iso) => treeMap.has(A.dailyNotePath(dateOfIso(iso)))
  const openDay = (iso) => A.openDailyNote(dateOfIso(iso), { announce: !hasNote(iso) })

  // the previous or next month, week or stretch of the agenda
  const go = (n) => setSelected((d) => (mode === 'month' ? addMonths(d, n) : addDays(d, n * (mode === 'week' ? 7 : 14))))

  const tasksByKey = useMemo(() => new Map(A.allTasks().map((t) => [taskKey(t), t])), [version])
  const editedTask = editing ? tasksByKey.get(editing.key) : null

  // dropping a task on a day moves its date there
  const dropTask = (key, iso) => {
    const task = tasksByKey.get(key)
    if (!task || taskDate(task) === iso) return
    A.updateTask(task, { [task.due ? 'due' : task.scheduled ? 'scheduled' : task.start ? 'start' : 'due']: iso })
  }

  const edited = useMemo(() => {
    if (mode === 'agenda') return []
    const from = dateOfIso(selected).getTime()
    const to = dateOfIso(addDays(selected, 1)).getTime()
    const daily = A.dailyNotePath(dateOfIso(selected))
    return [...treeMap.values()]
      .filter((e) => e.type === 'file' && isNote(e.path) && e.path !== daily && e.mtime >= from && e.mtime < to)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 8)
  }, [mode, selected, treeMap])

  const onKeyDown = (e) => {
    if (e.target.closest('input, select, textarea, button')) return
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) setSelected((d) => addDays(d, step))
    else if (e.key === 'PageUp' || e.key === 'PageDown') go(e.key === 'PageUp' ? -1 : 1)
    else if (e.key === 'Enter') openDay(selected)
    else if (e.key === 't') setSelected(today)
    else return
    e.preventDefault()
  }

  const startLabel = (d) => formatDate(dateOfIso(d), 'D MMM')
  const title = mode === 'month' ? formatDate(dateOfIso(selected), 'MMMM YYYY') : mode === 'week' ? `${startLabel(shown[0])} – ${formatDate(dateOfIso(shown[6]), 'D MMM YYYY')}` : 'Coming up'
  const names = DOW.slice(startDay).concat(DOW.slice(0, startDay))
  const cell = (iso, limit) => (
    <Cell
      key={iso}
      iso={iso}
      today={today}
      selected={iso === selected}
      dim={mode === 'month' && iso.slice(0, 7) !== selected.slice(0, 7)}
      data={data(iso)}
      hasNote={hasNote(iso)}
      limit={limit}
      wsId={wsId}
      editingKey={editing?.key}
      onSelect={setSelected}
      onOpenDay={openDay}
      onEdit={(task, anchor) => setEditing(editing?.key === taskKey(task) ? null : { key: taskKey(task), anchor })}
      onDropTask={dropTask}
    />
  )
  const edit = (task, anchor) => setEditing(editing?.key === taskKey(task) ? null : { key: taskKey(task), anchor })
  const agenda = shown.filter((d) => d === today || d === selected || data(d).tasks.length || data(d).notes.length)

  return (
    <div className="calv" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="calv-body">
        <div className="calv-main">
          <div className="calv-bar">
            <h2>{title}</h2>
            <div className="calv-nav">
              <button className="icon-btn" title="Previous" onClick={() => go(-1)}>
                <ChevronLeft />
              </button>
              <button className="btn btn-sm" onClick={() => setSelected(today)}>
                Today
              </button>
              <button className="icon-btn" title="Next" onClick={() => go(1)}>
                <ChevronRight />
              </button>
            </div>
            <div className="segmented">
              {MODES.map(([id, label]) => (
                <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode !== 'agenda' && (
            <div className={`calv-grid ${mode}`}>
              {names.map((n) => (
                <div key={n} className="calv-dow">
                  {n}
                </div>
              ))}
              {shown.map((iso) => cell(iso, mode === 'week' ? Infinity : CHIPS_IN_A_MONTH_CELL))}
            </div>
          )}

          {mode === 'agenda' && (
            <div className="calv-agenda">
              {agenda.map((iso) => (
                <div key={iso} className={`calv-agenda-day ${iso === today ? 'today' : ''}`}>
                  <div className="calv-agenda-head" onClick={() => openDay(iso)} title="Open this day's note">
                    <span className="calv-agenda-num">{dateOfIso(iso).getDate()}</span>
                    <span>{iso === today ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : formatDate(dateOfIso(iso), 'dddd')}</span>
                    <span className="faint">{formatDate(dateOfIso(iso), 'D MMMM')}</span>
                  </div>
                  {data(iso).tasks.map((t) => (
                    <TaskRow key={taskKey(t)} task={t} wsId={wsId} editing={editing?.key === taskKey(t)} onEdit={edit} />
                  ))}
                  {data(iso).notes.map((p) => (
                    <button key={p} className="calv-note" onClick={() => openNote(wsId, p)}>
                      <FileText /> {stripExt(basename(p))}
                    </button>
                  ))}
                  {!data(iso).tasks.length && !data(iso).notes.length && <div className="faint calv-empty">Nothing planned.</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {mode !== 'agenda' && (
          <aside className="calv-side">
            <DayPanel iso={selected} data={data(selected)} hasNote={hasNote(selected)} wsId={wsId} editingKey={editing?.key} onEdit={edit} edited={edited} />
          </aside>
        )}
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
