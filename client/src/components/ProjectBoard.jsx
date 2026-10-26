// A project, the way Trello shows one: its lists side by side, cards that drag
// from list to list, and a card that opens to everything about it. The board is
// the note's markdown (shared/kanban.js), rewritten through the note's document
// on every change, so it is live for everyone who has it open.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignLeft, Archive, ArchiveRestore, ArrowRight, CalendarDays, CircleCheckBig, Flag, ListChecks, ListFilter, MoreHorizontal,
  Palette, Pencil, Plus, Repeat, Search, SortAsc, Trash2, X, Zap, FileText, Share2, Smile,
} from 'lucide-react'
import { applyToYText } from '@shared/textdiff.js'
import * as K from '@shared/kanban.js'
import { addDays, isOpen, priorityRank, splitTags, weekStartOf } from '@shared/tasks.js'
import { renderInline } from '../lib/render.js'
import { dueLabel } from '../lib/util.js'
import { openLink } from '../lib/actions.js'
import { useToday } from '../lib/planner.js'
import { projectColor } from '../lib/projects.js'
import { useUI, toast, confirmDialog } from '../store/ui.js'
import { menuFromElement, Popover } from './ui.jsx'
import { ParsedChips, PRIORITY_LABEL, useQuickParse } from './TaskParts.jsx'
import { CardDialog } from './CardDialog.jsx'
import { Colors, Label, PopHead, StatusIcon, dueTone } from './CardParts.jsx'
import { Automation, ruleCount } from './Automation.jsx'
import { useBoardDrag } from './boardDrag.js'
import { colorHex } from '../lib/colors.js'
import { LinkSuggest } from './LinkSuggest.jsx'
import { EmojiPicker } from './EmojiPicker.jsx'
import { useSettle } from '../lib/celebrate.js'

export const LIST_COLORS = K.PROJECT_COLORS

// ---------- the board as state ----------

/**
 * The board of `handle`'s note, following it as it changes. `mutate(fn)` runs
 * `fn` on a copy of the board as it is now and writes that (unless `fn` returns
 * false); it gives back what `fn` returned.
 */
function useBoard(handle) {
  const text = useRef(handle.ytext.toString())
  const ref = useRef(null)
  if (!ref.current) ref.current = K.parseBoard(text.current)
  const [board, setBoard] = useState(ref.current)
  useEffect(() => {
    const update = () => {
      const t = handle.ytext.toString()
      if (t === text.current) return
      text.current = t
      ref.current = K.parseBoard(t)
      setBoard(ref.current)
    }
    const offs = [handle.on('change', update), handle.on('synced', update)]
    update()
    return () => offs.forEach((off) => off())
  }, [handle])
  const mutate = useCallback(
    (fn) => {
      const next = K.cloneBoard(ref.current)
      const out = fn(next)
      if (out === false) return undefined
      K.rekey(next)
      ref.current = next
      setBoard(next)
      const t = K.serializeBoard(next)
      if (t !== text.current) {
        text.current = t
        applyToYText(handle.ytext, t)
      }
      return out
    },
    [handle],
  )
  return { board, mutate, ref }
}

// ---------- filters ----------

const NO_FILTER = { q: '', labels: [], due: null, done: true }

function passes(card, f, today) {
  const task = K.cardTask(card)
  const status = card.status ?? ' '
  if (!f.done && !isOpen(status)) return false
  const text = (task?.text ?? card.text).toLowerCase()
  if (f.q.trim() && !text.includes(f.q.trim().toLowerCase()) && !K.cardDetails(card).description.toLowerCase().includes(f.q.trim().toLowerCase())) return false
  if (f.labels.length && !f.labels.some((l) => task?.tags?.some((t) => t.toLowerCase() === l.toLowerCase()))) return false
  if (f.due) {
    const d = task?.due
    if (f.due === 'none') return !d
    if (!d || !isOpen(status)) return false
    if (f.due === 'overdue') return d < today
    if (f.due === 'today') return d === today
    if (f.due === 'week') return d <= addDays(today, 7)
  }
  return true
}

const filterCount = (f) => (f.q.trim() ? 1 : 0) + f.labels.length + (f.due ? 1 : 0) + (f.done ? 0 : 1)

// ---------- a card ----------

// a card's words as HTML, kept while they don't change
const html = new Map()
function wordsHtml(text, ws, path) {
  const k = `${ws}\0${path}\0${text}`
  if (!html.has(k)) {
    if (html.size > 2000) html.clear()
    html.set(k, renderInline(text, { ws, path }))
  }
  return html.get(k)
}

const Card = memo(function Card({ card, today, ws, path, readOnly, hidden, cover, labelColor, labelNames, onLabelNames, onOpen, onToggle, onMenu, onPress, quiet }) {
  const task = K.cardTask(card)
  const status = card.status ?? ' '
  const { title, tags } = splitTags(task?.text ?? card.text)
  const { description, checklist } = K.cardDetails(card)
  const ticked = checklist.filter((t) => !isOpen(t.status)).length
  const done = !isOpen(status)
  const tone = dueTone(task?.due, status, today)
  // done: a celebration around the tick and a moment to see it struck through, then it is (and moves)
  const [settling, settle] = useSettle(onToggle)
  const toggle = (from) => (done ? onToggle() : settle(from))
  return (
    <article
      className={`pb-card ${done ? 'done' : ''} ${status === '/' ? 'doing' : ''} ${settling ? 'settling' : ''} ${hidden ? 'is-dragging' : ''}`}
      data-card={card.id}
      tabIndex={0}
      aria-label={`${title}${task?.due ? `, due ${dueLabel(task.due)}` : ''}${done ? ', done' : ''}`}
      onPointerDown={onPress}
      onClick={(e) => {
        if (quiet()) return // (the click that ends a drag)
        const a = e.target.closest('a')
        if (a?.dataset.href) {
          e.preventDefault()
          return openLink(ws, path, a.dataset.href, {})
        }
        if (!e.target.closest('button')) onOpen()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen()
        } else if (e.key === ' ' && !readOnly) {
          e.preventDefault()
          toggle(e.currentTarget.querySelector('.pb-check'))
        }
      }}
      onContextMenu={onMenu}
    >
      {cover && <div className="pb-cover" data-color={cover} />}
      {tags.length > 0 && (
        // thin bars of colour; a click on one shows (or hides) every label's name
        <div
          className={`pb-labels ${labelNames ? '' : 'thin'}`}
          title={labelNames ? undefined : tags.map((t) => `#${t}`).join('  ')}
          onClick={(e) => {
            e.stopPropagation()
            onLabelNames()
          }}
        >
          {tags.map((t) => (
            <Label key={t} tag={t} color={labelColor(t)} />
          ))}
        </div>
      )}
      <div className="pb-card-title">
        <button
          type="button"
          className={`pb-check ${done ? 'on' : ''}`}
          disabled={readOnly}
          aria-label={done ? 'Mark not done' : 'Mark done'}
          title={done ? 'Mark not done' : status === '/' ? 'In progress — mark done' : 'Mark done'}
          onClick={(e) => toggle(e.currentTarget)}
        >
          <StatusIcon status={settling ? 'x' : status} />
        </button>
        <span className="pb-words">
          <span className="pb-strike" dangerouslySetInnerHTML={{ __html: wordsHtml(title || 'Untitled card', ws, path) }} />
        </span>
      </div>
      {(task?.due || task?.priority || description || checklist.length > 0 || task?.recurrence) && (
        <div className="pb-badges">
          {task?.due && (
            <span className={`pb-badge due ${tone}`} title={`Due ${task.due}`}>
              <CalendarDays />
              {dueLabel(task.due)}
            </span>
          )}
          {task?.priority && (
            <span className={`pb-badge task-pri pri-${task.priority}`} title={PRIORITY_LABEL[task.priority]}>
              <Flag />
            </span>
          )}
          {task?.recurrence && (
            <span className="pb-badge" title={`Repeats ${task.recurrence}`}>
              <Repeat />
            </span>
          )}
          {description && (
            <span className="pb-badge" title="This card has a description">
              <AlignLeft />
            </span>
          )}
          {checklist.length > 0 && (
            <span className={`pb-badge ${ticked === checklist.length ? 'full' : ''}`} title={`${ticked} of ${checklist.length} checklist items done`}>
              <ListChecks />
              {ticked}/{checklist.length}
            </span>
          )}
        </div>
      )}
    </article>
  )
})

// ---------- adding ----------

/** Adds cards one after another: Enter adds and stays open, Escape closes. A date or a priority can be typed in ("Pay rent fri !high"). */
function Composer({ onAdd, onClose }) {
  const [text, setText] = useState('')
  const input = useRef(null)
  const { parsed, keep } = useQuickParse(text)
  useEffect(() => {
    input.current?.focus()
    input.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  const submit = () => {
    if (!parsed.title) return
    const { title, due, priority, recurrence } = parsed
    setText('')
    onAdd(title, Object.fromEntries(Object.entries({ due, priority, recurrence }).filter(([, v]) => v)))
    requestAnimationFrame(() => input.current?.scrollIntoView({ block: 'nearest' }))
  }
  return (
    <div className="pb-composer" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !text.trim() && onClose()}>
      <textarea
        ref={input}
        rows={2}
        aria-label="Title of the new card"
        placeholder="Enter a title… “Pay rent fri !high”"
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
      <LinkSuggest field={input} />
      <ParsedChips found={parsed.found} onKeep={keep} />
      <div className="pb-composer-actions">
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

function AddList({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!t) return
    onAdd(t)
    setText('')
  }
  if (!open)
    return (
      <button type="button" className="pb-add-list" onClick={() => setOpen(true)}>
        <Plus /> Add another list
      </button>
    )
  return (
    <div className="pb-add-list open" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !text.trim() && setOpen(false)}>
      <input
        className="input"
        autoFocus
        aria-label="Name of the new list"
        placeholder="Enter list name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      <div className="pb-composer-actions">
        <button type="button" className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add list
        </button>
        <button type="button" className="icon-btn sm" aria-label="Close" onClick={() => setOpen(false)}>
          <X />
        </button>
      </div>
    </div>
  )
}

// ---------- the board ----------

const sortBy = {
  due: (a, b) => (K.cardTask(a)?.due || '9999').localeCompare(K.cardTask(b)?.due || '9999'),
  priority: (a, b) => priorityRank(K.cardTask(b)?.priority) - priorityRank(K.cardTask(a)?.priority),
  name: (a, b) => (K.cardTask(a)?.text ?? a.text).localeCompare(K.cardTask(b)?.text ?? b.text, undefined, { sensitivity: 'base' }),
}

/** `title`: the project's name; `onRename`, `onMarkdown`, `onDelete`: what the board's menu does about the note */
export function ProjectBoard({ handle, readOnly, title, onRename, onMarkdown, onDelete }) {
  const { board, mutate, ref: boardRef } = useBoard(handle)
  const today = useToday()
  const { ws, path } = handle
  const [filter, setFilter] = useState(NO_FILTER)
  const [open, setOpen] = useState(null) // the card whose dialog is open: its id (which follows its words)
  const [opened, setOpened] = useState(0) // how many times a dialog has been opened: a new one each time
  const openCard = useCallback((id) => {
    setOpen(id)
    setOpened((n) => n + 1)
  }, [])
  const [composer, setComposer] = useState(null) // the list being added to: its id
  const [renaming, setRenaming] = useState(null) // the list being renamed: its id
  const [panel, setPanel] = useState(null) // 'automation' | 'archive'
  const [filterAt, setFilterAt] = useState(null) // the filter button, while its card is open
  const [colorAt, setColorAt] = useState(null) // { el, lane } while a list's colours are open
  const [emojiAt, setEmojiAt] = useState(null) // { el, board } or { el, lane }
  const lanesEl = useRef(null)
  const opts = useMemo(() => ({ today }), [today])

  const shown = useCallback((card) => passes(card, filter, today), [filter, today])
  const counts = useMemo(() => {
    const cards = board.lanes.flatMap((l) => l.items)
    return { total: cards.length, open: cards.filter((c) => isOpen(c.status ?? ' ')).length }
  }, [board])
  // to filter by: the board's labels, and any other tag a card has
  const labels = useMemo(() => {
    const seen = new Map(K.boardLabels(board).map((l) => [l.name, l.name]))
    for (const l of board.lanes) for (const c of l.items) for (const t of K.cardTask(c)?.tags || []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [board])
  // labels as thin bars, or with their names (remembered, for every board)
  const [labelNames, setLabelNames] = useState(() => {
    try {
      return localStorage.getItem('obi:labelNames') === '1'
    } catch {
      return false
    }
  })
  const toggleLabelNames = useCallback(
    () =>
      setLabelNames((v) => {
        try {
          localStorage.setItem('obi:labelNames', v ? '0' : '1')
        } catch {}
        return !v
      }),
    [],
  )

  // a change to the card `id`; the dialog follows it to its new id
  const changeCard = useCallback(
    (id, fn) => {
      let card = null
      mutate((b) => {
        const hit = K.findCard(b, id)
        if (!hit) return false
        card = hit.card
        return fn(b, hit.card, hit.lane)
      })
      if (card) setOpen((o) => (o === id ? card.id : o))
      return card
    },
    [mutate],
  )

  const toggle = useCallback((card) => changeCard(card.id, (b, c) => K.setCardStatus(b, c, isOpen(c.status ?? ' ') ? 'x' : ' ', opts)), [changeCard, opts])

  const removeCard = useCallback(
    (card) => {
      let where = null
      mutate((b) => {
        const hit = K.findCard(b, card.id)
        if (!hit) return false
        where = { lane: hit.lane?.title, index: hit.index, card: { ...hit.card, extra: [...hit.card.extra] } }
        K.deleteCard(b, hit.card)
      })
      if (!where) return
      setOpen((o) => (o === card.id ? null : o))
      toast.success('Card deleted', {
        timeout: 7000,
        action: {
          label: 'Undo',
          run: () =>
            mutate((b) => {
              const lane = (where.lane && K.laneNamed(b, where.lane)) || b.lanes[0]
              if (!lane) return false
              lane.items.splice(Math.min(where.index, lane.items.length), 0, where.card)
            }),
        },
      })
    },
    [mutate],
  )

  const archive = useCallback(
    (card) => {
      const hit = K.findCard(boardRef.current, card.id)
      if (!hit?.lane) return
      const where = { lane: hit.lane.title, index: hit.index, text: hit.card.text }
      mutate((b) => K.archiveCard(b, K.findCard(b, card.id).card))
      setOpen((o) => (o === card.id ? null : o))
      toast.success('Card archived', {
        timeout: 7000,
        action: {
          label: 'Undo',
          run: () =>
            mutate((b) => {
              const archived = b.archive || []
              const at = archived.map((c) => c.text).lastIndexOf(where.text)
              const lane = K.laneNamed(b, where.lane) || b.lanes[0]
              if (at < 0 || !lane) return false
              const [c] = archived.splice(at, 1)
              lane.items.splice(Math.min(where.index, lane.items.length), 0, c)
            }),
        },
      })
    },
    [mutate, boardRef],
  )

  const cardMenu = (e, card, lane) => {
    if (e.target.closest('a') || drag) return
    const task = K.cardTask(card)
    const open_ = isOpen(card.status ?? ' ')
    const set = (patch) => () => changeCard(card.id, (b, c) => void K.editCard(c, patch, opts))
    const nextWeek = weekStartOf(addDays(today, 7), 1)
    const others = board.lanes.filter((l) => l.id !== lane.id)
    useUI.getState().showContextMenu(e, [
      { label: 'Open card', icon: Pencil, hint: 'Enter', run: () => openCard(card.id) },
      ...(readOnly
        ? []
        : [
            { label: open_ ? 'Mark done' : 'Mark not done', icon: CircleCheckBig, hint: 'Space', run: () => toggle(card) },
            ...(others.length ? [{ section: 'Move to' }] : []),
            ...others.map((l) => ({ label: l.title, icon: ArrowRight, run: () => changeCard(card.id, (b, c) => K.moveCard(b, c, K.laneNamed(b, l.title), null, opts)) })),
            { section: 'Due' },
            { label: 'Today', icon: task?.due === today ? CircleCheckBig : CalendarDays, run: set({ due: today }) },
            { label: 'Tomorrow', icon: task?.due === addDays(today, 1) ? CircleCheckBig : CalendarDays, run: set({ due: addDays(today, 1) }) },
            { label: 'Next week', icon: task?.due === nextWeek ? CircleCheckBig : CalendarDays, run: set({ due: nextWeek }) },
            task?.due && { label: 'No due date', icon: X, run: set({ due: null }) },
            'divider',
            { label: 'Archive', icon: Archive, run: () => archive(card) },
            { label: 'Delete card', icon: Trash2, danger: true, run: () => removeCard(card) },
          ]),
    ])
  }

  const deleteList = async (lane) => {
    if (lane.items.length) {
      const ok = await confirmDialog({
        title: `Delete “${lane.title}”?`,
        message: `Its ${lane.items.length} ${lane.items.length === 1 ? 'card goes' : 'cards go'} with it. You can undo this for a moment afterwards.`,
        confirmText: 'Delete list',
        danger: true,
      })
      if (!ok) return
    }
    let where = null
    mutate((b) => {
      const at = b.lanes.findIndex((l) => l.id === lane.id)
      if (at < 0) return false
      where = { at, lane: b.lanes.splice(at, 1)[0] }
    })
    if (where)
      toast.success(`List “${lane.title}” deleted`, {
        timeout: 8000,
        action: { label: 'Undo', run: () => mutate((b) => void b.lanes.splice(Math.min(where.at, b.lanes.length), 0, where.lane)) },
      })
  }

  const listMenu = (e, lane) => {
    const el = e.currentTarget
    const others = board.lanes.filter((l) => l.id !== lane.id)
    const inLane = (fn) => () => mutate((b) => fn(b, b.lanes.find((l) => l.id === lane.id)))
    useUI.getState().showContextMenu(menuFromElement(el), [
      { label: 'Add a card', icon: Plus, run: () => setComposer(lane.id) },
      { label: 'Rename list', icon: Pencil, run: () => setRenaming(lane.id) },
      { label: 'Colour…', icon: Palette, run: () => setColorAt({ el, lane: lane.id }) },
      { label: K.laneEmoji(board, lane) ? 'Change emoji…' : 'Emoji…', icon: Smile, run: () => setEmojiAt({ el, lane: lane.id }) },
      lane.items.length > 1 && { section: 'Sort cards by' },
      ...(lane.items.length > 1
        ? [
            { label: 'Due date', icon: CalendarDays, run: inLane((b, l) => void l.items.sort(sortBy.due)) },
            { label: 'Priority', icon: Flag, run: inLane((b, l) => void l.items.sort(sortBy.priority)) },
            { label: 'Name', icon: SortAsc, run: inLane((b, l) => void l.items.sort(sortBy.name)) },
          ]
        : []),
      lane.items.length > 0 && others.length > 0 && { section: 'Move all cards to' },
      ...(lane.items.length
        ? others.map((o) => ({
            label: o.title,
            icon: ArrowRight,
            run: inLane((b, l) => {
              const to = K.laneNamed(b, o.title)
              for (const c of [...l.items]) K.moveCard(b, c, to, null, opts)
            }),
          }))
        : []),
      'divider',
      lane.items.length > 0 && { label: 'Archive all cards in this list', icon: Archive, run: inLane((b, l) => [...l.items].forEach((c) => K.archiveCard(b, c))) },
      { label: 'Delete list', icon: Trash2, danger: true, run: () => deleteList(lane) },
    ])
  }

  // with people: the note's own sharing (or, in a private workspace, why it can't be)
  const share = () => useUI.getState().openModal('share', { ws, path })
  const barMenu = useRef(null)

  const boardMenu = (e) => {
    const archived = board.archive?.length || 0
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      { label: 'Share…', icon: Share2, run: share },
      { label: 'Automation', icon: Zap, run: () => setPanel('automation') },
      !readOnly && { label: 'Board colour…', icon: Palette, run: () => setColorAt({ el: barMenu.current, board: true }) },
      !readOnly && { label: K.boardEmoji(board) ? 'Change icon…' : 'Icon…', icon: Smile, run: () => setEmojiAt({ el: barMenu.current, board: true }) },
      { label: archived ? `Archived cards (${archived})` : 'Archived cards', icon: Archive, run: () => setPanel('archive') },
      'divider',
      onMarkdown && { label: 'Open as markdown', icon: FileText, run: onMarkdown },
      !readOnly && onRename && { label: 'Rename project…', icon: Pencil, run: onRename },
      !readOnly && onDelete && { label: 'Delete project', icon: Trash2, danger: true, run: onDelete },
    ])
  }

  // ---------- dragging (boardDrag.js) ----------

  // where a card or list starts from: its own place, so letting go there changes nothing
  const startDrop = (item) => {
    const b = boardRef.current
    if (item.kind === 'list') return { list: b.lanes.findIndex((l) => l.id === item.id) }
    const lane = b.lanes.find((l) => l.id === item.lane)
    return { lane: item.lane, index: lane ? lane.items.filter(shown).findIndex((c) => c.id === item.id) : 0 }
  }
  const onDrop = (item, where) => {
    if (item.kind === 'list') {
      return mutate((b) => {
        const at = b.lanes.findIndex((l) => l.id === item.id)
        if (at < 0 || where.list == null) return false
        const [lane] = b.lanes.splice(at, 1)
        b.lanes.splice(Math.min(where.list, b.lanes.length), 0, lane)
      })
    }
    // `index` counts the cards shown in the lane (a filter may hide some), the dragged one aside
    const target = boardRef.current.lanes.find((l) => l.id === where.lane)
    if (!target) return
    const visible = target.items.filter((c) => shown(c) && c.id !== item.id)
    const before = visible[where.index]?.id
    const after = before ? null : visible[visible.length - 1]?.id
    changeCard(item.id, (b, c) => {
      const to = b.lanes.find((l) => l.id === where.lane)
      if (!to) return false
      let at = null
      if (before) at = to.items.findIndex((x) => x.id === before)
      else if (after) at = to.items.findIndex((x) => x.id === after) + 1
      return K.moveCard(b, c, to, at, opts)
    })
  }
  const { drag, drop, press, justDragged } = useBoardDrag({ lanesRef: lanesEl, onDrop, startDrop })
  const hiding = drag?.id ?? null

  // ---------- colours ----------
  const labelColors = board.settings?.obi?.labels
  const labelColor = useCallback((tag) => colorHex(K.labelColor(board, tag)), [labelColors]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- drawing ----------

  const openHit = open ? K.findCard(board, open) : null
  useEffect(() => {
    if (open && !openHit) setOpen(null) // gone (deleted, or changed by someone else)
  }, [open, openHit])

  const nFilters = filterCount(filter)
  let listSlot = 0 // lists drawn so far, but the one being dragged
  // (a board with no colour of its own has no tint; its dot keeps the colour its name gives it)
  const tint = colorHex(K.boardColor(board))
  const boardIcon = K.boardEmoji(board)
  const color = tint || projectColor(path)
  const placeholder = (key, h) => <div key={key} className="pb-placeholder" style={{ height: h || 38 }} />
  const dragging = drag?.kind

  return (
    <div className={`pb ${tint ? 'tinted' : ''}`} style={{ '--project': color }}>
      <div className="pb-bar">
        {boardIcon ? (
          <button type="button" className="pb-icon" title={readOnly ? undefined : 'Change the icon'} disabled={readOnly} onClick={(e) => setEmojiAt({ el: e.currentTarget, board: true })}>
            {boardIcon}
          </button>
        ) : (
          <span className="pb-dot-wrap">
            <span className="pb-dot" />
            {!readOnly && (
              <button type="button" className="pb-icon-add" title="Give the board an icon" aria-label="Give the board an icon" onClick={(e) => setEmojiAt({ el: e.currentTarget, board: true })}>
                <Smile />
              </button>
            )}
          </span>
        )}
        <h2 className="pb-name" title={readOnly ? title : 'Rename project'} onClick={() => !readOnly && onRename?.()}>
          {title}
        </h2>
        <span className="pb-stat">
          {counts.open} open · {counts.total} {counts.total === 1 ? 'card' : 'cards'}
        </span>
        <div className="grow" />
        <label className="pb-search">
          <Search />
          <input placeholder="Filter cards…" aria-label="Filter cards" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setFilter({ ...filter, q: '' })} />
        </label>
        <button type="button" className={`btn btn-sm ${nFilters ? 'on' : ''}`} onClick={(e) => setFilterAt(filterAt ? null : e.currentTarget)}>
          <ListFilter /> Filter{nFilters ? ` · ${nFilters}` : ''}
        </button>
        <button type="button" className={`btn btn-sm ${panel === 'automation' ? 'on' : ''}`} title="Rules: what happens when a card moves or is marked done" onClick={() => setPanel(panel === 'automation' ? null : 'automation')}>
          <Zap /> Automation <span className="pb-pill">{ruleCount(board)}</span>
        </button>
        <button type="button" className="btn btn-sm" title="Share this board with people to work on it together" onClick={share}>
          <Share2 /> Share
        </button>
        <button type="button" className="icon-btn" title="Board menu" ref={barMenu} onClick={boardMenu}>
          <MoreHorizontal />
        </button>
      </div>

      <div className="pb-body">
        <div className="pb-lanes" ref={lanesEl}>
          {board.lanes.map((lane) => {
            const visible = lane.items.filter(shown)
            const lc = K.laneColor(board, lane)
            const dropping = dragging === 'card' && drop?.lane === lane.id
            // (what is being dragged stays in the page, hidden, so its drag goes on; the gap shows where it would land)
            const items = []
            let n = 0
            for (const c of visible) {
              if (dropping && c.id !== hiding && n === drop.index) items.push(placeholder('ph', drag.height))
              items.push(
                <Card
                  key={c.id}
                  card={c}
                  today={today}
                  ws={ws}
                  path={path}
                  readOnly={readOnly}
                  hidden={c.id === hiding}
                  cover={K.cardCover(board, c)}
                  labelColor={labelColor}
                  labelNames={labelNames}
                  onLabelNames={toggleLabelNames}
                  quiet={justDragged}
                  onOpen={() => openCard(c.id)}
                  onToggle={() => toggle(c)}
                  onMenu={(e) => cardMenu(e, c, lane)}
                  onPress={readOnly ? undefined : (e) => press(e, { kind: 'card', id: c.id, lane: lane.id })}
                />,
              )
              if (c.id !== hiding) n++
            }
            if (dropping && drop.index >= n) items.push(placeholder('ph', drag.height))
            const out = []
            if (dragging === 'list' && hiding !== lane.id && drop?.list === listSlot) out.push(<div key={`lph-${lane.id}`} className="pb-list pb-list-placeholder" style={{ height: drag.height }} />)
            if (hiding !== lane.id) listSlot++
            out.push(
              <section
                key={lane.id}
                className={`pb-list ${hiding === lane.id ? 'is-dragging' : ''} ${dropping ? 'over' : ''}`}
                data-color={lc || undefined}
                data-lane={lane.id}
                aria-label={`${lane.title}, ${visible.length} ${visible.length === 1 ? 'card' : 'cards'}`}
              >
                <header
                  className="pb-list-head"
                  onPointerDown={readOnly || renaming === lane.id ? undefined : (e) => press(e, { kind: 'list', id: lane.id, el: e.currentTarget.closest('.pb-list') })}
                >
                  {renaming === lane.id ? (
                    <input
                      className="input pb-rename"
                      autoFocus
                      defaultValue={lane.title}
                      aria-label="List name"
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const v = e.target.value.replace(/\s+/g, ' ').trim()
                        setRenaming(null)
                        if (v && v !== lane.title) mutate((b) => K.renameLane(b, b.lanes.find((l) => l.id === lane.id), v))
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') {
                          e.currentTarget.value = lane.title
                          e.currentTarget.blur()
                        }
                      }}
                    />
                  ) : (
                    <>
                      {K.laneEmoji(board, lane) && (
                        <button
                          type="button"
                          className="pb-list-emoji"
                          title={readOnly ? undefined : 'Change the emoji'}
                          disabled={readOnly}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => setEmojiAt({ el: e.currentTarget, lane: lane.id })}
                        >
                          {K.laneEmoji(board, lane)}
                        </button>
                      )}
                      <h3 onClick={() => !readOnly && !justDragged() && setRenaming(lane.id)} title={readOnly ? undefined : 'Rename list'}>
                        {lane.title}
                      </h3>
                    </>
                  )}
                  <span className="pb-count">{nFilters ? `${visible.length}/${lane.items.length}` : lane.items.length}</span>
                  {!readOnly && (
                    <button type="button" className="icon-btn sm" aria-label={`${lane.title} list menu`} onClick={(e) => listMenu(e, lane)}>
                      <MoreHorizontal />
                    </button>
                  )}
                </header>
                <div className="pb-cards">
                  {items}
                  {!visible.length && !dropping && lane.items.length > 0 && <div className="pb-hidden">{lane.items.length} hidden by the filter</div>}
                </div>
                {!readOnly &&
                  (composer === lane.id ? (
                    <Composer
                      onAdd={(t, fields) => mutate((b) => void K.addCard(b, b.lanes.find((l) => l.id === lane.id), t, fields, opts))}
                      onClose={() => setComposer(null)}
                    />
                  ) : (
                    <button type="button" className="pb-add-card" onClick={() => setComposer(lane.id)}>
                      <Plus /> Add a card
                    </button>
                  ))}
              </section>,
            )
            return out
          })}
          {dragging === 'list' && drop?.list >= listSlot && <div className="pb-list pb-list-placeholder" style={{ height: drag.height }} />}
          {!readOnly && <AddList onAdd={(t) => mutate((b) => void b.lanes.push({ title: t, items: [], extra: [], complete: false }))} />}
        </div>

        {panel === 'automation' && <Automation board={board} mutate={mutate} readOnly={readOnly} onClose={() => setPanel(null)} />}
        {panel === 'archive' && (
          <ArchivePanel
            board={board}
            ws={ws}
            path={path}
            readOnly={readOnly}
            onRestore={(card) => mutate((b) => K.restoreCard(b, (b.archive || []).find((c) => c.id === card.id), b.lanes[0]))}
            onDelete={(card) => mutate((b) => K.deleteCard(b, (b.archive || []).find((c) => c.id === card.id)))}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {filterAt && (
        <Popover anchor={filterAt} onClose={() => setFilterAt(null)} className="pb-filter">
          <FilterCard filter={filter} labels={labels} onChange={setFilter} />
        </Popover>
      )}
      {colorAt &&
        (() => {
          // (it stays open: try a colour, then another; × , Escape or a click outside closes it)
          const current = colorAt.board ? K.boardColor(board) : K.laneColor(board, board.lanes.find((l) => l.id === colorAt.lane) || {})
          const pick = (c) => (colorAt.board ? mutate((b) => K.setBoardColor(b, c)) : mutate((b) => K.setLaneColor(b, b.lanes.find((l) => l.id === colorAt.lane), c)))
          return (
            <Popover anchor={colorAt.el} onClose={() => setColorAt(null)} className="color-pop">
              <PopHead title={colorAt.board ? 'Board colour' : 'List colour'} onClose={() => setColorAt(null)} />
              <div className="pop-body">
                <Colors value={current} onPick={pick} />
                {current && (
                  <button type="button" className="lp-create" onClick={() => pick(null)}>
                    Remove colour
                  </button>
                )}
              </div>
            </Popover>
          )
        })()}
      {emojiAt &&
        (() => {
          const lane = emojiAt.lane && board.lanes.find((l) => l.id === emojiAt.lane)
          const current = emojiAt.board ? K.boardEmoji(board) : lane ? K.laneEmoji(board, lane) : null
          const pick = (e) => {
            if (emojiAt.board) mutate((b) => K.setBoardEmoji(b, e))
            else mutate((b) => K.setLaneEmoji(b, b.lanes.find((l) => l.id === emojiAt.lane), e))
            setEmojiAt(null)
          }
          return (
            <Popover anchor={emojiAt.el} onClose={() => setEmojiAt(null)} align="left" className="emoji-pop">
              <PopHead title={emojiAt.board ? 'Board icon' : `Emoji for “${lane?.title || 'list'}”`} onClose={() => setEmojiAt(null)} />
              <EmojiPicker value={current} onPick={pick} onClear={() => pick(null)} />
            </Popover>
          )
        })()}
      {openHit && openHit.lane && (
        <CardDialog
          key={opened}
          board={board}
          hit={openHit}
          ws={ws}
          path={path}
          readOnly={readOnly}
          today={today}
          change={(fn) => changeCard(open, fn)}
          labelColor={labelColor}
          onArchive={() => archive(openHit.card)}
          onDelete={() => removeCard(openHit.card)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function FilterCard({ filter, labels, onChange }) {
  const set = (patch) => onChange({ ...filter, ...patch })
  const dues = [
    [null, 'Any time'],
    ['overdue', 'Overdue'],
    ['today', 'Due today'],
    ['week', 'Due in the next week'],
    ['none', 'No due date'],
  ]
  return (
    <div className="pb-filter-body">
      <div className="pb-filter-head">
        <b>Filter</b>
        {filterCount(filter) > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(NO_FILTER)}>
            Clear
          </button>
        )}
      </div>
      <div className="td-label">Labels</div>
      {labels.length ? (
        <div className="pb-filter-labels">
          {labels.map((t) => {
            const on = filter.labels.some((l) => l.toLowerCase() === t.toLowerCase())
            return (
              <button key={t} type="button" className={`pb-filter-label ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ labels: on ? filter.labels.filter((l) => l.toLowerCase() !== t.toLowerCase()) : [...filter.labels, t] })}>
                <Label tag={t} />
              </button>
            )
          })}
        </div>
      ) : (
        <div className="faint pb-filter-none">No labels yet. Add #tags to cards to label them.</div>
      )}
      <div className="td-label">Due</div>
      <div className="pb-filter-dues">
        {dues.map(([v, label]) => (
          <button key={label} type="button" className={`pb-filter-due ${filter.due === v ? 'on' : ''}`} aria-pressed={filter.due === v} onClick={() => set({ due: v })}>
            {label}
          </button>
        ))}
      </div>
      <label className="te-check pb-filter-done">
        <input type="checkbox" checked={filter.done} onChange={(e) => set({ done: e.target.checked })} />
        Show done cards
      </label>
    </div>
  )
}

function ArchivePanel({ board, ws, path, readOnly, onRestore, onDelete, onClose }) {
  const cards = board.archive || []
  return (
    <aside className="pb-panel" aria-label="Archived cards">
      <header className="pb-panel-head">
        <Archive />
        <h3>Archived cards</h3>
        <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="pb-panel-body">
        {!cards.length && <p className="faint">Nothing archived. Archive a card from its menu to put it away without deleting it.</p>}
        {cards.map((c) => {
          const t = K.cardTask(c)
          return (
            <div key={c.id} className="pb-archived">
              <span className="pb-words" dangerouslySetInnerHTML={{ __html: wordsHtml(splitTags(t?.text ?? c.text).title || 'Untitled card', ws, path) }} />
              {!readOnly && (
                <div className="pb-archived-actions">
                  <button type="button" className="btn btn-sm" disabled={!board.lanes.length} title={board.lanes[0] ? `Back to ${board.lanes[0].title}` : undefined} onClick={() => onRestore(c)}>
                    <ArchiveRestore /> Restore
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => onDelete(c)}>
                    <Trash2 /> Delete
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
