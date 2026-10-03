// Search, priority, tags and finished tasks: one set of filters for the Tasks and
// the Calendar pages, kept in this browser.
import { Search, X } from 'lucide-react'
import { PRIORITIES, PRIORITY_EMOJI } from '@shared/tasks.js'
import { usePlanner } from '../store/planner.js'
import { clearFilters, toggleTag, useFilterCount } from '../lib/planner.js'
import { Switch } from './ui.jsx'
import { TagChip } from './TaskParts.jsx'

const MAX_TAGS = 40 // the most used, past which the search is the way

/** `tags`: [name, count] of the tags in use; `stacked`: in a column, as in a popover */
export function TaskFilters({ tags, stacked = false }) {
  const q = usePlanner((s) => s.q)
  const selected = usePlanner((s) => s.tags)
  const priority = usePlanner((s) => s.priority)
  const done = usePlanner((s) => s.done)
  const set = usePlanner((s) => s.set)
  const count = useFilterCount()
  const shown = [...selected.filter((t) => !tags.some(([name]) => name.toLowerCase() === t.toLowerCase())).map((t) => [t, null]), ...tags.slice(0, MAX_TAGS)]

  return (
    <div className={`pl-filters ${stacked ? 'stacked' : ''}`}>
      <div className="pl-filter-row">
        <div className="search-box pl-search">
          <Search />
          <input className="input" aria-label="Search tasks" placeholder="Search tasks…" value={q} onChange={(e) => set({ q: e.target.value })} />
          {q && (
            <button type="button" className="icon-btn sm" aria-label="Clear the search" onClick={() => set({ q: '' })}>
              <X />
            </button>
          )}
        </div>
        <select className="input pl-select" aria-label="Priority" value={priority || ''} onChange={(e) => set({ priority: e.target.value || null })}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_EMOJI[p]} {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
          <option value="none">No priority</option>
        </select>
        <label className="pl-toggle">
          <Switch checked={done} onChange={(v) => set({ done: v })} />
          Completed
        </label>
        {count > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <div className="pl-tag-row" role="group" aria-label="Tags — show tasks with any of these">
          {shown.map(([tag, n]) => (
            <TagChip key={tag} tag={tag} count={n} on={selected.some((t) => t.toLowerCase() === tag.toLowerCase())} onClick={() => toggleTag(tag)} />
          ))}
        </div>
      )}
    </div>
  )
}
