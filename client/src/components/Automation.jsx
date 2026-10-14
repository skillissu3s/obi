// A project's rules, as sentences: "When a card is moved into Done, mark it
// done." Each can be turned off, changed or removed, and new ones made — the
// board's own Butler. The rules themselves are in shared/kanban.js.
import { useState } from 'react'
import { AlertTriangle, Pencil, Plus, RotateCcw, Trash2, X, Zap } from 'lucide-react'
import * as K from '@shared/kanban.js'
import { PRIORITIES } from '@shared/tasks.js'
import { Switch } from './ui.jsx'

const TRIGGERS = [
  ['into', 'is moved or added to'],
  ['outof', 'is moved out of'],
  ['added', 'is added to'],
  ['status', 'is marked'],
]
const ACTIONS = [
  ['status', 'mark it'],
  ['move', 'move it to'],
  ['due', 'set its due date to'],
  ['priority', 'set its priority to'],
  ['tag', 'add the label'],
  ['untag', 'remove the label'],
  ['archive', 'archive it'],
]
const STATUS_WORDS = { ' ': 'to do', '/': 'in progress', x: 'done' }
const DUE_WORDS = { today: 'today', tomorrow: 'tomorrow', 'next-week': 'next week', none: 'nothing (no due date)' }

/** How many of a board's rules are on */
export const ruleCount = (board) => K.rulesOf(board).filter((r) => !r.off).length

const hasList = (board, title) => !!K.laneNamed(board, title || '')

// A rule as a sentence: its parts, the names (lists, labels) marked out
function Sentence({ rule, board }) {
  const list = (t) => <b className={hasList(board, t) ? '' : 'missing'}>{t}</b>
  const when = {
    into: <>is moved or added to {list(rule.list)}</>,
    outof: <>is moved out of {list(rule.list)}</>,
    added: <>is added to {list(rule.list)}</>,
    status: <>is marked <b>{STATUS_WORDS[rule.status] || 'done'}</b></>,
  }[rule.on]
  const then = {
    status: <>mark it <b>{STATUS_WORDS[rule.value] || 'to do'}</b></>,
    move: <>move it to the {rule.at === 'top' ? 'top' : 'bottom'} of {list(rule.to)}</>,
    due: rule.value === 'none' ? <>remove its due date</> : <>make it due <b>{DUE_WORDS[rule.value]}</b></>,
    priority: rule.value ? <>set its priority to <b>{rule.value}</b></> : <>remove its priority</>,
    tag: <>add the label <b>#{rule.value}</b></>,
    untag: <>remove the label <b>#{rule.value}</b></>,
    archive: <>archive it</>,
  }[rule.do]
  return (
    <span className="au-sentence">
      When a card {when}, {then}.
    </span>
  )
}

function ListSelect({ lists, value, onChange }) {
  return (
    <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {!lists.includes(value) && value && <option value={value}>{value} (missing)</option>}
      {lists.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )
}

const broken = (rule, board) => (['into', 'outof', 'added'].includes(rule.on) && !hasList(board, rule.list)) || (rule.do === 'move' && !hasList(board, rule.to))

function Builder({ board, rule, onSave, onCancel }) {
  const first = board.lanes[0]?.title || ''
  const last = board.lanes[board.lanes.length - 1]?.title || first
  const [r, setR] = useState(() => rule || { on: 'into', list: last, do: 'status', value: 'x' })
  const set = (patch) => setR((x) => ({ ...x, ...patch }))
  const lists = board.lanes.map((l) => l.title)
  const setTrigger = (on) => set(on === 'status' ? { on, status: r.status ?? 'x', list: undefined } : { on, list: r.list || last, status: undefined })
  const setAction = (d) => {
    const base = { do: d, value: undefined, to: undefined, at: undefined }
    if (d === 'status') base.value = 'x'
    if (d === 'move') Object.assign(base, { to: last, at: 'top' })
    if (d === 'due') base.value = 'today'
    if (d === 'priority') base.value = 'high'
    if (d === 'tag' || d === 'untag') base.value = ''
    set(base)
  }
  const ok = (r.do !== 'tag' && r.do !== 'untag') || String(r.value || '').replace(/^#/, '').trim()
  return (
    <div className="au-builder">
      <div className="au-line">
        <span className="au-word">When a card</span>
        <select className="input" value={r.on} onChange={(e) => setTrigger(e.target.value)}>
          {TRIGGERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {r.on === 'status' ? (
          <select className="input" value={r.status} onChange={(e) => set({ status: e.target.value })}>
            {Object.entries(STATUS_WORDS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <ListSelect lists={lists} value={r.list} onChange={(list) => set({ list })} />
        )}
      </div>
      <div className="au-line">
        <span className="au-word">then</span>
        <select className="input" value={r.do} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {r.do === 'status' && (
          <select className="input" value={r.value} onChange={(e) => set({ value: e.target.value })}>
            {Object.entries(STATUS_WORDS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
        {r.do === 'move' && (
          <>
            <ListSelect lists={lists} value={r.to} onChange={(to) => set({ to })} />
            <select className="input" value={r.at} onChange={(e) => set({ at: e.target.value })} aria-label="Where in the list">
              <option value="top">at the top</option>
              <option value="bottom">at the bottom</option>
            </select>
          </>
        )}
        {r.do === 'due' && (
          <select className="input" value={r.value} onChange={(e) => set({ value: e.target.value })}>
            {Object.entries(DUE_WORDS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
        {r.do === 'priority' && (
          <select className="input" value={r.value || ''} onChange={(e) => set({ value: e.target.value || null })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="">none</option>
          </select>
        )}
        {(r.do === 'tag' || r.do === 'untag') && <input className="input" placeholder="label" aria-label="Label" value={r.value || ''} onChange={(e) => set({ value: e.target.value.replace(/\s+/g, '-') })} />}
      </div>
      <div className="au-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={() => onSave({ ...r, value: r.do === 'tag' || r.do === 'untag' ? String(r.value).replace(/^#/, '').trim() : r.value })}>
          {rule ? 'Save rule' : 'Add rule'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function Automation({ board, mutate, readOnly, onClose }) {
  const rules = K.rulesOf(board)
  const [editing, setEditing] = useState(null) // a rule's id, or 'new'
  const write = (fn) => mutate((b) => K.setRules(b, fn(K.rulesOf(b))))
  return (
    <aside className="pb-panel au" aria-label="Automation">
      <header className="pb-panel-head">
        <Zap />
        <h3>Automation</h3>
        <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="pb-panel-body">
        <p className="au-intro">Rules act when you move a card or mark it. What a rule does never sets off another rule, so each one does exactly what it says.</p>
        {!rules.length && <p className="faint">No rules: cards stay exactly where you put them.</p>}
        <ul className="au-rules">
          {rules.map((r) =>
            editing === r.id ? (
              <li key={r.id} className="au-rule editing">
                <Builder
                  board={board}
                  rule={r}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => {
                    write((all) => all.map((x) => (x.id === r.id ? { ...next, id: r.id, off: x.off } : x)))
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={r.id} className={`au-rule ${r.off ? 'off' : ''}`}>
                <Zap className="au-bolt" />
                <div className="au-text">
                  <Sentence rule={r} board={board} />
                  {broken(r, board) && (
                    <span className="au-warn">
                      <AlertTriangle /> Its list isn't on this board any more
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <div className="au-tools">
                    <Switch checked={!r.off} onChange={(on) => write((all) => all.map((x) => (x.id === r.id ? { ...x, off: !on || undefined } : x)))} />
                    <button type="button" className="icon-btn sm" aria-label="Change rule" title="Change" onClick={() => setEditing(r.id)}>
                      <Pencil />
                    </button>
                    <button type="button" className="icon-btn sm" aria-label="Remove rule" title="Remove" onClick={() => write((all) => all.filter((x) => x.id !== r.id))}>
                      <Trash2 />
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
        {!readOnly &&
          (editing === 'new' ? (
            <Builder
              board={board}
              onCancel={() => setEditing(null)}
              onSave={(next) => {
                write((all) => [...all, { ...next, id: K.ruleId() }])
                setEditing(null)
              }}
            />
          ) : (
            <div className="au-foot">
              <button type="button" className="btn btn-sm" disabled={!board.lanes.length} onClick={() => setEditing('new')}>
                <Plus /> Add a rule
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="The rules a new project starts with, for lists like To do, Doing and Done"
                onClick={() => write(() => K.suggestedRules(board).map((x) => ({ ...x, id: K.ruleId() })))}
              >
                <RotateCcw /> Reset to default
              </button>
            </div>
          ))}
      </div>
    </aside>
  )
}
