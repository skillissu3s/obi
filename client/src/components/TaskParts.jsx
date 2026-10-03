// The pieces of a task shown in a list: its box, its chips, and the editor that
// opens from it. Shared by the Tasks view and the calendar.
import { useEffect, useRef, useState } from 'react'
import { Flag, Hourglass, Play, Plus, Repeat, SlidersHorizontal, FileText } from 'lucide-react'
import { PRIORITIES, PRIORITY_EMOJI, addDays, isOpen, parseRecurrence, todayIso } from '@shared/tasks.js'
import { basename, stripExt } from '@shared/paths.js'
import { dateOfIso, dueLabel, formatDate } from '../lib/util.js'
import { renderInline } from '../lib/render.js'
import { useLayout } from '../store/layout.js'
import * as A from '../lib/actions.js'
import { Popover } from './ui.jsx'

export const taskKey = (t) => `${t.path}:${t.line}`

/** done ↔ open */
export const toggleTask = (task) => A.updateTask(task, { status: isOpen(task.status) ? 'x' : ' ' })

const PRIORITY_LABEL = { highest: 'Highest priority', high: 'High priority', medium: 'Medium priority', low: 'Low priority', lowest: 'Lowest priority' }

// The checkbox. In progress shows as a dash; cancelled as ticked and struck out.
export function TaskBox({ task }) {
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

// Everything about a task that isn't its words: priority, repeat, dates.
export function TaskMeta({ task }) {
  const today = todayIso()
  const open = isOpen(task.status)
  return (
    <>
      {task.priority && (
        <span className={`task-pri pri-${task.priority}`} title={PRIORITY_LABEL[task.priority]}>
          <Flag />
        </span>
      )}
      {task.recurrence && (
        <span className="task-chip" title={`Repeats: ${task.recurrence}`}>
          <Repeat />
          {task.recurrence.replace(/^every /, '')}
        </span>
      )}
      {task.start && open && task.start > today && (
        <span className="task-chip" title={`Starts ${task.start}`}>
          <Play />
          {dueLabel(task.start)}
        </span>
      )}
      {task.scheduled && open && (
        <span className="task-chip" title={`Scheduled ${task.scheduled}`}>
          <Hourglass />
          {dueLabel(task.scheduled)}
        </span>
      )}
      {task.due && (
        <span className={`due-chip ${dueClass(task, today)}`} title={`Due ${task.due}`}>
          {dueLabel(task.due)}
        </span>
      )}
    </>
  )
}

const STATUSES = [
  [' ', 'To do'],
  ['/', 'Doing'],
  ['x', 'Done'],
  ['-', 'Cancelled'],
]
const REPEATS = [
  ['', 'Does not repeat'],
  ['every day', 'Every day'],
  ['every weekday', 'Every weekday'],
  ['every week', 'Every week'],
  ['every 2 weeks', 'Every 2 weeks'],
  ['every month', 'Every month'],
  ['every year', 'Every year'],
]

function Field({ label, children }) {
  return (
    <div className="te-row">
      <div className="te-label">{label}</div>
      <div className="te-body">{children}</div>
    </div>
  )
}

function DateField({ value, onChange, quick }) {
  return (
    <div className="te-date">
      <input type="date" className="input" value={value || ''} onChange={(e) => onChange(e.target.value || null)} />
      {quick?.map(([label, to]) => (
        <button key={label} className="te-quick" onClick={() => onChange(to)}>
          {label}
        </button>
      ))}
      {value && (
        <button className="te-quick" onClick={() => onChange(null)} title="Clear the date">
          Clear
        </button>
      )}
    </div>
  )
}

/**
 * Everything about a task in one card, each change written straight to its
 * line. `task` is the live task from the index, so the card follows the note.
 */
export function TaskEditor({ task, anchor, onClose, onOpenNote }) {
  const today = todayIso()
  const [custom, setCustom] = useState(false)
  const change = (patch) => A.updateTask(task, patch)
  const rule = task.recurrence || ''
  const whenDone = / when done$/i.test(rule)
  const base = rule.replace(/ when done$/i, '')
  const preset = REPEATS.some(([v]) => v === base.toLowerCase())
  const quick = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['Next week', addDays(today, 7)],
  ]

  return (
    <Popover anchor={anchor} onClose={onClose} align="right" className="task-pop">
      <input
        key={task.text}
        className="te-title"
        defaultValue={task.text}
        placeholder="What needs doing?"
        aria-label="Task"
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => {
          const title = e.target.value.trim()
          if (!title) e.target.value = task.text
          else if (title !== task.text) change({ title })
        }}
      />
      <Field label="Status">
        <div className="te-seg">
          {STATUSES.map(([v, label]) => (
            <button key={v} className={task.status === v || (v === 'x' && task.status === 'X') ? 'active' : ''} onClick={() => task.status !== v && change({ status: v })}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Priority">
        <div className="te-seg">
          <button className={!task.priority ? 'active' : ''} onClick={() => change({ priority: null })}>
            None
          </button>
          {PRIORITIES.map((p) => (
            <button key={p} className={task.priority === p ? 'active' : ''} title={PRIORITY_LABEL[p]} onClick={() => change({ priority: p })}>
              {PRIORITY_EMOJI[p]}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Due">
        <DateField value={task.due} onChange={(v) => change({ due: v })} quick={quick} />
      </Field>
      <Field label="Scheduled">
        <DateField value={task.scheduled} onChange={(v) => change({ scheduled: v })} />
      </Field>
      <Field label="Starts">
        <DateField value={task.start} onChange={(v) => change({ start: v })} />
      </Field>
      <Field label="Repeat">
        <select
          className="input"
          value={custom || (base && !preset) ? '__custom' : base.toLowerCase()}
          onChange={(e) => {
            if (e.target.value === '__custom') return setCustom(true)
            setCustom(false)
            change({ recurrence: e.target.value ? e.target.value + (whenDone ? ' when done' : '') : null })
          }}
        >
          {REPEATS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
          <option value="__custom">Custom…</option>
        </select>
        {(custom || (base && !preset)) && (
          <input
            className="input"
            placeholder="every 3 days, every monday and friday…"
            defaultValue={base}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== base && parseRecurrence(v)) change({ recurrence: v + (whenDone ? ' when done' : '') })
            }}
          />
        )}
        {task.recurrence && (
          <label className="te-check" title="Count the next one from the day this is done, not from its date">
            <input type="checkbox" checked={whenDone} onChange={(e) => change({ recurrence: base + (e.target.checked ? ' when done' : '') })} />
            Count from when it's done
          </label>
        )}
      </Field>
      <button className="te-open" onClick={onOpenNote}>
        <FileText /> {stripExt(basename(task.path))}
        <span className="faint"> · line {task.line + 1}</span>
      </button>
    </Popover>
  )
}

/** The little button on a row that opens its editor */
export function EditButton({ onClick, active }) {
  return (
    <button className={`task-edit ${active ? 'on' : ''}`} title="Edit this task" aria-label="Edit this task" onClick={onClick}>
      <SlidersHorizontal />
    </button>
  )
}

/**
 * Adds a task: its words, and a day and a priority if you like. Without `day`
 * it goes in today's note; with one, in that day's note, due that day.
 */
export function QuickAdd({ day = null }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const today = todayIso()
  const tomorrow = addDays(today, 1)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    const r = await A.addTask({ title, day: day || undefined, due: day || due || undefined, priority: priority || undefined })
    setBusy(false)
    if (r) {
      setTitle('')
      setDue('')
      setPriority('')
    }
    input.current?.focus()
  }

  return (
    <div className="task-add">
      <Plus />
      <input
        ref={input}
        className="task-add-input"
        placeholder={day ? `Add a task for ${formatDate(dateOfIso(day), 'ddd D MMM')}…` : "Add a task to today's note…"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {title.trim() && (
        <>
          {!day && (
            <>
              <button className={`te-quick ${due === today ? 'on' : ''}`} onClick={() => setDue(due === today ? '' : today)}>
                Today
              </button>
              <button className={`te-quick ${due === tomorrow ? 'on' : ''}`} onClick={() => setDue(due === tomorrow ? '' : tomorrow)}>
                Tomorrow
              </button>
              <input type="date" className="input task-add-date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date" />
            </>
          )}
          <select className="input task-add-pri" value={priority} onChange={(e) => setPriority(e.target.value)} title="Priority">
            <option value="">Priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_EMOJI[p]} {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>
            Add
          </button>
        </>
      )}
    </div>
  )
}

/** One task in a list: box, words, what is set on it, where it is, and its editor button */
export function TaskRow({ task, wsId, showSource = true, depth = 0, onTag, onEdit, editing, onDragStart }) {
  const open = isOpen(task.status)
  const openAtLine = () => useLayout.getState().openNote(wsId, task.path, { line: task.line })
  return (
    <div
      className={`task-row ${!open ? 'done' : ''} ${task.status === '-' ? 'cancelled' : ''}`}
      style={depth ? { paddingLeft: 8 + depth * 22 } : undefined}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
    >
      <TaskBox task={task} />
      <div
        className="task-text"
        title="Open this line in its note"
        onClick={(e) => {
          const a = e.target.closest('a')
          // a #tag in the words filters a list that can; any other link is its own
          if (a?.classList.contains('tag')) {
            if (onTag) {
              e.preventDefault()
              onTag(a.dataset.tag)
            }
          } else if (!a) openAtLine()
        }}
        dangerouslySetInnerHTML={{ __html: renderInline(task.text, { ws: wsId, path: task.path }) }}
      />
      <div className="task-meta">
        <TaskMeta task={task} />
      </div>
      {showSource && (
        /* the icon matters: a daily note is called "2026-09-17", which without it
           reads like a due date sitting in the same row as the real ones */
        <span className="task-source" title={task.path} onClick={openAtLine}>
          <FileText />
          {stripExt(basename(task.path))}
        </span>
      )}
      <EditButton active={editing} onClick={(e) => onEdit(task, e.currentTarget)} />
    </div>
  )
}
