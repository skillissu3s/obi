// A project's card, opened: everything about it in one place, as on the back of
// a Trello card. Each change is written to the board at once (`change` runs on a
// copy of the board, see ProjectBoard), and the project's rules apply to it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlignLeft, Archive, Flag, ListChecks, Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import * as K from '@shared/kanban.js'
import { PRIORITIES, cleanTag, isOpen, joinTags, parseRecurrence, splitTags } from '@shared/tasks.js'
import { renderMarkdown } from '../lib/render.js'
import { openLink } from '../lib/actions.js'
import { Modal, Popover } from './ui.jsx'
import { PRIORITY_LABEL } from './TaskParts.jsx'
import { DateField, REPEATS } from './TaskDialog.jsx'
import { Colors, Label, PopHead, StatusIcon, dueTone } from './CardParts.jsx'
import { colorHex, colorLabel } from '../lib/colors.js'
import { LinkSuggest } from './LinkSuggest.jsx'
import { celebrate } from '../lib/celebrate.js'

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

/**
 * The board's labels, as Trello shows them: find one, tick it to put it on the
 * card, the pencil to rename or recolour it, or make a new one. A popover, so the
 * card doesn't move or grow under it.
 */
function LabelPicker({ tags, board, onToggle, onCreate, onEdit, onRemoveFromBoard, onClose }) {
  const [view, setView] = useState(null) // null: the list; { name?, color } editing or making one
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const has = (n) => tags.some((t) => t.toLowerCase() === n.toLowerCase())
  const labels = K.boardLabels(board)
  const want = cleanTag(q).toLowerCase()
  const shown = labels.filter((l) => !want || l.name.includes(want))
  const open = (label) => {
    setView(label || { color: 'blue' })
    setName(label ? label.name : want)
    setColor(label ? label.color : 'blue')
  }
  if (view) {
    const editing = !!view.name
    const clean = cleanTag(name).toLowerCase()
    const taken = clean && clean !== view.name && labels.some((l) => l.name === clean)
    const save = () => {
      if (!clean) return
      if (editing) onEdit(view.name, clean, color)
      else onCreate(clean, color)
      setView(null)
      setQ('')
    }
    return (
      <>
        <PopHead title={editing ? 'Edit label' : 'Create a label'} onBack={() => setView(null)} onClose={onClose} />
        <div className="lp-preview">
          <span className="lp-bar static" data-color={color}>
            {clean || 'label'}
          </span>
        </div>
        <div className="pop-body">
          <label className="pop-label" htmlFor="lp-name">
            Title
          </label>
          <input id="lp-name" className="input" autoFocus value={name} placeholder="design, waiting, bug…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())} />
          {taken && <div className="lp-note">The board has a “{clean}” label already: saving joins the two.</div>}
          <div className="pop-label">Colour</div>
          <Colors value={color} onPick={setColor} />
          <div className="lp-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={!clean} onClick={save}>
              {editing ? 'Save' : 'Create'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-ghost btn-sm lp-delete"
                title="Cards that have it keep it, as a #tag"
                onClick={() => {
                  onRemoveFromBoard(view.name)
                  setView(null)
                }}
              >
                Remove from board
              </button>
            )}
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <PopHead title="Labels" onClose={onClose} />
      <div className="pop-body">
        <input
          className="input"
          autoFocus
          aria-label="Search labels"
          placeholder="Search labels…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (shown[0] && shown[0].name === want) onToggle(shown[0].name)
            else if (want) open(null)
          }}
        />
        <div className="pop-label">Labels</div>
        <ul className="lp-list">
          {shown.map((l) => (
            <li key={l.name} className="lp-row">
              <input type="checkbox" className="lp-check" checked={has(l.name)} aria-label={`${l.name} on this card`} onChange={() => onToggle(l.name)} />
              <button type="button" className="lp-bar" data-color={l.color} aria-pressed={has(l.name)} onClick={() => onToggle(l.name)}>
                {l.name}
              </button>
              <button type="button" className="icon-btn sm" aria-label={`Edit ${l.name}`} title="Edit label" onClick={() => open(l)}>
                <Pencil />
              </button>
            </li>
          ))}
          {!shown.length && <li className="lp-empty">No label called “{want}” yet.</li>}
        </ul>
        <button type="button" className="lp-create" onClick={() => open(null)}>
          {want && !labels.some((l) => l.name === want) ? `Create “${want}”` : 'Create a new label'}
        </button>
      </div>
    </>
  )
}

/** A card's labels: chips, and + to pick; either opens the board's labels in a popover */
function Labels({ tags, board, readOnly, colorOf, ...actions }) {
  const [anchor, setAnchor] = useState(null)
  const show = (e) => setAnchor(anchor ? null : e.currentTarget)
  return (
    <div className="cd-labels">
      {tags.map((t) => (
        <Label key={t} tag={t} color={colorOf(t)} onClick={readOnly ? undefined : show} />
      ))}
      {!readOnly && (
        <button type="button" className={`cd-label-add ${anchor ? 'on' : ''}`} aria-label="Labels" title="Labels" aria-expanded={!!anchor} onClick={show}>
          <Plus />
          {!tags.length && <span>Add a label</span>}
        </button>
      )}
      {anchor && (
        <Popover anchor={anchor} align="left" className="label-pop" onClose={() => setAnchor(null)}>
          <LabelPicker tags={tags} board={board} onClose={() => setAnchor(null)} {...actions} />
        </Popover>
      )}
    </div>
  )
}

/** The card's cover: a button showing it; the colours to pick from in a popover, and a way to take it off */
function CoverField({ cover, readOnly, onPick }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <button type="button" className={`cd-cover-btn ${anchor ? 'on' : ''}`} disabled={readOnly} aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {cover ? (
          <>
            <span className="cd-cover-chip" data-color={cover} /> {colorLabel(cover)}
          </>
        ) : (
          <>
            <Palette /> Add a cover
          </>
        )}
      </button>
      {anchor && (
        <Popover anchor={anchor} align="left" className="cover-pop" onClose={() => setAnchor(null)}>
          <PopHead title="Cover" onClose={() => setAnchor(null)} />
          <div className="pop-body">
            <div className="pop-label">Colours</div>
            <Colors value={cover} onPick={onPick} />
            {cover && (
              <button type="button" className="lp-create" onClick={() => (onPick(null), setAnchor(null))}>
                Remove cover
              </button>
            )}
          </div>
        </Popover>
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
          <LinkSuggest field={box} />
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
  const addEl = useRef(null)
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
              <input type="checkbox" className="task-cb" checked={done} disabled={readOnly} aria-label={done ? 'Mark not done' : 'Mark done'} onChange={(e) => (!done && celebrate(e.currentTarget), change((b, c) => K.editChecklistItem(c, t.at, { status: done ? ' ' : 'x' }, { today })))} />
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
          <input ref={addEl} aria-label="Add an item" placeholder="Add an item…  [[ links a note or board" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <LinkSuggest field={addEl} />
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
    <Modal title={null} label="Card" onClose={onClose} className={`card-dialog ${cover ? 'has-cover' : ''}`} style={cover ? { '--cover': colorHex(cover) } : undefined} bodyClass="cd-shell">
      <div className="cd">
        <header className="cd-head">
          <button type="button" className={`pb-check cd-check ${isOpen(status) ? '' : 'on'}`} disabled={readOnly} aria-label={isOpen(status) ? 'Mark done' : 'Mark not done'} onClick={(e) => (isOpen(status) && celebrate(e.currentTarget), change((b, c) => K.setCardStatus(b, c, isOpen(status) ? 'x' : ' ', opts)))}>
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
            <LinkSuggest key={title} field={titleEl} />
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
                  onToggle={(name) => change((b, c) => K.setCardTags(c, tags.some((t) => t.toLowerCase() === name) ? tags.filter((t) => t.toLowerCase() !== name) : [...tags, name], opts))}
                  onCreate={(name, color) =>
                    change((b, c) => {
                      K.setLabelColor(b, name, color)
                      if (!tags.some((t) => t.toLowerCase() === name)) K.setCardTags(c, [...tags, name], opts)
                    })
                  }
                  onEdit={(was, name, color) =>
                    change((b) => {
                      if (name !== was) K.renameLabel(b, was, name, opts)
                      K.setLabelColor(b, name, color)
                    })
                  }
                  onRemoveFromBoard={(t) => change((b) => K.removeBoardLabel(b, t))}
                />
              </Field>
              <Field label="Cover" wide>
                <CoverField cover={cover} readOnly={readOnly} onPick={(c) => change((b, cd) => K.setCardCover(b, cd, c))} />
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
