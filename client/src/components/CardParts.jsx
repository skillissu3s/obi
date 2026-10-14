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

/** A card's #tag as a label, in the colour the tag has everywhere */
export function Label({ tag, onRemove }) {
  return (
    <span className="pb-label" style={{ '--label': colorFor(tag.split('/')[0].toLowerCase()) }} title={`#${tag}`}>
      {tag}
      {onRemove && (
        <button type="button" aria-label={`Remove ${tag}`} title="Remove this label" onClick={onRemove}>
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
