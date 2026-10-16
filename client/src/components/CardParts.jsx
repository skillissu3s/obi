// Pieces of a project's card that its front (ProjectBoard) and its dialog (CardDialog) share.
import { Check, ChevronLeft, CircleCheckBig, Circle, CircleDashed, X } from 'lucide-react'
import * as K from '@shared/kanban.js'
import { addDays, isOpen } from '@shared/tasks.js'
import { colorFor } from '../lib/util.js'
import { colorLabel } from '../lib/colors.js'

/** The head of a popover: its title in the middle, a way back on the left (if any), × on the right */
export function PopHead({ title, onBack, onClose }) {
  return (
    <div className="pop-head">
      {onBack ? (
        <button type="button" className="icon-btn sm" aria-label="Back" title="Back" onClick={onBack}>
          <ChevronLeft />
        </button>
      ) : (
        <span />
      )}
      <b>{title}</b>
      <button type="button" className="icon-btn sm" aria-label="Close" title="Close" onClick={onClose}>
        <X />
      </button>
    </div>
  )
}

/** The colours to pick from, as wide tiles; the one in use ticked */
export function Colors({ value, onPick }) {
  return (
    <div className="lp-colors" role="radiogroup" aria-label="Colour">
      {K.PROJECT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" className={`lp-color ${value === c ? 'on' : ''}`} data-color={c} title={colorLabel(c)} aria-label={colorLabel(c)} aria-checked={value === c} onClick={() => onPick(c)}>
          {value === c && <Check />}
        </button>
      ))}
    </div>
  )
}

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
    <span className={`pb-label ${onClick ? 'pickable' : ''}`} style={{ '--label': color || colorFor(tag.split('/')[0].toLowerCase()) }} title={onClick ? `#${tag} — click to pick labels` : `#${tag}`} onClick={onClick}>
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
