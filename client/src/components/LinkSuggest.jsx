// Typing [[ in a card's or a task's text suggests the notes and boards to link,
// as the note editor does: ↑ ↓ to choose, Enter or Tab to put the link in,
// Escape to carry on typing. Works on any <input> or <textarea> (`field`, a ref):
// it writes through the field's own value, so React state follows as if typed.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Shapes, SquareKanban } from 'lucide-react'
import { basename, dirname, isNote, stripExt } from '@shared/paths.js'
import { isBoardPath } from '@shared/board.js'
import { isBoardMeta } from '@shared/kanban.js'
import { useApp } from '../store/app.js'

const MAX = 8

// The notes and boards whose name has `query` in it (those that start with it first);
// with nothing typed yet, the ones changed last
function candidates(query) {
  const { tree, notes } = useApp.getState()
  const q = query.trim().toLowerCase()
  const out = []
  for (const e of tree) {
    if (e.type !== 'file') continue
    const whiteboard = isBoardPath(e.path)
    if (!whiteboard && !isNote(e.path)) continue
    const label = stripExt(basename(e.path))
    const at = label.toLowerCase().indexOf(q)
    if (q && at < 0) continue
    const kind = whiteboard ? 'whiteboard' : isBoardMeta(notes.get(e.path)) ? 'board' : 'note'
    out.push({ path: e.path, label, kind, folder: dirname(e.path), rank: q ? (at === 0 ? 0 : 1) : 0, mtime: e.mtime || 0 })
  }
  out.sort((a, b) => a.rank - b.rank || (q ? a.label.length - b.label.length : b.mtime - a.mtime) || a.label.localeCompare(b.label))
  return out.slice(0, MAX)
}

const ICON = { note: FileText, board: SquareKanban, whiteboard: Shapes }

// sets a field's value the way typing does, so React's onChange / onInput see it
function writeValue(el, value, caret) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.setSelectionRange(caret, caret)
}

export function LinkSuggest({ field }) {
  const [open, setOpen] = useState(null) // { items, active, start, rect }
  const openRef = useRef(null)
  openRef.current = open

  useEffect(() => {
    const el = field.current
    if (!el) return undefined
    // what is being typed: [[ and the start of a name, just before the caret
    const look = () => {
      if (document.activeElement !== el || el.selectionStart !== el.selectionEnd) return setOpen(null)
      const before = el.value.slice(0, el.selectionStart)
      const m = /\[\[([^[\]\n|#]*)$/.exec(before)
      if (!m) return setOpen(null)
      const items = candidates(m[1])
      if (!items.length) return setOpen(null)
      setOpen((o) => ({ items, active: o && o.start === m.index ? Math.min(o.active, items.length - 1) : 0, start: m.index, rect: el.getBoundingClientRect() }))
    }
    const pick = (item) => {
      const o = openRef.current
      if (!o) return
      const { resolver } = useApp.getState()
      const text = resolver?.linkTextFor ? resolver.linkTextFor(item.path) : item.label
      const linkText = isNote(item.path) ? stripExt(text) : text
      const caret = el.selectionStart
      const closing = el.value.slice(caret, caret + 2) === ']]' ? 2 : 0
      const insert = `[[${linkText}]]`
      writeValue(el, el.value.slice(0, o.start) + insert + el.value.slice(caret + closing), o.start + insert.length)
      setOpen(null)
    }
    el.linkSuggestPick = pick
    const onKey = (e) => {
      const o = openRef.current
      if (!o) return
      const stop = () => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop()
        const n = o.items.length
        setOpen({ ...o, active: (o.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        stop()
        pick(o.items[o.active])
      } else if (e.key === 'Escape') {
        stop()
        setOpen(null)
      }
    }
    const onBlur = () => setOpen(null)
    // (the caret moved along the line: maybe into a link being typed, maybe out of one)
    const onKeyUp = (e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && look()
    el.addEventListener('input', look)
    el.addEventListener('click', look)
    el.addEventListener('keyup', onKeyUp)
    el.addEventListener('keydown', onKey)
    el.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('input', look)
      el.removeEventListener('click', look)
      el.removeEventListener('keyup', onKeyUp)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('blur', onBlur)
      delete el.linkSuggestPick
    }
  }, [field])

  if (!open) return null
  const { rect } = open
  const below = rect.bottom + 260 < window.innerHeight
  const style = { left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), width: Math.max(260, Math.min(rect.width, 320)), ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) }
  return createPortal(
    <div className="link-suggest" role="listbox" aria-label="Link to a note or board" style={style}>
      {open.items.map((it, i) => {
        const Icon = ICON[it.kind]
        return (
          <div
            key={it.path}
            role="option"
            aria-selected={i === open.active}
            className={`ls-row ${i === open.active ? 'active' : ''}`}
            // (a press keeps the focus in the field, so the link goes in where the caret is)
            onMouseDown={(e) => {
              e.preventDefault()
              field.current?.linkSuggestPick?.(it)
            }}
            onMouseEnter={() => i !== open.active && setOpen({ ...open, active: i })}
          >
            <Icon />
            <span className="ls-name truncate">{it.label}</span>
            <span className="ls-detail truncate">{it.kind === 'note' ? it.folder : `${it.kind}${it.folder ? ` · ${it.folder}` : ''}`}</span>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
