// The Tasks page: every task in the workspace as a board (a column for each
// status, day or priority) or a list, with the filters and the Schedule beside it.
import { useMemo, useState } from 'react'
import { CalendarDays, LayoutGrid, List as ListIcon, ListChecks } from 'lucide-react'
import { BOARD_GROUPS, boardColumns, columnOf, compareFinished, compareTasks, isOpen, taskDate } from '@shared/tasks.js'
import { basename, dirname, stripExt } from '@shared/paths.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePlanner } from '../store/planner.js'
import { clearFilters, passes, taskKey, useCanEdit, useFilter, useFilterCount, useTasks, useToday, useWide } from '../lib/planner.js'
import { QuickAdd, TaskRow } from './TaskParts.jsx'
import { TaskFilters } from './TaskFilters.jsx'
import { TaskBoard, PAGE } from './TaskBoard.jsx'
import { ScheduleRail } from './ScheduleRail.jsx'
import { useTaskDialog } from './TaskDialog.jsx'

function Section({ section, lists, depths, today, ws, canEdit, onOpen }) {
  const [limit, setLimit] = useState(PAGE)
  const { tasks } = section
  return (
    <section className="pl-section" data-col={section.id}>
      <h3 className="pl-section-head">
        {section.path ? (
          <button type="button" className="pl-section-link" onClick={() => useLayout.getState().openNote(ws, section.path)}>
            {section.label} <span className="faint">{dirname(section.path)}</span>
          </button>
        ) : (
          <>
            <span className="pl-dot" />
            {section.label}
          </>
        )}
        <span className="pl-count">{tasks.length}</span>
      </h3>
      <div className="pl-rows">
        {tasks.slice(0, limit).map((t) => {
          const list = lists.get(taskKey(t))
          return <TaskRow key={taskKey(t)} task={t} today={today} ws={ws} canEdit={canEdit} onOpen={onOpen} done={list?.done} total={list?.total} showSource={!section.path} depth={section.path ? depths.get(taskKey(t)) : 0} />
        })}
      </div>
      {tasks.length > limit && (
        <button type="button" className="pl-more" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, tasks.length - limit)} more
        </button>
      )}
    </section>
  )
}

function TaskList({ cards, tasks, model, group, done, today, ws, canEdit, onOpen }) {
  const sections = useMemo(() => {
    if (group === 'note') {
      // all of a note's tasks, in the order they are written, so subtasks follow their parents
      const byNote = new Map()
      for (const t of tasks) (byNote.get(t.path) ?? byNote.set(t.path, []).get(t.path)).push(t)
      return [...byNote]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, list]) => ({ id: path, path, label: stripExt(basename(path)), tasks: list.sort((a, b) => a.line - b.line) }))
    }
    const columns = new Map(boardColumns(group, { done }).map((c) => [c.id, { ...c, tasks: [] }]))
    for (const t of cards) columns.get(columnOf(t, group, today))?.tasks.push(t)
    return [...columns.values()].filter((s) => s.tasks.length).map((s) => ({ ...s, tasks: s.tasks.sort(s.id === 'done' ? compareFinished : compareTasks) }))
  }, [cards, tasks, group, done, today])
  return sections.map((s) => <Section key={`${group}:${s.id}`} section={s} lists={model.lists} depths={model.depths} today={today} ws={ws} canEdit={canEdit} onOpen={onOpen} />)
}

export function TasksView() {
  const model = useTasks()
  const today = useToday()
  const canEdit = useCanEdit()
  const ws = useApp((s) => s.wsId)
  const view = usePlanner((s) => s.view)
  const stored = usePlanner((s) => s.group)
  const done = usePlanner((s) => s.done)
  const set = usePlanner((s) => s.set)
  const [root, wide] = useWide(1180)
  const rail = usePlanner((s) => s.rail) ?? wide // the Schedule is there when asked for, or when there is room
  const filter = useFilter()
  const filters = useFilterCount()
  const { openTask, dialog } = useTaskDialog()
  const group = view === 'board' && stored === 'note' ? 'date' : stored // (a board can't be grouped by note)

  const cards = useMemo(() => model.cards.filter((t) => passes(t, filter)), [model, filter])
  const tasks = useMemo(() => model.all.filter((t) => passes(t, filter)), [model, filter])
  // what is due on each day, for the Schedule
  const byDay = useMemo(() => {
    const out = new Map()
    for (const t of tasks) {
      const day = isOpen(t.status) && taskDate(t)
      if (day) (out.get(day) ?? out.set(day, []).get(day)).push(t)
    }
    for (const list of out.values()) list.sort(compareTasks)
    return out
  }, [tasks])
  const counts = useMemo(() => {
    const open = model.cards.filter((t) => isOpen(t.status))
    return { open: open.length, overdue: open.filter((t) => taskDate(t) && taskDate(t) < today).length, done: model.cards.length - open.length }
  }, [model, today])

  return (
    <div className="tasks-view pl" ref={root}>
      <header className="pl-head">
        <h2>Tasks</h2>
        <span className="badge">{counts.open} open</span>
        {counts.overdue > 0 && <span className="badge danger">{counts.overdue} overdue</span>}
        <span className="badge success">{counts.done} done</span>
        <div className="pl-tools">
          <div className="segmented" role="group" aria-label="Show as">
            <button type="button" className={view === 'board' ? 'active' : ''} aria-pressed={view === 'board'} onClick={() => set({ view: 'board' })}>
              <LayoutGrid /> Board
            </button>
            <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => set({ view: 'list' })}>
              <ListIcon /> List
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Group by">
            {[...BOARD_GROUPS, ...(view === 'list' ? [{ id: 'note', label: 'Note' }] : [])].map((g) => (
              <button key={g.id} type="button" className={group === g.id ? 'active' : ''} aria-pressed={group === g.id} onClick={() => set({ group: g.id })}>
                {g.label}
              </button>
            ))}
          </div>
          <button type="button" className={`btn btn-sm ${rail ? 'on' : ''}`} aria-pressed={rail} title="Schedule: a month to drop cards on" onClick={() => set({ rail: !rail })}>
            <CalendarDays /> Schedule
          </button>
        </div>
      </header>
      <TaskFilters tags={model.tags} />

      <div className="pl-main">
        {view === 'board' ? (
          <TaskBoard cards={cards} lists={model.lists} group={group} done={done} today={today} ws={ws} canEdit={canEdit} onOpen={openTask} />
        ) : (
          <div className="pl-list">
            {canEdit && <QuickAdd />}
            <TaskList cards={cards} tasks={tasks} model={model} group={group} done={done} today={today} ws={ws} canEdit={canEdit} onOpen={openTask} />
            {!cards.length && (
              <div className="empty">
                <ListChecks />
                {filters ? (
                  <>
                    No tasks match.{' '}
                    <button type="button" className="btn btn-sm" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    No tasks yet. Add one above, or write <span className="code-inline">- [ ] something</span> in any note.
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {rail && <ScheduleRail byDay={byDay} today={today} canEdit={canEdit} onOpen={openTask} onHide={() => set({ rail: false })} />}
      </div>
      {dialog}
    </div>
  )
}
