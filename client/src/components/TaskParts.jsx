// The pieces of a task shown on the Tasks and Calendar pages: its box, its chips,
// and the card, row and chip they are put together in. The dialog that opens
// from any of them is in TaskDialog.jsx.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, CalendarDays, CheckCircle2, Circle, ExternalLink, FileText, Flag, Hourglass, ListChecks, Pencil, Play, Plus, Repeat, Trash2, X } from 'lucide-react'
import { PRIORITIES, addDays, isOpen, parseQuickAdd, splitTags, todayIso, weekStartOf } from '@shared/tasks.js'
import { basename, stripExt } from '@shared/paths.js'
import { colorFor, dateOfIso, dueLabel, formatDate } from '../lib/util.js'
import { renderInline } from '../lib/render.js'
import { plainTitle, startDrag, toggleTag } from '../lib/planner.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { useUI } from '../store/ui.js'
import * as A from '../lib/actions.js'

/** done ↔ open */
export const toggleTask = (task) => A.updateTask(task, { status: isOpen(task.status) ? 'x' : ' ' })

export const PRIORITY_LABEL = { highest: 'Highest priority', high: 'High priority', medium: 'Medium priority', low: 'Low priority', lowest: 'Lowest priority' }

/** Right-click on a task: the changes made most often, without opening it */
export function taskMenu(e, task, { ws, canEdit, onOpen }) {
  if (e.target.closest('input, textarea, a')) return
  const today = todayIso()
  const nextWeek = weekStartOf(addDays(today, 7), 1)
  const open = isOpen(task.status)
  const set = (patch) => () => A.updateTask(task, patch)
  const mark = (yes) => (yes ? CheckCircle2 : undefined)
  const edits = canEdit
    ? [
        'divider',
        { label: open ? 'Mark done' : 'Reopen', icon: open ? CheckCircle2 : Circle, hint: 'Space', run: () => toggleTask(task) },
        open && task.status !== '/' && { label: 'Start (in progress)', icon: Play, run: set({ status: '/' }) },
        { section: 'Due' },
        { label: 'Today', icon: mark(task.due === today), run: set({ due: today }) },
        { label: 'Tomorrow', icon: mark(task.due === addDays(today, 1)), run: set({ due: addDays(today, 1) }) },
        { label: 'Next week', icon: mark(task.due === nextWeek), run: set({ due: nextWeek }) },
        task.due && { label: 'No due date', icon: X, run: set({ due: null }) },
        { section: 'Priority' },
        ...['high', 'medium', 'low'].map((p) => ({ label: p[0].toUpperCase() + p.slice(1), icon: task.priority === p ? CheckCircle2 : Flag, run: set({ priority: p }) })),
        task.priority && { label: 'No priority', icon: X, run: set({ priority: null }) },
        'divider',
        { label: 'Delete task', icon: Trash2, danger: true, hint: 'Del', run: () => A.deleteTask(task) },
      ]
    : []
  useUI.getState().showContextMenu(e, [
    { label: 'Open task', icon: Pencil, hint: 'Enter', run: () => onOpen(task) },
    { label: 'Open in note', icon: ExternalLink, run: () => useLayout.getState().openNote(ws, task.path, { line: task.line }) },
    ...edits,
  ])
}

// ---------- typing a task in plain words ----------

const FOUND_ICON = { due: CalendarDays, priority: Flag, recurrence: Repeat }
const KIND_ORDER = ['due', 'priority', 'recurrence']
const foundLabel = (f) => (f.kind === 'due' ? dueLabel(f.value) : f.kind === 'priority' ? PRIORITY_LABEL[f.value] : f.value[0].toUpperCase() + f.value.slice(1))

/** What a task typed in plain words says (parseQuickAdd in shared/tasks.js), and a way to keep a phrase as words */
export function useQuickParse(text, today = todayIso()) {
  const [ignore, setIgnore] = useState([])
  const parsed = useMemo(() => parseQuickAdd(text, { today, ignore }), [text, today, ignore])
  // a new task starts with nothing set aside
  useEffect(() => {
    if (!text.trim() && ignore.length) setIgnore([])
  }, [text, ignore.length])
  return { parsed, keep: (words) => setIgnore((l) => [...l, words]) }
}

/** A chip for each phrase that was understood; its × keeps the phrase as words */
export function ParsedChips({ found, onKeep }) {
  if (!found.length) return null
  return (
    <div className="qa-chips" aria-live="polite">
      {[...found].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).map((f) => {
        const Icon = FOUND_ICON[f.kind]
        return (
          <span key={f.kind} className={`qa-chip qa-${f.kind} ${f.kind === 'priority' ? `pri-${f.value}` : ''}`} title={`From “${f.text}”`}>
            <Icon />
            {foundLabel(f)}
            <button type="button" aria-label={`Keep “${f.text}” as words`} title={`Keep “${f.text}” as words`} onMouseDown={(e) => e.preventDefault()} onClick={() => onKeep(f.text)}>
              <X />
            </button>
          </span>
        )
      })}
    </div>
  )
}

// The checkbox. In progress shows as a dash; cancelled as ticked and struck out.
export function TaskBox({ task, disabled }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = task.status === '/'
  }, [task.status])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="task-cb"
      checked={!isOpen(task.status)}
      disabled={disabled}
      aria-label={isOpen(task.status) ? 'Mark done' : 'Reopen'}
      title={task.status === '/' ? 'In progress — click to finish' : task.status === '-' ? 'Cancelled — click to reopen' : undefined}
      onChange={() => toggleTask(task)}
    />
  )
}

export function dueClass(task, today = todayIso()) {
  const d = task.due
  if (!d || !isOpen(task.status)) return ''
  return d < today ? 'overdue' : d === today ? 'today' : ''
}

/** A tag, in the same colour wherever it is (a subtag shares its tag's) */
export function TagChip({ tag, count, on, onClick }) {
  return (
    <button type="button" className={`pl-tag ${on ? 'on' : ''}`} style={{ '--tag': colorFor(tag.split('/')[0].toLowerCase()) }} title={`Show only #${tag}`} aria-pressed={on} onClick={onClick}>
      #{tag}
      {count != null && <small>{count}</small>}
    </button>
  )
}

// Everything about a task that isn't its words: priority, dates, repeat.
export function TaskMeta({ task, today }) {
  const open = isOpen(task.status)
  return (
    <>
      {task.priority && (
        <span className={`task-pri pri-${task.priority}`} title={PRIORITY_LABEL[task.priority]}>
          <Flag />
        </span>
      )}
      {task.due && (
        <span className={`due-chip ${dueClass(task, today)}`} title={`Due ${task.due}`}>
          <CalendarDays />
          {dueLabel(task.due)}
        </span>
      )}
      {task.scheduled && open && (
        <span className="task-chip" title={`Scheduled ${task.scheduled}`}>
          <Hourglass />
          {dueLabel(task.scheduled)}
        </span>
      )}
      {task.start && open && task.start > today && (
        <span className="task-chip" title={`Starts ${task.start}`}>
          <Play />
          {dueLabel(task.start)}
        </span>
      )}
      {task.recurrence && (
        <span className="task-chip" title={`Repeats: ${task.recurrence}`}>
          <Repeat />
          {task.recurrence.replace(/^every /, '')}
        </span>
      )}
    </>
  )
}

// The note a task is written in; the icon matters: a daily note is called
// "2026-09-17", which without it reads like a due date sitting among the real ones
function Source({ task, ws }) {
  return (
    <button
      type="button"
      className="task-source"
      title={`Open ${task.path}`}
      onClick={(e) => {
        e.stopPropagation()
        useLayout.getState().openNote(ws, task.path, { line: task.line })
      }}
    >
      <FileText />
      {stripExt(basename(task.path))}
    </button>
  )
}

// A task's words as HTML. Regrouping a board draws the same words again, so they
// are kept until the index next changes (what a link points to may have).
let drawn = new Map()
let drawnAt = -1
function wordsHtml(text, ws, path) {
  const version = useApp.getState().version
  if (version !== drawnAt) [drawn, drawnAt] = [new Map(), version]
  const key = `${ws}\0${path}\0${text}`
  return drawn.get(key) ?? drawn.set(key, renderInline(text, { ws, path })).get(key)
}

// A click on the words of a task that lands on a link: a #tag filters, a note's
// link opens it. Says whether it was on a link.
function onLink(e, task, ws) {
  const a = e.target.closest('a')
  if (a?.classList.contains('tag')) {
    e.preventDefault()
    toggleTag(a.dataset.tag)
  } else if (a?.dataset.href) {
    e.preventDefault()
    A.openLink(ws, task.path, a.dataset.href, {})
  }
  return !!a
}

/**
 * A task on the keyboard, when the card or row itself has focus (not something in it):
 * Enter opens it, Space ticks it off, Delete deletes it (with Undo).
 */
const openOnKey = (e, task, onOpen, canEdit) => {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter') {
    e.preventDefault()
    onOpen(task)
  } else if (e.key === ' ' && canEdit) {
    e.preventDefault()
    toggleTask(task)
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
    e.preventDefault()
    A.deleteTask(task)
  }
}

const aboutTask = (task, today) => `${plainTitle(task)}${task.due ? `, due ${dueLabel(task.due)}` : ''}${task.due && task.due < today && isOpen(task.status) ? ' (overdue)' : ''}`

/** A task as a card on a board: words, tags, dates and the checklist's progress */
export const TaskCard = memo(function TaskCard({ task, today, ws, canEdit, onOpen, done = 0, total = 0 }) {
  const [lifted, setLifted] = useState(false)
  const open = isOpen(task.status)
  const tags = [...new Map((task.tags || []).map((t) => [t.toLowerCase(), t])).values()]
  return (
    <article
      className={`pl-card ${open ? '' : 'done'} ${task.status === '-' ? 'cancelled' : ''} ${lifted ? 'lifted' : ''}`}
      data-pri={task.priority}
      tabIndex={0}
      aria-label={aboutTask(task, today)}
      draggable={canEdit}
      onDragStart={(e) => {
        startDrag(e, task)
        setTimeout(() => setLifted(true))
      }}
      onDragEnd={() => setLifted(false)}
      onClick={(e) => !e.target.closest('input, button, a') && onOpen(task)}
      onKeyDown={(e) => openOnKey(e, task, onOpen, canEdit)}
      onContextMenu={(e) => taskMenu(e, task, { ws, canEdit, onOpen })}
    >
      <div className="pl-card-top">
        <TaskBox task={task} disabled={!canEdit} />
        <div className="pl-card-title" onClick={(e) => onLink(e, task, ws)} dangerouslySetInnerHTML={{ __html: wordsHtml(splitTags(task.text).title, ws, task.path) }} />
        <button type="button" className="pl-edit" aria-label="Edit task" title="Edit task" onClick={() => onOpen(task)}>
          <Pencil />
        </button>
      </div>
      {tags.length > 0 && (
        <div className="pl-tags">
          {tags.map((t) => (
            <TagChip key={t} tag={t} onClick={() => toggleTag(t)} />
          ))}
        </div>
      )}
      <div className="pl-card-foot">
        <TaskMeta task={task} today={today} />
        {task.status === '-' && (
          <span className="task-chip">
            <Ban />
            Cancelled
          </span>
        )}
        {total > 0 && (
          <span className={`task-chip pl-sub ${done === total ? 'full' : ''}`} title={`${done} of ${total} subtasks done`}>
            <ListChecks />
            {done}/{total}
          </span>
        )}
        <Source task={task} ws={ws} />
      </div>
      {total > 0 && (
        <div className="pl-progress" role="progressbar" aria-label="Subtasks done" aria-valuenow={done} aria-valuemax={total}>
          <i style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
    </article>
  )
})

/** A task as one line on a calendar day: priority bar, box, words */
export const TaskChip = memo(function TaskChip({ task, today, canEdit, onOpen }) {
  return (
    <div
      className={`pl-chip ${isOpen(task.status) ? '' : 'done'} ${task.status === '-' ? 'cancelled' : ''} ${dueClass(task, today)}`}
      data-pri={task.priority}
      tabIndex={0}
      title={task.text}
      draggable={canEdit}
      onDragStart={(e) => startDrag(e, task)}
      onClick={(e) => {
        e.stopPropagation()
        if (!e.target.closest('input')) onOpen(task)
      }}
      onKeyDown={(e) => openOnKey(e, task, onOpen, canEdit)}
      onContextMenu={(e) => taskMenu(e, task, { ws: useApp.getState().wsId, canEdit, onOpen })}
    >
      <TaskBox task={task} disabled={!canEdit} />
      <span className="pl-chip-text">{plainTitle(task)}</span>
    </div>
  )
})

/** A task as a row of a list: box, words, tags, what is set on it, where it is */
export const TaskRow = memo(function TaskRow({ task, today, ws, canEdit, onOpen, done = 0, total = 0, showSource = true, depth = 0, actions = null }) {
  const { title, tags } = splitTags(task.text)
  return (
    <div
      className={`pl-row ${isOpen(task.status) ? '' : 'done'} ${task.status === '-' ? 'cancelled' : ''}`}
      role="group"
      data-pri={task.priority}
      style={depth ? { paddingLeft: 10 + depth * 22 } : undefined}
      tabIndex={0}
      aria-label={aboutTask(task, today)}
      draggable={canEdit}
      onDragStart={(e) => startDrag(e, task)}
      onKeyDown={(e) => openOnKey(e, task, onOpen, canEdit)}
      onContextMenu={(e) => taskMenu(e, task, { ws, canEdit, onOpen })}
    >
      <TaskBox task={task} disabled={!canEdit} />
      <div className="pl-row-main">
        <span className="task-text" title="Open this task" onClick={(e) => onLink(e, task, ws) || onOpen(task)} dangerouslySetInnerHTML={{ __html: wordsHtml(title, ws, task.path) }} />
        {tags.map((t) => (
          <TagChip key={t} tag={t} onClick={() => toggleTag(t)} />
        ))}
      </div>
      <div className="task-meta">
        <TaskMeta task={task} today={today} />
        {total > 0 && (
          <span className={`task-chip pl-sub ${done === total ? 'full' : ''}`} title={`${done} of ${total} subtasks done`}>
            <ListChecks />
            {done}/{total}
          </span>
        )}
        {showSource && <Source task={task} ws={ws} />}
        {actions}
      </div>
      <button type="button" className="pl-edit" aria-label="Edit task" title="Edit task" onClick={() => onOpen(task)}>
        <Pencil />
      </button>
    </div>
  )
})

/**
 * Adds a task: its words, and a day and a priority if you like — typed ("Call Sam
 * tomorrow !high every week") or picked. Without `day` it goes in today's note;
 * with one, in that day's note, due that day unless another date was typed.
 */
export function QuickAdd({ day = null, autoFocus = false }) {
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const today = todayIso()
  const tomorrow = addDays(today, 1)
  const { parsed, keep } = useQuickParse(text, today)
  // what is picked wins over what is typed
  const when = due || parsed.due || ''
  const pri = priority || parsed.priority || ''

  const submit = async () => {
    if (!parsed.title || busy) return
    setBusy(true)
    const r = await A.addTask({ title: parsed.title, day: day || undefined, due: when || day || undefined, priority: pri || undefined, recurrence: parsed.recurrence || undefined })
    setBusy(false)
    if (r) {
      setText('')
      setDue('')
      setPriority('')
    }
    input.current?.focus()
  }

  return (
    <div className="task-add-wrap">
      <div className="task-add">
        <Plus />
        <input
          ref={input}
          className="task-add-input"
          autoFocus={autoFocus}
          aria-label="New task"
          placeholder={day ? `Add a task for ${formatDate(dateOfIso(day), 'ddd D MMM')}…` : 'Add a task… try “Call Sam tomorrow !high”'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape' && text) {
              e.stopPropagation()
              setText('')
            }
          }}
        />
        {text.trim() && (
          <>
            {!day && (
              <>
                <button type="button" className={`te-quick ${when === today ? 'on' : ''}`} onClick={() => setDue(when === today ? '' : today)}>
                  Today
                </button>
                <button type="button" className={`te-quick ${when === tomorrow ? 'on' : ''}`} onClick={() => setDue(when === tomorrow ? '' : tomorrow)}>
                  Tomorrow
                </button>
                <input type="date" className="input task-add-date" value={when} onChange={(e) => setDue(e.target.value)} title="Due date" aria-label="Due date" />
              </>
            )}
            <select className="input task-add-pri" value={pri} onChange={(e) => setPriority(e.target.value)} title="Priority" aria-label="Priority">
              <option value="">Priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !parsed.title} onClick={submit}>
              Add
            </button>
          </>
        )}
      </div>
      {text.trim() && <ParsedChips found={parsed.found.filter((f) => !(f.kind === 'due' && due) && !(f.kind === 'priority' && priority))} onKeep={keep} />}
    </div>
  )
}
