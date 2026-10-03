// The pieces of a task shown in a list: its box, its chips, and the editor that
// opens from it. Shared by the Tasks view and the calendar.
import { useEffect, useRef, useState } from 'react'
import { Flag, Hourglass, Play, Repeat, SlidersHorizontal, FileText } from 'lucide-react'
import { PRIORITIES, PRIORITY_EMOJI, addDays, isOpen, parseRecurrence, todayIso } from '@shared/tasks.js'
import { basename, stripExt } from '@shared/paths.js'
import { dueLabel } from '../lib/util.js'
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
