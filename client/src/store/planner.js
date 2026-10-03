// How the Tasks and Calendar pages are set up: board or list, what it is grouped
// by, the filters, which side panels are open. Pure view state, kept in this
// browser — a board is never written into the notes.
import { create } from 'zustand'
import { PRIORITIES } from '@shared/tasks.js'

const KEY = 'obi:planner'

function load() {
  let s = {}
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {}
  const oneOf = (v, ok) => (ok.includes(v) ? v : ok[0])
  return {
    view: oneOf(s.view, ['board', 'list']),
    group: oneOf(s.group, ['status', 'date', 'priority', 'note']), // a note only in a list
    q: typeof s.q === 'string' ? s.q : '',
    tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [],
    priority: [...PRIORITIES, 'none'].includes(s.priority) ? s.priority : null,
    done: s.done !== false, // finished tasks: a Done column on a board
    rail: typeof s.rail === 'boolean' ? s.rail : null, // the Schedule beside the tasks; null: when there is room
    mode: oneOf(s.mode, ['month', 'week', 'agenda']), // the calendar
    side: oneOf(s.side, ['day', 'plan']), // and which side panel it shows,
    panel: s.panel !== false, // if any
  }
}

export const usePlanner = create((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    try {
      localStorage.setItem(KEY, JSON.stringify(get())) // (the functions are left out)
    } catch {}
  },
}))
