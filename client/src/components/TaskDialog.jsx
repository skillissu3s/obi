// Everything about one task in one dialog, each change written straight to its
// line. Opened from a card, a row or a chip on either page; it looks like a
// project's card opened on its board (CardDialog), and shares its styles.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Flag, FileText, ListChecks, Plus, SquareKanban, Trash2, X } from 'lucide-react'
import { PRIORITIES, addDays, checklistOf, cleanTag, isIsoDate, isOpen, joinTags, parseRecurrence, splitTags } from '@shared/tasks.js'
import { basename, stripExt } from '@shared/paths.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import * as A from '../lib/actions.js'
import { taskKey, useCanEdit, useTasks, useToday } from '../lib/planner.js'
import { cardLook, listsOf, placeOf } from '../lib/projects.js'
import { colorHex } from '../lib/colors.js'
import { Modal } from './ui.jsx'
import { PRIORITY_LABEL, TaskBox, TaskMeta } from './TaskParts.jsx'
import { Label, StatusIcon, dueTone } from './CardParts.jsx'
import { LinkSuggest } from './LinkSuggest.jsx'

const STATUSES = [
  [' ', 'To do'],
  ['/', 'Doing'],
  ['x', 'Done'],
  ['-', 'Cancelled'],
]
export const REPEATS = [
  ['', 'Does not repeat'],
  ['every day', 'Every day'],
  ['every weekday', 'Every weekday'],
  ['every week', 'Every week'],
  ['every 2 weeks', 'Every 2 weeks'],
  ['every month', 'Every month'],
  ['every year', 'Every year'],
]

/**
 * `openTask(task)` opens the dialog for a task, and `dialog` is where it shows;
 * focus goes back to where it was when it closes.
 */
export function useTaskDialog() {
  const [at, setAt] = useState(null) // { path, line, text }: where the task was last seen
  const from = useRef(null)
  const openTask = useCallback((task) => {
    from.current = document.activeElement
    setAt({ path: task.path, line: task.line, text: task.text })
  }, [])
  const close = useCallback(() => {
    setAt(null)
    if (from.current?.isConnected) from.current.focus()
  }, [])
  return { openTask, dialog: at && <TaskDialog key={`${at.path}:${at.line}`} at={at} onClose={close} /> }
}

// The task the dialog was opened on, wherever the note has put it since: the
// same words on that line, else the same words nearest to it, else that line
function locate(model, { path, line, text }) {
  const tasks = model.byPath.get(path) || []
  const same = tasks.filter((t) => t.text === text)
  return same.find((t) => t.line === line) || same.sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0] || tasks.find((t) => t.line === line) || null
}

function Field({ label, children, wide }) {
  return (
    <div className={`cd-field ${wide ? 'wide' : ''}`}>
      <div className="td-label">{label}</div>
      {children}
    </div>
  )
}

// A date typed into a date input goes through every state on the way: a year of
// one digit, a day missing. Only a whole date is one (the year has four digits).
const isWholeDate = (v) => isIsoDate(v) && v >= '1000'

export function DateField({ value, onChange, today }) {
  const [typed, setTyped] = useState(null) // what the input holds while it is being typed into
  const quick = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['Next week', addDays(today, 7)],
  ]
  const set = (v) => {
    setTyped(null)
    onChange(v)
  }
  return (
    <div className="td-date">
      <div className="td-date-row">
        <input
          type="date"
          className="input"
          value={typed ?? value ?? ''}
          onChange={(e) => {
            // (emptying it, or any part of it, is not clearing the date: that is the button)
            setTyped(e.target.value)
            if (isWholeDate(e.target.value) && e.target.value !== value) onChange(e.target.value)
          }}
          onBlur={() => setTyped(null)}
        />
        {value && (
          <button type="button" className="icon-btn sm" title="Clear the date" aria-label="Clear the date" onClick={() => set(null)}>
            <X />
          </button>
        )}
      </div>
      <div className="td-quick">
        {quick.map(([label, to]) => (
          <button key={label} type="button" className={`te-quick ${value === to ? 'on' : ''}`} onClick={() => set(to)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Repeat({ task, change }) {
  const [custom, setCustom] = useState(false)
  const rule = task.recurrence || ''
  const whenDone = / when done$/i.test(rule)
  const base = rule.replace(/ when done$/i, '')
  const preset = REPEATS.some(([v]) => v === base.toLowerCase())
  const other = custom || (base && !preset)
  const write = (v, done = whenDone) => change({ recurrence: v ? v + (done ? ' when done' : '') : null })
  return (
    <div className="cd-repeat">
      <select
        className="input"
        aria-label="Repeat"
        value={other ? '__custom' : base.toLowerCase()}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          write(e.target.value)
        }}
      >
        {REPEATS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        <option value="__custom">Custom…</option>
      </select>
      {other && (
        <input
          className="input"
          aria-label="Repeat rule"
          placeholder="every 3 days, every monday and friday…"
          defaultValue={base}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== base && parseRecurrence(v)) write(v)
          }}
        />
      )}
      {task.recurrence && (
        <label className="te-check" title="Count the next one from the day this is done, not from its date">
          <input type="checkbox" checked={whenDone} onChange={(e) => write(base, e.target.checked)} />
          Count from when it's done
        </label>
      )}
    </div>
  )
}

// The task's #tags, as labels (in the colours its board gave them, if it is a card)
function Tags({ task, change, known, colorOf }) {
  const { title, tags } = splitTags(task.text)
  const [typed, setTyped] = useState('')
  const set = (next) => change({ title: joinTags(title, next) })
  const add = () => {
    const tag = cleanTag(typed)
    setTyped('')
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) set([...tags, tag])
  }
  return (
    <div className="cd-labels">
      {tags.map((t) => (
        <Label key={t} tag={t} color={colorHex(colorOf(t))} onRemove={() => set(tags.filter((x) => x !== t))} />
      ))}
      <input
        className="cd-label-input"
        list="td-known-tags"
        aria-label="Add a tag"
        placeholder={tags.length ? 'Add…' : 'Add a tag…'}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), add())}
        onBlur={add}
      />
      <datalist id="td-known-tags">
        {known.map(([t]) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  )
}

function Checklist({ task, list, today, readOnly }) {
  const [text, setText] = useState('')
  const addEl = useRef(null)
  const add = async () => {
    const title = text.trim()
    if (!title) return
    setText('')
    await A.addSubtask(task, title)
  }
  return (
    <section className="cd-section">
      <div className="cd-section-head">
        <ListChecks />
        <h3>Checklist</h3>
        {list && (
          <span className="cd-count">
            {list.done}/{list.total}
          </span>
        )}
      </div>
      {list && (
        <div className={`cd-progress ${list.done === list.total ? 'full' : ''}`} role="progressbar" aria-label="Subtasks done" aria-valuenow={list.done} aria-valuemax={list.total}>
          <i style={{ width: `${(list.done / list.total) * 100}%` }} />
        </div>
      )}
      <ul className="cd-items">
        {list?.items.map(({ task: t, depth }) => (
          <li key={taskKey(t)} className={`cd-item ${isOpen(t.status) ? '' : 'done'}`} style={depth > 1 ? { paddingLeft: (depth - 1) * 22 } : undefined}>
            <TaskBox task={t} />
            <input
              key={t.text}
              className="cd-item-text"
              aria-label="Subtask"
              defaultValue={t.text}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => {
                const title = e.target.value.trim()
                if (!title) e.target.value = t.text
                else if (title !== t.text) A.updateTask(t, { title })
              }}
            />
            <span className="td-item-meta">
              <TaskMeta task={t} today={today} />
            </span>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="cd-item-add">
          <Plus />
          <input ref={addEl} aria-label="Add an item" placeholder="Add an item…  [[ links a note or board" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <LinkSuggest field={addEl} />
        </div>
      )}
    </section>
  )
}

function TaskDialog({ at, onClose }) {
  const model = useTasks()
  const today = useToday()
  const ws = useApp((s) => s.wsId)
  const canEdit = useCanEdit()
  const root = useRef(null)
  const title = useRef(null)
  const [moreDates, setMoreDates] = useState(false)
  const seen = useRef(at) // where the task was when last looked at
  const task = locate(model, seen.current)

  // follows the task: when its line moves, or its words change
  useEffect(() => {
    if (task) seen.current = { path: task.path, line: task.line, text: task.text }
    else onClose() // gone from the note
  }, [task, onClose])
  useEffect(() => root.current?.focus(), [])
  useLayoutEffect(() => {
    if (title.current) {
      title.current.style.height = 'auto'
      title.current.style.height = `${title.current.scrollHeight}px`
    }
  }, [task?.text])

  if (!task) return null
  const change = (patch) => A.updateTask(task, patch)
  const { title: words, tags } = splitTags(task.text)
  const place = task.indent ? null : placeOf(task) // (a checklist item isn't a card)
  const lists = place ? listsOf(task.path) : []
  const look = cardLook(task)
  const done = !isOpen(task.status)
  const tone = dueTone(task.due, task.status, today)
  const go = () => (useLayout.getState().openNote(ws, task.path, place ? {} : { line: task.line }), onClose())

  return (
    <Modal title={null} label="Task" onClose={onClose} className={`card-dialog ${look.cover ? 'has-cover' : ''}`} style={look.cover ? { '--cover': colorHex(look.cover) } : undefined} bodyClass="cd-shell">
      <div className="cd" ref={root} tabIndex={-1}>
        <header className="cd-head">
          <button type="button" className={`pb-check cd-check ${done ? 'on' : ''}`} disabled={!canEdit} aria-label={done ? 'Mark not done' : 'Mark done'} onClick={() => change({ status: done ? ' ' : 'x' })}>
            <StatusIcon status={task.status} />
          </button>
          <div className="cd-head-main">
            <textarea
              ref={title}
              key={task.text}
              className="cd-title"
              rows={1}
              aria-label="Title"
              placeholder="What needs doing?"
              defaultValue={words}
              readOnly={!canEdit}
              onInput={(e) => {
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
              onBlur={(e) => {
                const next = e.target.value.replace(/\s+/g, ' ').trim()
                if (!next) e.target.value = words
                else if (next !== words) change({ title: joinTags(next, tags) })
              }}
            />
            <LinkSuggest key={task.text} field={title} />
            {place ? (
              // a project's card: the list it is in (moving it there follows the project's rules), and its board
              <div className="cd-where">
                in list
                <select className="cd-list" aria-label="List" value={place.list || ''} disabled={!canEdit} onChange={(e) => A.moveTaskToList(task, e.target.value)}>
                  {!lists.includes(place.list) && <option value={place.list || ''}>{place.list || '—'}</option>}
                  {lists.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                on
                <button type="button" className="cd-source" title={`Open the ${place.project} board`} onClick={go}>
                  <SquareKanban />
                  {place.project}
                </button>
              </div>
            ) : (
              <div className="cd-where">
                in
                <button type="button" className="cd-source" title={`Open ${task.path} at this line`} onClick={go}>
                  <FileText />
                  {stripExt(basename(task.path))}
                </button>
                <span>· line {task.line + 1}</span>
              </div>
            )}
          </div>
        </header>

        <div className="cd-grid">
          <fieldset className="cd-main" disabled={!canEdit}>
            <div className="cd-fields">
              <Field label="Status">
                <div className="te-seg">
                  {STATUSES.map(([v, label]) => (
                    <button key={v} type="button" className={task.status === v || (v === 'x' && task.status === 'X') ? 'active' : ''} onClick={() => task.status !== v && change({ status: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Priority">
                <div className="te-seg td-pri">
                  <button type="button" className={!task.priority ? 'active' : ''} onClick={() => change({ priority: null })}>
                    None
                  </button>
                  {PRIORITIES.map((p) => (
                    <button key={p} type="button" className={`pri-${p} ${task.priority === p ? 'active' : ''}`} title={PRIORITY_LABEL[p]} aria-label={PRIORITY_LABEL[p]} onClick={() => change({ priority: p })}>
                      <Flag />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={<>Due date {tone && <span className={`cd-due-tone ${tone}`}>{tone.replace('soon', 'tomorrow')}</span>}</>}>
                <DateField value={task.due} today={today} onChange={(v) => change({ due: v })} />
              </Field>
              <Field label="Repeat">
                <Repeat task={task} change={change} />
              </Field>
              {moreDates || task.scheduled || task.start ? (
                <>
                  <Field label="Scheduled">
                    <DateField value={task.scheduled} today={today} onChange={(v) => change({ scheduled: v })} />
                  </Field>
                  <Field label="Starts">
                    <DateField value={task.start} today={today} onChange={(v) => change({ start: v })} />
                  </Field>
                </>
              ) : (
                <button type="button" className="td-more cd-more" onClick={() => setMoreDates(true)} title="When you plan to work on it, and the day it can start">
                  <Plus /> Scheduled and start dates
                </button>
              )}
              <Field label={place ? 'Labels' : 'Tags'} wide>
                <Tags task={task} change={change} known={model.tags} colorOf={look.labelColor} />
              </Field>
            </div>
            <Checklist task={task} list={checklistOf(model.byPath.get(task.path), task.line)} today={today} readOnly={!canEdit} />
          </fieldset>

          <aside className="cd-side">
            <div className="td-label">Actions</div>
            <button type="button" className="cd-act" onClick={go}>
              {place ? <SquareKanban /> : <FileText />} {place ? 'Open board' : 'Open in note'}
            </button>
            {canEdit && (
              <button type="button" className="cd-act danger" onClick={() => (A.deleteTask(task), onClose())}>
                <Trash2 /> Delete
              </button>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  )
}
