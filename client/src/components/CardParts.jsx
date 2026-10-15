// Pieces of a project's card that its front (ProjectBoard) and its dialog (CardDialog) share.
import { CircleCheckBig, Circle, CircleDashed, X } from 'lucide-react'
import { addDays, isOpen } from '@shared/tasks.js'
import { colorFor } from '../lib/util.js'

/** How a due date reads: done, overdue, today, soon (tomorrow), or plain ('') */
export function dueTone(due, status, today) {
  if (!due) return ''
  if (!isOpen(status)) return 'done'
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return due === addDays(today, 1) ? 'soon' : ''
}

/** A card's #tag as a label: in the colour picked for it on its board (`color`), else the one the tag has everywhere */
export function Label({ tag, color, onRemove, onClick }) {
  return (
    <span className={`pb-label ${onClick ? 'pickable' : ''}`} style={{ '--label': color || colorFor(tag.split('/')[0].toLowerCase()) }} title={onClick ? `#${tag} — click to change its colour` : `#${tag}`} onClick={onClick}>
      {tag}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${tag}`}
          title="Remove this label"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X />
        </button>
      )}
    </span>
  )
}

/** The round check: open, in progress (dashed) or done */
export function StatusIcon({ status }) {
  if (!isOpen(status)) return <CircleCheckBig />
  return status === '/' ? <CircleDashed /> : <Circle />
}
