// The tasks as a board: a column for each value of what they are grouped by.
// Dragging a card to another column changes that field on its line.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { boardColumns, columnFields, columnOf, compareFinished, compareTasks, dateKeyOf } from '@shared/tasks.js'
import * as A from '../lib/actions.js'
import { draggedTask, isTaskDrag, moveToColumn, taskKey } from '../lib/planner.js'
import { dueLabel } from '../lib/util.js'
import { ParsedChips, TaskCard, useQuickParse } from './TaskParts.jsx'

export const PAGE = 40 // cards shown in a column before "Show more"

/**
 * Adds cards one after another: Enter adds and stays, Escape closes. A date, a
 * priority or a repeat can be typed in the title ("tomorrow", "!high", "every week").
 */
function Composer({ onAdd, onClose }) {
  const [text, setText] = useState('')
  const input = useRef(null)
  const { parsed, keep } = useQuickParse(text)
  useEffect(() => input.current?.focus(), [])
  const submit = () => {
    if (!parsed.title) return
    const { title, due, priority, recurrence } = parsed
    setText('')
    onAdd(title, Object.fromEntries(Object.entries({ due, priority, recurrence }).filter(([, v]) => v)))
  }
  return (
    <div className="pl-composer" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !text.trim() && onClose()}>
      <textarea
        ref={input}
        rows={2}
        aria-label="Title of the new card"
        placeholder="Title… “Pay rent fri !high”"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <ParsedChips found={parsed.found} onKeep={keep} />
      <div className="pl-composer-actions">
        <button type="button" className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add card
        </button>
        <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </div>
    </div>
  )
}

function Column({ col, group, tasks, lists, today, ws, canEdit, onOpen }) {
  const [over, setOver] = useState(false)
  const [composing, setComposing] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const fields = columnFields(group, col.id, today) // what being here means; none for Overdue
  const droppable = canEdit && !!fields
  const addable = droppable && col.id !== 'done'

  // the day a drop here would give, for a column of days
  const dragging = over ? draggedTask() : null
  const day = dragging && group === 'date' && columnFields(group, col.id, today, dateKeyOf(dragging))
  const target = day && (day.due || day.scheduled || day.start)

  // what was typed in the title wins over what the column would give
  const add = (title, typed = {}) => A.addTask({ title, quiet: true, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)), ...typed })

  return (
    <section
      className={`pl-col ${over ? 'over' : ''} ${droppable ? '' : 'no-drop'}`}
      data-col={col.id}
      aria-label={`${col.label}, ${tasks.length} ${tasks.length === 1 ? 'card' : 'cards'}`}
      onDragOver={(e) => {
        if (!droppable || !isTaskDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const task = draggedTask()
        setOver(!task || columnOf(task, group, today) !== col.id)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const task = draggedTask()
        if (!task) return
        e.preventDefault()
        moveToColumn(task, group, col, today)
      }}
    >
      <header className="pl-col-head">
        <span className="pl-dot" />
        <h3>{col.label}</h3>
        <span className="pl-count">{tasks.length}</span>
        {addable && (
          <button type="button" className="icon-btn sm" aria-label={`Add a card to ${col.label}`} title="Add a card" onClick={() => setComposing(true)}>
            <Plus />
          </button>
        )}
      </header>
      <div className="pl-col-cards">
        {tasks.slice(0, limit).map((t) => {
          const list = lists.get(taskKey(t))
          return <TaskCard key={taskKey(t)} task={t} today={today} ws={ws} canEdit={canEdit} onOpen={onOpen} done={list?.done} total={list?.total} />
        })}
        {over && (
          <div className="pl-drop">
            Move to {col.label}
            {target && <span> · {dueLabel(target)}</span>}
          </div>
        )}
        {!tasks.length && !over && (
          <div className="pl-empty">
            <span className="idle">Nothing here</span>
            <span className="dropping">{droppable ? 'Drop a card here' : "Cards can't be dropped here"}</span>
          </div>
        )}
        {tasks.length > limit && (
          <button type="button" className="pl-more" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, tasks.length - limit)} more
          </button>
        )}
      </div>
      {addable && (composing ? <Composer onAdd={add} onClose={() => setComposing(false)} /> : (
        <button type="button" className="pl-add" onClick={() => setComposing(true)}>
          <Plus /> Add a card
        </button>
      ))}
    </section>
  )
}

/** `cards`: the tasks to show; `lists`: their checklists (see lib/planner.js) */
export function TaskBoard({ cards, lists, group, done, today, ws, canEdit, onOpen }) {
  const columns = boardColumns(group, { done })
  const board = useRef(null)
  // a board wider than its room says so: the side with more to scroll to fades out (see planner.css)
  useLayoutEffect(() => {
    const el = board.current
    const edges = () => {
      el.toggleAttribute('data-more-start', el.scrollLeft > 1)
      el.toggleAttribute('data-more-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    edges()
    el.addEventListener('scroll', edges, { passive: true })
    const watch = new ResizeObserver(edges)
    watch.observe(el)
    return () => {
      el.removeEventListener('scroll', edges)
      watch.disconnect()
    }
  }, [columns.length])
  const byColumn = useMemo(() => {
    const out = new Map(columns.map((c) => [c.id, []]))
    for (const t of cards) out.get(columnOf(t, group, today))?.push(t)
    for (const [id, list] of out) list.sort(id === 'done' ? compareFinished : compareTasks)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, group, done, today])
  return (
    <div className="pl-board" ref={board}>
      {columns.map((col) => (
        <Column key={`${group}:${col.id}`} col={col} group={group} tasks={byColumn.get(col.id)} lists={lists} today={today} ws={ws} canEdit={canEdit} onOpen={onOpen} />
      ))}
    </div>
  )
}
