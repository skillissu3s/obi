import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FilePlus, FileText, Filter, PanelRight, Plus } from 'lucide-react'
import { addDays, addMonths, compareTasks, dateKeyOf, isIsoDate, isOpen, monthDays, taskDate, weekStartOf } from '@shared/tasks.js'
import { basename, isNote, stripExt } from '@shared/paths.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePlanner } from '../store/planner.js'
import { usePrefs } from '../store/prefs.js'
import * as A from '../lib/actions.js'
import { changeTasks, moveToDay, passes, taskKey, useCanEdit, useDayDrop, useFilter, useFilterCount, useTasks, useToday } from '../lib/planner.js'
import { dateOfIso, formatDate, timeAgo } from '../lib/util.js'
import { Popover } from './ui.jsx'
import { QuickAdd, TaskChip, TaskRow, dueClass } from './TaskParts.jsx'
import { TaskFilters } from './TaskFilters.jsx'
import { useTaskDialog } from './TaskDialog.jsx'
import { PAGE } from './TaskBoard.jsx'

const MODES = [
  ['month', 'Month'],
  ['week', 'Week'],
  ['agenda', 'Agenda'],
]
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const AGENDA_DAYS = 30
const CHIPS_IN_A_MONTH_CELL = 3

// the days a view shows
function daysOf(mode, selected, startDay) {
  if (mode === 'week') {
    const start = weekStartOf(selected, startDay)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }
  if (mode === 'agenda') return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(selected, i))
  return monthDays(selected, startDay)
}

// What each day holds: its tasks (on their due, else scheduled, else start day —
// a finished one with no date of its own, on the day it was finished) and the
// notes that say `date:` in their properties.
function useDays(model, filter) {
  return useMemo(() => {
    const days = new Map()
    const at = (d) => days.get(d) || days.set(d, { tasks: [], notes: [] }).get(d)
    for (const t of model.all) {
      const d = taskDate(t) || (isOpen(t.status) ? null : t.done || t.cancelled)
      if (d && passes(t, filter)) at(d).tasks.push(t)
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
  }, [model, filter])
}

const NONE = { tasks: [], notes: [] }
const openNote = (wsId, path) => useLayout.getState().openNote(wsId, path)

function Cell({ iso, today, selected, dim, data, hasNote, limit, wsId, canEdit, onSelect, onOpenDay, onOpen, onAdd }) {
  const { over, drop } = useDayDrop(iso)
  const shown = data.tasks.slice(0, limit)
  const more = data.tasks.length - shown.length
  const date = dateOfIso(iso)
  return (
    <div
      className={`calv-cell ${iso === today ? 'today' : ''} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${over ? 'over' : ''}`}
      role="group"
      aria-label={`${formatDate(date, 'dddd D MMMM')}${data.tasks.length ? `, ${data.tasks.length} tasks` : ''}`}
      onClick={() => onSelect(iso)}
      onDoubleClick={() => onOpenDay(iso)}
      {...(canEdit ? drop : {})}
    >
      <div className="calv-cell-head">
        <span className="calv-wd">{formatDate(date, 'ddd')}</span>
        <span className="calv-num">{date.getDate() === 1 ? formatDate(date, 'D MMM') : date.getDate()}</span>
        <span className="calv-dots" aria-hidden="true">
          {data.tasks.slice(0, 3).map((t) => (
            <i key={taskKey(t)} className={`${dueClass(t, today)} ${isOpen(t.status) ? '' : 'done'}`} />
          ))}
        </span>
        <span className="calv-actions">
          {canEdit && (
            <button type="button" className="calv-btn" title="Add a task for this day" aria-label="Add a task for this day" onClick={(e) => (e.stopPropagation(), onAdd(iso, e.currentTarget))}>
              <Plus />
            </button>
          )}
          <button
            type="button"
            className={`calv-btn ${hasNote ? 'has' : ''}`}
            title={hasNote ? "Open this day's note" : "Start this day's note"}
            aria-label={hasNote ? "Open this day's note" : "Start this day's note"}
            onClick={(e) => (e.stopPropagation(), onOpenDay(iso))}
          >
            {hasNote ? <FileText /> : <FilePlus />}
          </button>
        </span>
      </div>
      <div className="calv-items">
        {shown.map((t) => (
          <TaskChip key={taskKey(t)} task={t} today={today} canEdit={canEdit} onOpen={onOpen} />
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
function DayPanel({ iso, data, hasNote, wsId, today, canEdit, onOpen, edited, lists }) {
  const date = dateOfIso(iso)
  return (
    <>
      <div className="calv-side-head">
        <div>
          <div className="calv-side-day">{iso === today ? 'Today' : formatDate(date, 'dddd')}</div>
          <div className="calv-side-date">{formatDate(date, 'D MMMM YYYY')}</div>
        </div>
        <button className="btn btn-sm" onClick={() => A.openDailyNote(date, { announce: !hasNote })}>
          {hasNote ? (
            <>
              <FileText /> Open note
            </>
          ) : (
            <>
              <FilePlus /> Start the note
            </>
          )}
        </button>
      </div>
      {canEdit && <QuickAdd day={iso} />}
      <div className="calv-side-title">Tasks</div>
      {data.tasks.length ? (
        data.tasks.map((t) => <TaskRow key={taskKey(t)} task={t} today={today} ws={wsId} canEdit={canEdit} onOpen={onOpen} done={lists.get(taskKey(t))?.done} total={lists.get(taskKey(t))?.total} />)
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

// A task's way onto a day without dragging
function Reschedule({ task, today }) {
  return (
    <span className="pl-quick">
      <button type="button" className="te-quick" onClick={() => moveToDay(task, today)}>
        Today
      </button>
      <button type="button" className="te-quick" onClick={() => moveToDay(task, addDays(today, 1))}>
        Tomorrow
      </button>
    </span>
  )
}

// What still needs a day: the tasks that are overdue, and those with no date at
// all — the ones to drag onto the calendar.
function PlanPanel({ overdue, unscheduled, today, wsId, canEdit, onOpen, lists }) {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? unscheduled.filter((t) => t.text.toLowerCase().includes(needle) || t.path.toLowerCase().includes(needle)) : unscheduled
  }, [unscheduled, q])
  const row = (t) => (
    <TaskRow key={taskKey(t)} task={t} today={today} ws={wsId} canEdit={canEdit} onOpen={onOpen} done={lists.get(taskKey(t))?.done} total={lists.get(taskKey(t))?.total} actions={canEdit && <Reschedule task={t} today={today} />} />
  )
  return (
    <>
      <div className="calv-side-title danger">
        Overdue <span className="pl-count">{overdue.length}</span>
        {canEdit && overdue.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => changeTasks(overdue, (t) => ({ [dateKeyOf(t)]: today }), `Moved ${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'} to Today`)}
          >
            Move all to today
          </button>
        )}
      </div>
      {overdue.length ? overdue.slice(0, limit).map(row) : <div className="faint calv-empty">Nothing overdue.</div>}
      {overdue.length > limit && (
        <button type="button" className="pl-more" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, overdue.length - limit)} more
        </button>
      )}
      <div className="calv-side-title">
        Unscheduled <span className="pl-count">{unscheduled.length}</span>
      </div>
      <input className="input calv-tray-search" aria-label="Search unscheduled tasks" placeholder="Search unscheduled…" value={q} onChange={(e) => setQ(e.target.value)} />
      {matching.length ? matching.slice(0, limit).map(row) : <div className="faint calv-empty">{unscheduled.length ? 'No match.' : 'Everything has a day.'}</div>}
      {matching.length > limit && (
        <button type="button" className="pl-more" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, matching.length - limit)} more
        </button>
      )}
      {canEdit && unscheduled.length > 0 && <div className="rail-hint">Drag a task onto a day to schedule it.</div>}
    </>
  )
}

function AgendaDay({ iso, today, data, wsId, canEdit, onOpen, onOpenDay, lists }) {
  const { over, drop } = useDayDrop(iso)
  return (
    <div className={`calv-agenda-day ${iso === today ? 'today' : ''} ${over ? 'over' : ''}`} {...(canEdit ? drop : {})}>
      <div className="calv-agenda-head" onClick={() => onOpenDay(iso)} title="Open this day's note">
        <span className="calv-agenda-num">{dateOfIso(iso).getDate()}</span>
        <span>{iso === today ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : formatDate(dateOfIso(iso), 'dddd')}</span>
        <span className="faint">{formatDate(dateOfIso(iso), 'D MMMM')}</span>
      </div>
      {data.tasks.map((t) => (
        <TaskRow key={taskKey(t)} task={t} today={today} ws={wsId} canEdit={canEdit} onOpen={onOpen} done={lists.get(taskKey(t))?.done} total={lists.get(taskKey(t))?.total} />
      ))}
      {data.notes.map((p) => (
        <button key={p} className="calv-note" onClick={() => openNote(wsId, p)}>
          <FileText /> {stripExt(basename(p))}
        </button>
      ))}
      {!data.tasks.length && !data.notes.length && <div className="faint calv-empty">Nothing planned.</div>}
    </div>
  )
}

export function CalendarView() {
  const wsId = useApp((s) => s.wsId)
  const treeMap = useApp((s) => s.treeMap)
  const startDay = usePrefs((s) => (s.weekStart === 'sunday' ? 0 : 1))
  const mode = usePlanner((s) => s.mode)
  const side = usePlanner((s) => s.side)
  const panel = usePlanner((s) => s.panel)
  const set = usePlanner((s) => s.set)
  const model = useTasks()
  const filter = useFilter()
  const filters = useFilterCount()
  const canEdit = useCanEdit()
  const today = useToday()
  const { openTask, dialog } = useTaskDialog()
  const [selected, setSelected] = useState(today)
  const [filtering, setFiltering] = useState(null) // the Filter button, while its card is open
  const [adding, setAdding] = useState(null) // { iso, anchor }
  const days = useDays(model, filter)

  const shown = useMemo(() => daysOf(mode, selected, startDay), [mode, selected, startDay])
  const data = (iso) => days.get(iso) || NONE
  const hasNote = (iso) => treeMap.has(A.dailyNotePath(dateOfIso(iso)))
  const openDay = (iso) => A.openDailyNote(dateOfIso(iso), { announce: !hasNote(iso) })

  // the previous or next month, week or stretch of the agenda
  const go = (n) => setSelected((d) => (mode === 'month' ? addMonths(d, n) : addDays(d, n * (mode === 'week' ? 7 : 14))))

  // what has no day yet, and what has gone by
  const plan = useMemo(() => {
    const overdue = model.all.filter((t) => isOpen(t.status) && taskDate(t) && taskDate(t) < today && passes(t, filter)).sort(compareTasks)
    const unscheduled = model.cards.filter((t) => isOpen(t.status) && !taskDate(t) && passes(t, filter)).sort(compareTasks)
    return { overdue, unscheduled }
  }, [model, filter, today])

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
    if (e.defaultPrevented || e.target.closest('input, select, textarea, button')) return
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) setSelected((d) => addDays(d, step))
    else if (e.key === 'PageUp' || e.key === 'PageDown') go(e.key === 'PageUp' ? -1 : 1)
    else if (e.key === 'Enter') openDay(selected)
    else if (e.key === 't') setSelected(today)
    else return
    e.preventDefault()
  }

  // the Day panel is for a grid; the agenda already lists its days
  const tab = !panel ? null : mode === 'agenda' ? 'plan' : side
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
      canEdit={canEdit}
      onSelect={setSelected}
      onOpenDay={openDay}
      onOpen={openTask}
      onAdd={(day, anchor) => setAdding({ iso: day, anchor })}
    />
  )
  const agenda = shown.filter((d) => d === today || d === selected || data(d).tasks.length || data(d).notes.length)

  return (
    <div className="calv" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="calv-body">
        <div className="calv-main">
          <div className="calv-bar">
            <h2>{title}</h2>
            <div className="calv-nav">
              <button className="icon-btn" title="Previous" aria-label="Previous" onClick={() => go(-1)}>
                <ChevronLeft />
              </button>
              <button className="btn btn-sm" onClick={() => setSelected(today)}>
                Today
              </button>
              <button className="icon-btn" title="Next" aria-label="Next" onClick={() => go(1)}>
                <ChevronRight />
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Show as">
              {MODES.map(([id, label]) => (
                <button key={id} aria-pressed={mode === id} className={mode === id ? 'active' : ''} onClick={() => set({ mode: id })}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className={`btn btn-sm ${filters ? 'on' : ''}`} aria-expanded={!!filtering} onClick={(e) => setFiltering(filtering ? null : e.currentTarget)}>
              <Filter /> Filter {filters > 0 && <span className="badge accent">{filters}</span>}
            </button>
            <button type="button" className={`icon-btn ${panel ? 'active' : ''}`} title={panel ? 'Hide the side panel' : 'Show the side panel'} aria-label="Side panel" aria-pressed={panel} onClick={() => set({ panel: !panel })}>
              <PanelRight />
            </button>
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
                <AgendaDay key={iso} iso={iso} today={today} data={data(iso)} wsId={wsId} canEdit={canEdit} onOpen={openTask} onOpenDay={openDay} lists={model.lists} />
              ))}
            </div>
          )}
        </div>

        {tab && (
          <aside className="calv-side">
            {mode !== 'agenda' && (
              <div className="segmented calv-tabs" role="group" aria-label="Side panel">
                <button className={tab === 'day' ? 'active' : ''} aria-pressed={tab === 'day'} onClick={() => set({ side: 'day' })}>
                  Day
                </button>
                <button className={tab === 'plan' ? 'active' : ''} aria-pressed={tab === 'plan'} onClick={() => set({ side: 'plan' })}>
                  To plan {plan.overdue.length > 0 && <span className="badge danger">{plan.overdue.length}</span>}
                </button>
              </div>
            )}
            {tab === 'day' ? (
              <DayPanel iso={selected} data={data(selected)} hasNote={hasNote(selected)} wsId={wsId} today={today} canEdit={canEdit} onOpen={openTask} edited={edited} lists={model.lists} />
            ) : (
              <PlanPanel overdue={plan.overdue} unscheduled={plan.unscheduled} today={today} wsId={wsId} canEdit={canEdit} onOpen={openTask} lists={model.lists} />
            )}
          </aside>
        )}
      </div>

      {filtering && (
        <Popover anchor={filtering} onClose={() => setFiltering(null)} align="right" className="pl-filter-pop">
          <TaskFilters tags={model.tags} stacked />
        </Popover>
      )}
      {adding && (
        <Popover anchor={adding.anchor} onClose={() => setAdding(null)} align="left" className="pl-dayadd">
          <QuickAdd day={adding.iso} autoFocus />
        </Popover>
      )}
      {dialog}
    </div>
  )
}
