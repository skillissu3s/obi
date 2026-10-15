// A project's card, opened: everything about it in one place, as on the back of
// a Trello card. Each change is written to the board at once (`change` runs on a
// copy of the board, see ProjectBoard), and the project's rules apply to it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlignLeft, Archive, Flag, ListChecks, Palette, Plus, Trash2, X } from 'lucide-react'
import * as K from '@shared/kanban.js'
import { PRIORITIES, cleanTag, isOpen, joinTags, parseRecurrence, splitTags } from '@shared/tasks.js'
import { renderMarkdown } from '../lib/render.js'
import { openLink } from '../lib/actions.js'
import { Modal } from './ui.jsx'
import { PRIORITY_LABEL } from './TaskParts.jsx'
import { DateField, REPEATS } from './TaskDialog.jsx'
import { Label, StatusIcon, dueTone } from './CardParts.jsx'
import { colorLabel } from '../lib/colors.js'

const STATUSES = [
  [' ', 'To do'],
  ['/', 'In progress'],
  ['x', 'Done'],
]

function Field({ label, children, wide }) {
  return (
    <div className={`cd-field ${wide ? 'wide' : ''}`}>
      <div className="td-label">{label}</div>
      {children}
    </div>
  )
}

// What is being typed when the dialog closes (Escape, a click outside) is kept,
// not lost: `save(value)` runs then if it differs from `saved`.
function useKeepOnClose(saved, save) {
  const live = useRef({ value: null, saved, save })
  live.current.saved = saved
  live.current.save = save
  useEffect(
    () => () => {
      const { value, saved: was, save: write } = live.current
      if (value != null && value !== was) write(value)
    },
    [],
  )
  return (value) => (live.current.value = value)
}

const grow = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// A row of colours to pick from (and none), the one in use marked
function Swatches({ value, onPick, small, none = true }) {
  return (
    <div className={`cd-swatches ${small ? 'small' : ''}`}>
      {[...(none ? [null] : []), ...K.PROJECT_COLORS].map((c) => (
        <button key={c || 'none'} type="button" className={`pb-swatch ${value === c ? 'on' : ''}`} data-color={c || undefined} title={colorLabel(c)} aria-label={colorLabel(c)} aria-pressed={value === c} onClick={() => onPick(c)}>
          {!c && <X />}
        </button>
      ))}
    </div>
  )
}

/**
 * A card's labels, and the board's to pick from: tick one to put it on the card,
 * type a name to find one or make a new one (in the colour picked below), and
 * recolour or take a label off the board from its row.
 */
function Labels({ tags, board, readOnly, colorOf, onChange, onColor, onRemoveFromBoard }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [color, setColor] = useState('blue') // for a label made here
  const [recolor, setRecolor] = useState(null) // the label whose colour is being picked
  const has = (name) => tags.some((t) => t.toLowerCase() === name.toLowerCase())
  const toggle = (name) => onChange(has(name) ? tags.filter((t) => t.toLowerCase() !== name.toLowerCase()) : [...tags, name])
  const offered = K.boardLabels(board)
  const want = cleanTag(typed)
  const shown = offered.filter((l) => !want || l.name.includes(want.toLowerCase()))
  const isNew = want && !offered.some((l) => l.name === want.toLowerCase())
  const create = () => {
    if (!isNew) return shown[0] && toggle(shown[0].name)
    onColor(want, color)
    if (!has(want)) onChange([...tags, want])
    setTyped('')
  }
  return (
    <>
      <div className="cd-labels">
        {tags.map((t) => (
          <Label key={t} tag={t} color={colorOf(t)} onRemove={readOnly ? undefined : () => onChange(tags.filter((x) => x !== t))} />
        ))}
        {!readOnly && (
          <button type="button" className={`cd-label-add ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            <Plus /> {tags.length ? 'Labels' : 'Add a label'}
          </button>
        )}
      </div>
      {open && !readOnly && (
        <div className="cd-label-pick">
          <input
            className="input cd-label-search"
            autoFocus
            aria-label="Find or make a label"
            placeholder="Find or make a label…"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.preventDefault(), create())
              else if (e.key === 'Escape') (e.stopPropagation(), setOpen(false))
            }}
          />
          <ul className="cd-label-list">
            {shown.map((l) => (
              <li key={l.name}>
                <label className="cd-label-row">
                  <input type="checkbox" checked={has(l.name)} onChange={() => toggle(l.name)} />
                  <span className="cd-label-bar" data-color={l.color}>
                    {l.name}
                  </span>
                </label>
                <button type="button" className="icon-btn sm" title="Colour" aria-label={`Colour of ${l.name}`} onClick={() => setRecolor(recolor === l.name ? null : l.name)}>
                  <Palette />
                </button>
                <button type="button" className="icon-btn sm" title="Take it off this board (cards keep it)" aria-label={`Remove ${l.name} from the board`} onClick={() => onRemoveFromBoard(l.name)}>
                  <Trash2 />
                </button>
                {recolor === l.name && (
                  <div className="cd-label-recolor">
                    <Swatches
                      small
                      none={false}
                      value={l.color}
                      onPick={(c) => {
                        onColor(l.name, c)
                        setRecolor(null)
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {isNew && (
            <div className="cd-label-new">
              <Swatches small none={false} value={color} onPick={setColor} />
              <button type="button" className="btn btn-primary btn-sm" onClick={create}>
                Create “{want}”
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function Description({ text, ws, path, readOnly, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const box = useRef(null)
  const typing = useKeepOnClose(text, onSave)
  useLayoutEffect(() => {
    if (editing) {
      grow(box.current)
      box.current?.focus()
    }
    typing(editing ? draft : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft])
  const save = () => {
    setEditing(false)
    if (draft !== text) onSave(draft)
  }
  return (
    <section className="cd-section">
      <div className="cd-section-head">
        <AlignLeft />
        <h3>Description</h3>
        {!editing && text && !readOnly && (
          <button type="button" className="btn btn-sm" onClick={() => (setDraft(text), setEditing(true))}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            ref={box}
            className="textarea cd-desc-edit"
            value={draft}
            placeholder="Add a more detailed description… (markdown works)"
            onChange={(e) => {
              setDraft(e.target.value)
              grow(e.target)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
              else if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft(text)
                setEditing(false)
              }
            }}
          />
          <div className="cd-row">
            <button type="button" className="btn btn-primary btn-sm" onClick={save}>
              Save
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setDraft(text), setEditing(false))}>
              Cancel
            </button>
          </div>
        </>
      ) : text ? (
        <div
          className="markdown cd-desc"
          onClick={(e) => {
            const a = e.target.closest('a')
            if (a?.dataset.href) {
              e.preventDefault()
              openLink(ws, path, a.dataset.href, {})
            } else if (!a && !readOnly && !window.getSelection()?.toString()) {
              setDraft(text)
              setEditing(true)
            }
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { ws, path }).html }}
        />
      ) : (
        !readOnly && (
          <button type="button" className="cd-desc-empty" onClick={() => (setDraft(''), setEditing(true))}>
            Add a more detailed description…
          </button>
        )
      )}
    </section>
  )
}

function Checklist({ items, readOnly, today, change }) {
  const [text, setText] = useState('')
  const ticked = items.filter((t) => !isOpen(t.status)).length
  const add = () => {
    const title = text.replace(/\s+/g, ' ').trim()
    if (!title) return
    setText('')
    change((b, c) => K.addChecklistItem(c, title))
  }
  return (
    <section className="cd-section">
      <div className="cd-section-head">
        <ListChecks />
        <h3>Checklist</h3>
        {items.length > 0 && <span className="cd-count">{Math.round((ticked / items.length) * 100)}%</span>}
      </div>
      {items.length > 0 && (
        <div className={`cd-progress ${ticked === items.length ? 'full' : ''}`} role="progressbar" aria-label="Checklist done" aria-valuenow={ticked} aria-valuemax={items.length}>
          <i style={{ width: `${(ticked / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="cd-items">
        {items.map((t) => {
          const done = !isOpen(t.status)
          return (
            <li key={`${t.at}:${t.text}`} className={`cd-item ${done ? 'done' : ''}`} style={t.depth ? { paddingLeft: t.depth * 22 } : undefined}>
              <input type="checkbox" className="task-cb" checked={done} disabled={readOnly} aria-label={done ? 'Mark not done' : 'Mark done'} onChange={() => change((b, c) => K.editChecklistItem(c, t.at, { status: done ? ' ' : 'x' }, { today }))} />
              <input
                className="cd-item-text"
                aria-label="Checklist item"
                defaultValue={t.text}
                readOnly={readOnly}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => {
                  const title = e.target.value.replace(/\s+/g, ' ').trim()
                  if (!title) e.target.value = t.text
                  else if (title !== t.text) change((b, c) => K.editChecklistItem(c, t.at, { title }, { today }))
                }}
              />
              {!readOnly && (
                <button type="button" className="icon-btn sm cd-item-x" aria-label="Delete item" title="Delete item" onClick={() => change((b, c) => K.removeChecklistItem(c, t.at))}>
                  <X />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {!readOnly && (
        <div className="cd-item-add">
          <Plus />
          <input aria-label="Add an item" placeholder="Add an item…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
      )}
    </section>
  )
}

function RepeatField({ value, onChange }) {
  const [custom, setCustom] = useState(false)
  const base = (value || '').replace(/ when done$/i, '')
  const preset = REPEATS.some(([v]) => v === base.toLowerCase())
  const other = custom || (base && !preset)
  return (
    <div className="cd-repeat">
      <select
        className="input"
        aria-label="Repeat"
        value={other ? '__custom' : base.toLowerCase()}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          onChange(e.target.value || null)
        }}
      >
        {REPEATS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        <option value="__custom">Custom…</option>
      </select>
      {other && (
        <input
          className="input"
          aria-label="Repeat rule"
          placeholder="every 3 days, every monday and friday…"
          defaultValue={base}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== base && parseRecurrence(v)) onChange(v)
          }}
        />
      )}
    </div>
  )
}

/** `hit`: the card and its list, as findCard gives them; `change(fn)`: fn(board, card, lane) changes them */
export function CardDialog({ board, hit, ws, path, readOnly, today, change, labelColor, onArchive, onDelete, onClose }) {
  const { card, lane } = hit
  const task = K.cardTask(card)
  const status = card.status ?? ' '
  const { title, tags } = splitTags(task?.text ?? card.text)
  const { description, checklist } = K.cardDetails(card)
  const titleEl = useRef(null)
  useLayoutEffect(() => grow(titleEl.current), [title])
  const opts = { today }
  const edit = (patch) => change((b, c) => void K.editCard(c, patch, opts))
  // a new title: the card's cover (kept by its title) goes with it
  const retitle = (t) =>
    change((b, c) => {
      const was = K.cardKey(c)
      K.editCard(c, { title: joinTags(t, tags) }, opts)
      K.moveCover(b, was, c)
    })
  const typingTitle = useKeepOnClose(title, (next) => {
    const t = next.replace(/\s+/g, ' ').trim()
    if (t) retitle(t)
  })
  const cover = K.cardCover(board, card)

  return (
    <Modal title={null} label="Card" onClose={onClose} className="card-dialog" bodyClass="cd-shell">
      {cover && <div className="cd-cover" data-color={cover} />}
      <div className="cd">
        <header className="cd-head">
          <button type="button" className={`pb-check cd-check ${isOpen(status) ? '' : 'on'}`} disabled={readOnly} aria-label={isOpen(status) ? 'Mark done' : 'Mark not done'} onClick={() => change((b, c) => K.setCardStatus(b, c, isOpen(status) ? 'x' : ' ', opts))}>
            <StatusIcon status={status} />
          </button>
          <div className="cd-head-main">
            <textarea
              ref={titleEl}
              key={title}
              className="cd-title"
              rows={1}
              aria-label="Title"
              defaultValue={title}
              readOnly={readOnly}
              onInput={(e) => {
                grow(e.target)
                typingTitle(e.target.value.replace(/\s+/g, ' ').trim())
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
              onBlur={(e) => {
                const next = e.target.value.replace(/\s+/g, ' ').trim()
                typingTitle(null)
                if (!next) e.target.value = title
                else if (next !== title) retitle(next)
              }}
            />
            <div className="cd-where">
              in list
              <select
                className="cd-list"
                aria-label="List"
                value={lane.id}
                disabled={readOnly}
                onChange={(e) => change((b, c) => K.moveCard(b, c, b.lanes.find((l) => l.id === e.target.value), null, opts))}
              >
                {board.lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <div className="cd-grid">
          <fieldset className="cd-main" disabled={readOnly}>
            <div className="cd-fields">
              <Field label="Status">
                <div className="te-seg">
                  {STATUSES.map(([v, label]) => (
                    <button key={v} type="button" className={(v === 'x' ? !isOpen(status) : status === v) ? 'active' : ''} onClick={() => change((b, c) => K.setCardStatus(b, c, v, opts))}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Priority">
                <div className="te-seg td-pri">
                  <button type="button" className={!task?.priority ? 'active' : ''} onClick={() => edit({ priority: null })}>
                    None
                  </button>
                  {PRIORITIES.map((p) => (
                    <button key={p} type="button" className={`pri-${p} ${task?.priority === p ? 'active' : ''}`} title={PRIORITY_LABEL[p]} aria-label={PRIORITY_LABEL[p]} onClick={() => edit({ priority: p })}>
                      <Flag />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={<>Due date {task?.due && <span className={`cd-due-tone ${dueTone(task.due, status, today)}`}>{dueTone(task.due, status, today).replace('soon', 'tomorrow')}</span>}</>}>
                <DateField value={task?.due} today={today} onChange={(v) => edit({ due: v })} />
              </Field>
              <Field label="Repeat">
                <RepeatField value={task?.recurrence} onChange={(v) => edit({ recurrence: v })} />
              </Field>
              <Field label="Labels" wide>
                <Labels
                  tags={tags}
                  board={board}
                  readOnly={readOnly}
                  colorOf={labelColor}
                  onColor={(t, c) => change((b) => K.setLabelColor(b, t, c))}
                  onRemoveFromBoard={(t) => change((b) => K.removeBoardLabel(b, t))}
                  onChange={(next) => change((b, c) => K.setCardTags(c, next, opts))}
                />
              </Field>
              <Field label="Cover" wide>
                <Swatches value={cover} onPick={(c) => change((b, cd) => K.setCardCover(b, cd, c))} />
              </Field>
            </div>
            <Description text={description} ws={ws} path={path} readOnly={readOnly} onSave={(t) => change((b, c) => K.setDescription(c, t))} />
            <Checklist items={checklist} readOnly={readOnly} today={today} change={change} />
          </fieldset>

          {!readOnly && (
            <aside className="cd-side">
              <div className="td-label">Actions</div>
              <button type="button" className="cd-act" onClick={onArchive}>
                <Archive /> Archive
              </button>
              <button type="button" className="cd-act danger" onClick={onDelete}>
                <Trash2 /> Delete
              </button>
            </aside>
          )}
        </div>
      </div>
    </Modal>
  )
}
