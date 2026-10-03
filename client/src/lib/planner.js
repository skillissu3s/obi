// What the Tasks and Calendar pages share: the workspace's tasks ready to show,
// the filters, dragging a task from one place to another, and changing tasks
// with a way back.
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dateKeyOf, dropPatch, isOpen, matchTask, splitTags, taskTree, todayIso, undoPatch } from '@shared/tasks.js'
import { useApp } from '../store/app.js'
import { usePlanner } from '../store/planner.js'
import { toast } from '../store/ui.js'
import * as A from './actions.js'
import { dueLabel, plainSnippet } from './util.js'

export const taskKey = (t) => `${t.path}:${t.line}`

// ---------- the tasks ----------

let cache = { version: -1 }

// Everything the pages need to know about the tasks, worked out once per change
// of the index: `cards` (the tasks no other task is nested under, which is what
// a board shows), each card's `lists` (its checklist), `byPath`, and the `tags`
// of the open tasks, most used first. All tasks are in `all`.
function build(version) {
  const all = A.allTasks()
  const byPath = new Map()
  for (const t of all) (byPath.get(t.path) ?? byPath.set(t.path, []).get(t.path)).push(t)
  const cards = []
  const lists = new Map()
  const depths = new Map() // how deep a task is nested under another
  for (const [path, tasks] of byPath) {
    const tree = taskTree(tasks)
    for (const t of tree.roots) cards.push(t)
    for (const [line, list] of tree.lists) {
      lists.set(`${path}:${line}`, list)
      for (const { task, depth } of list.items) depths.set(taskKey(task), depth)
    }
  }
  const counts = new Map()
  for (const t of all) {
    if (!isOpen(t.status)) continue
    for (const tag of t.tags || []) {
      const e = counts.get(tag.toLowerCase()) ?? counts.set(tag.toLowerCase(), [tag, 0]).get(tag.toLowerCase())
      e[1]++
    }
  }
  const tags = [...counts.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { version, all, cards, byPath, lists, depths, tags }
}

export function useTasks() {
  const version = useApp((s) => s.version)
  if (cache.version !== version) cache = build(version)
  return cache
}

/** The day, which rolls over while a page stays open */
export function useToday() {
  const [today, setToday] = useState(todayIso)
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60000)
    return () => clearInterval(t)
  }, [])
  return today
}

/** `[ref, wide]`: is the element `ref` is put on at least `min` px wide? */
export function useWide(min) {
  const ref = useRef(null)
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const watch = new ResizeObserver(([e]) => setWide(e.contentRect.width >= min))
    watch.observe(ref.current)
    return () => watch.disconnect()
  }, [min])
  return [ref, wide]
}

/** Can this person change tasks? (A viewer of a workspace can't.) */
export const useCanEdit = () => useApp((s) => s.workspaces.find((w) => w.id === s.wsId)?.role !== 'viewer')

// ---------- filters ----------

/** The filters, as { q, tags, priority, done } — the search follows typing a moment late */
export function useFilter() {
  const q = useDeferredValue(usePlanner((s) => s.q))
  const tags = usePlanner((s) => s.tags)
  const priority = usePlanner((s) => s.priority)
  const done = usePlanner((s) => s.done)
  return useMemo(() => ({ q, tags, priority, done }), [q, tags, priority, done])
}

export const passes = (task, filter) => (filter.done || isOpen(task.status)) && matchTask(task, filter)

/** How many filters are narrowing the tasks down */
export function useFilterCount() {
  const q = usePlanner((s) => s.q)
  const tags = usePlanner((s) => s.tags)
  const priority = usePlanner((s) => s.priority)
  return (q.trim() ? 1 : 0) + tags.length + (priority ? 1 : 0)
}

export const clearFilters = () => usePlanner.getState().set({ q: '', tags: [], priority: null })

/** Show tasks with this tag too (or stop doing so) */
export function toggleTag(tag) {
  const { tags, set } = usePlanner.getState()
  const same = (t) => t.toLowerCase() === tag.toLowerCase()
  set({ tags: tags.some(same) ? tags.filter((t) => !same(t)) : [...tags, tag] })
}

// ---------- dragging ----------

const MIME = 'text/obi-task'
let dragged = null

/** The task being dragged, from wherever on screen */
export const draggedTask = () => dragged

export const isTaskDrag = (e) => e.dataTransfer.types.includes(MIME)

/**
 * Starts dragging `task` from the element the event is on. The browser keeps the
 * payload out of reach until the drop, and drops can land in another pane, so the
 * task is held here; a drag in progress marks the page (for columns that can't
 * take it) until it ends — or is dropped, for a card that has moved away by then.
 */
export function startDrag(e, task) {
  dragged = task
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(MIME, taskKey(task))
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  // a lifted copy rather than the faded card itself
  const ghost = el.cloneNode(true)
  ghost.classList.add('pl-ghost')
  ghost.style.width = `${r.width}px`
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top)
  setTimeout(() => ghost.remove())
  document.documentElement.dataset.dragging = 'task'
  const end = new AbortController()
  const stop = () => {
    end.abort()
    setTimeout(() => {
      dragged = null
      delete document.documentElement.dataset.dragging
    })
  }
  window.addEventListener('dragend', stop, { capture: true, signal: end.signal })
  window.addEventListener('drop', stop, { capture: true, signal: end.signal })
}

/** Props that make a day (a calendar cell, a date in the rail…) take a dragged task */
export function useDayDrop(iso) {
  const [over, setOver] = useState(false)
  return {
    over,
    drop: {
      onDragOver(e) {
        if (!isTaskDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false)
      },
      onDrop(e) {
        setOver(false)
        if (!dragged) return
        e.preventDefault()
        e.stopPropagation()
        moveToDay(dragged, iso)
      },
    },
  }
}

// ---------- changing tasks ----------

/** A task's words without its tags and markdown, for where text is plain */
export const plainTitle = (task) => plainSnippet(splitTags(task.text).title, 400)

const nameOf = (task) => {
  const title = plainTitle(task)
  return title.length > 42 ? `${title.slice(0, 41)}…` : title
}

/**
 * Changes tasks — `patchOf(task)` is each one's change, or null to leave it — and
 * says so in a toast that takes it all back.
 */
export async function changeTasks(tasks, patchOf, message) {
  const made = []
  // a few at a time: changes to one note queue up on the server anyway
  for (let i = 0; i < tasks.length; i += 6) {
    await Promise.all(
      tasks.slice(i, i + 6).map(async (task) => {
        const patch = patchOf(task)
        const result = patch && (await A.updateTask(task, patch))
        if (result) made.push({ task, patch, result })
      }),
    )
  }
  if (!made.length) return
  const undo = () => Promise.all(made.map(({ task, patch, result }) => A.updateTask({ ...task, line: result.line }, undoPatch(task, patch), { dropNext: !!result.next })))
  toast.info(message, { timeout: 8000, action: { label: 'Undo', run: undo } })
}

/** Drops `task` on a column of a board: the field the column is about changes */
export function moveToColumn(task, group, column, today) {
  const patch = dropPatch(task, group, column.id, today)
  if (patch) changeTasks([task], () => patch, `Moved “${nameOf(task)}” to ${column.label}`)
}

/** Puts `task` on a day: the date it sits on moves there */
export function moveToDay(task, iso) {
  if (task[dateKeyOf(task)] !== iso) changeTasks([task], (t) => ({ [dateKeyOf(t)]: iso }), `Moved “${nameOf(task)}” to ${dueLabel(iso)}`)
}
