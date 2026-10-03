// A small month beside the tasks: a dot on each day something is due, and a day
// to drop a card on to give it that date. The heading opens the Calendar.
import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react'
import { addMonths, monthDays } from '@shared/tasks.js'
import { usePrefs } from '../store/prefs.js'
import { useLayout } from '../store/layout.js'
import { taskKey, useDayDrop } from '../lib/planner.js'
import { dateOfIso, formatDate } from '../lib/util.js'
import { TaskChip } from './TaskParts.jsx'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function Day({ iso, today, selected, dim, tasks, onSelect, canEdit }) {
  const { over, drop } = useDayDrop(iso)
  const n = tasks?.length || 0
  return (
    <button
      type="button"
      className={`rail-day ${iso === today ? 'today' : ''} ${iso === selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${over ? 'over' : ''}`}
      aria-label={`${formatDate(dateOfIso(iso), 'dddd D MMMM')}${n ? `, ${n} due` : ''}`}
      aria-pressed={iso === selected}
      onClick={() => onSelect(iso)}
      {...(canEdit ? drop : {})}
    >
      {dateOfIso(iso).getDate()}
      {n > 0 && (
        <span className={`rail-dots ${iso < today ? 'late' : ''}`}>
          {Array.from({ length: Math.min(n, 3) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
    </button>
  )
}

/** `byDay`: the open tasks with a day, by day */
export function ScheduleRail({ byDay, today, canEdit, onOpen, onHide }) {
  const startDay = usePrefs((s) => (s.weekStart === 'sunday' ? 0 : 1))
  const [month, setMonth] = useState(today)
  const [selected, setSelected] = useState(today)
  const days = useMemo(() => monthDays(month, startDay), [month, startDay])
  const names = DOW.slice(startDay).concat(DOW.slice(0, startDay))
  const here = byDay.get(selected) || []
  return (
    <aside className="pl-rail" aria-label="Schedule">
      <div className="rail-head">
        <button type="button" className="rail-title" title="Open the calendar" onClick={() => useLayout.getState().openView('calendar')}>
          <CalendarDays />
          Schedule
          <ChevronRight />
        </button>
        <button type="button" className="icon-btn sm" aria-label="Hide the schedule" title="Hide the schedule" onClick={onHide}>
          <ChevronsRight />
        </button>
      </div>
      <div className="rail-month">
        <span>{formatDate(dateOfIso(month), 'MMMM YYYY')}</span>
        <button type="button" className="icon-btn sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setMonth(today)
            setSelected(today)
          }}
        >
          Today
        </button>
        <button type="button" className="icon-btn sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </button>
      </div>
      <div className="rail-grid">
        {names.map((n, i) => (
          <div key={i} className="rail-dow">
            {n}
          </div>
        ))}
        {days.map((iso) => (
          <Day key={iso} iso={iso} today={today} selected={selected} dim={iso.slice(0, 7) !== month.slice(0, 7)} tasks={byDay.get(iso)} onSelect={setSelected} canEdit={canEdit} />
        ))}
      </div>
      <div className="rail-day-title">
        {selected === today ? 'Today' : formatDate(dateOfIso(selected), 'ddd D MMM')}
        <span className="faint"> · {here.length ? `${here.length} due` : 'nothing due'}</span>
      </div>
      <div className="rail-list">
        {here.slice(0, 12).map((t) => (
          <TaskChip key={taskKey(t)} task={t} today={today} canEdit={canEdit} onOpen={onOpen} />
        ))}
        {here.length > 12 && <div className="faint rail-more">+{here.length - 12} more in the calendar</div>}
        {canEdit && <div className="rail-hint">Drop a card on a day to set its date.</div>}
      </div>
    </aside>
  )
}
