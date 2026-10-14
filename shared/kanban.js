// Projects are boards: a note in the format of the Obsidian Kanban plugin, so a
// vault works in both, and a board is plain markdown that syncs like any note.
//
//   ---
//   kanban-plugin: board
//   ---
//
//   ## To do                                  ← a list
//
//   - [ ] Write the brief #design 📅 2026-10-20 ← a card: a task line (shared/tasks.js)
//   	Notes about it, a line or more          ← its description
//   	- [ ] Ask Sam                           ← its checklist
//
//   ## Done
//
//   - [x] Set up the repo ✅ 2026-10-14
//
//   ***
//
//   ## Archive
//
//   - [x] An archived card
//
//   %% kanban:settings
//   ```
//   {"kanban-plugin":"board","obi":{"rules":[…]}}
//   ```
//   %%
//
// The settings block is the plugin's own; Obi keeps its board settings (the
// automation rules, colours) under "obi" in it. Cards are task lines, so the
// Tasks page, the calendar and the index read a project's cards like any task.
//
// The client edits a board through its document; the server applies the same
// rules when a card's task is changed from elsewhere (the Tasks page).

import { TASK_LINE, addDays, editTaskLine, isDone, joinTags, parseTask, splitTags, todayIso, weekStartOf } from './tasks.js'

// ---------- reading and writing ----------

const FM = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/
const CARD = /^[-*+]\s+(?:\[(.)\]\s?)?(.*)$/
const LANE = /^##\s+(.*)$/
const SETTINGS_START = /^%%\s*kanban:settings/
const ARCHIVE_RULE = /^\*\*\*\s*$/
const COMPLETE = /^\*\*Complete\*\*\s*$/

/** Is this note a board? (its front matter says so) */
export function isBoardContent(content) {
  const m = FM.exec(String(content || '').replace(/\r\n/g, '\n'))
  return !!m && /^(kanban-plugin\s*:|kanban\s*:\s*true\s*$)/m.test(m[0])
}

/** …from what the index keeps of a note: its front matter */
export const isBoardMeta = (meta) => !!meta?.fm && ('kanban-plugin' in meta.fm || meta.fm.kanban === true)

const makeCard = (m, line) => ({ status: m[1] ?? null, text: m[2], extra: [], line })

function readSettings(lines) {
  const json = lines.filter((l) => !/^\s*```/.test(l)).join('\n').trim()
  if (!json) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

// Keys for showing lists and cards (`id`s): the same content gets the same key, however
// often the board is read again
export function rekey(board) {
  const seen = new Map()
  const once = (k) => {
    const n = seen.get(k) || 0
    seen.set(k, n + 1)
    return n ? `${k}#${n}` : k
  }
  for (const lane of board.lanes) {
    lane.id = once(`l:${lane.title}`)
    for (const c of lane.items) c.id = once(`c:${c.text}`)
  }
  for (const c of board.archive || []) c.id = once(`a:${c.text}`)
  return board
}

/**
 * A board's markdown as { fm, preamble, lanes: [{ id, title, complete, items, extra, line }],
 * archive: cards | null, settings, tail }. A card is { id, status (the checkbox's
 * character, or null for none), text (what follows the checkbox), extra (the
 * lines under it), line }. `line`s are the note's own line numbers.
 */
export function parseBoard(content) {
  const raw = String(content || '')
  const crlf = raw.includes('\r\n')
  const text = crlf ? raw.replace(/\r\n/g, '\n') : raw
  const m = FM.exec(text)
  const fm = m ? m[0] : ''
  const first = fm ? fm.split('\n').length - 1 : 0
  const board = { fm, crlf, preamble: '', lanes: [], archive: null, settings: null, settingsRaw: null, tail: [] }
  const preamble = []
  let lane = null
  let item = null
  let blanks = 0 // blank lines inside a card, kept if more of the card follows
  let mode = 'lanes' // then 'footer', 'archive'; 'settings' inside the settings block
  let settings = null

  const under = (line) => {
    if (!item) return false
    if (/^\s+\S/.test(line)) {
      for (; blanks > 0; blanks--) item.extra.push('')
      item.extra.push(line)
      return true
    }
    if (!line.trim()) {
      blanks++
      return true
    }
    return false
  }

  text.slice(fm.length).split('\n').forEach((line, i) => {
    const at = first + i
    if (mode === 'settings') {
      if (/^%%\s*$/.test(line)) {
        board.settingsRaw = settings.join('\n')
        board.settings = readSettings(settings)
        mode = 'footer'
      } else settings.push(line)
      return
    }
    if (SETTINGS_START.test(line)) {
      settings = []
      mode = 'settings'
      item = null
      return
    }
    if (mode === 'lanes' && ARCHIVE_RULE.test(line)) {
      mode = 'footer'
      board.archive ??= []
      item = null
      return
    }
    if (mode !== 'lanes') {
      if (mode === 'footer' && LANE.test(line)) {
        mode = 'archive'
        board.archive ??= []
        item = null
        return
      }
      const c = mode === 'archive' && CARD.exec(line)
      if (c) {
        item = makeCard(c, at)
        blanks = 0
        board.archive.push(item)
      } else if (!under(line) && line.trim()) {
        board.tail.push(line)
        item = null
      }
      return
    }
    const h = LANE.exec(line)
    if (h) {
      lane = { title: h[1].trim(), items: [], extra: [], complete: false, line: at }
      board.lanes.push(lane)
      item = null
      return
    }
    if (!lane) {
      preamble.push(line)
      return
    }
    if (COMPLETE.test(line) && !item) {
      lane.complete = true
      return
    }
    const c = CARD.exec(line)
    if (c) {
      item = makeCard(c, at)
      blanks = 0
      lane.items.push(item)
      return
    }
    if (under(line)) return
    if (line.trim()) {
      lane.extra.push(line)
      item = null
    }
  })
  if (mode === 'settings') {
    board.settingsRaw = settings.join('\n')
    board.settings = readSettings(settings)
  }
  board.preamble = preamble.join('\n').trim()
  return rekey(board)
}

export const cardLine = (c) => `- ${c.status != null ? `[${c.status}] ` : ''}${c.text}`
const cardLines = (c) => [cardLine(c), ...c.extra]

/** A board back to markdown */
export function serializeBoard(board) {
  const out = []
  if (board.fm) out.push(...board.fm.replace(/\n$/, '').split('\n'))
  out.push('')
  if (board.preamble) out.push(board.preamble, '')
  for (const lane of board.lanes) {
    out.push(`## ${lane.title}`, '')
    const body = [...(lane.complete ? ['**Complete**'] : []), ...lane.items.flatMap(cardLines), ...lane.extra]
    if (body.length) out.push(...body, '')
  }
  if (board.archive) {
    out.push('***', '', '## Archive', '')
    if (board.archive.length) out.push(...board.archive.flatMap(cardLines), '')
  }
  if (board.tail.length) out.push(...board.tail, '')
  if (board.settings || board.settingsRaw != null) {
    const body = board.settings ? JSON.stringify(board.settings) : board.settingsRaw.replace(/^\s*```\s*\n?|\n?\s*```\s*$/g, '')
    if (out[out.length - 1] !== '') out.push('')
    out.push('%% kanban:settings', '```', body, '```', '%%')
  }
  const text = `${out.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/\n*$/, '')}\n`
  return board.crlf ? text.replace(/\n/g, '\r\n') : text
}

export const cloneBoard = (board) => ({
  ...board,
  lanes: board.lanes.map((l) => ({ ...l, items: l.items.map((c) => ({ ...c, extra: [...c.extra] })), extra: [...l.extra] })),
  archive: board.archive && board.archive.map((c) => ({ ...c, extra: [...c.extra] })),
  settings: board.settings && structuredClone(board.settings),
  tail: [...board.tail],
})

// ---------- a card ----------

/** A card as a task (shared/tasks.js): title, status, dates, priority, tags. A card without a box counts as open. */
export const cardTask = (c) => parseTask(c.status == null ? `- [ ] ${c.text}` : cardLine(c))

const LINE = /^- \[(.)\] ?(.*)$/

// a checklist item as it is in a new occurrence: open again
const reopen = (line) => {
  const t = parseTask(line)
  return t && t.status !== ' ' ? editTaskLine(line, { status: ' ' }).line : line
}

/**
 * Changes a card as editTaskLine changes a task (`patch`: status, title, due,
 * priority…). Completing a card that repeats gives its next occurrence, a new
 * card with the checklist open again, which is returned (else null).
 */
export function editCard(c, patch, { today = todayIso() } = {}) {
  const r = editTaskLine(c.status == null || !/[ xX/-]/.test(c.status) ? `- [ ] ${c.text}` : cardLine(c), patch, { today })
  const m = LINE.exec(r.line)
  c.status = m[1]
  c.text = m[2]
  if (!r.next) return null
  return { status: ' ', text: LINE.exec(r.next)[2], extra: c.extra.map(reopen), line: -1 }
}

// The indentation the lines under a card use, and one level of it
function indentUnit(c) {
  const ws = c.extra.map((l) => /^\s+/.exec(l)?.[0]).filter(Boolean)
  if (!ws.length) return '\t'
  const least = ws.reduce((a, b) => (b.length < a.length ? b : a))
  return least.startsWith('\t') ? '\t' : least
}
const dedent = (line, unit) => (line.startsWith(unit) ? line.slice(unit.length) : line.replace(/^\s+/, ''))

/**
 * What is under a card: `description` (its lines that aren't tasks, as text) and
 * `checklist` (its tasks: { at: index in extra, depth, …the task }).
 */
export function cardDetails(c) {
  const unit = indentUnit(c)
  const description = []
  const checklist = []
  c.extra.forEach((line, at) => {
    const t = parseTask(line)
    if (t && TASK_LINE.test(line)) {
      const ws = /^\s*/.exec(line)[0]
      checklist.push({ ...t, at, depth: Math.max(0, Math.round(ws.length / unit.length) - 1) })
    } else description.push(dedent(line, unit))
  })
  return { description: description.join('\n').replace(/^\n+|\n+$/g, ''), checklist }
}

/** Rewrites a card's description; its checklist stays as it is, below it */
export function setDescription(c, text) {
  const unit = indentUnit(c)
  const lines = String(text || '').replace(/\r/g, '').replace(/^\n+|\s+$/g, '').split('\n')
  const desc = lines[0] === '' && lines.length === 1 ? [] : lines.map((l) => (l.trim() ? unit + l : ''))
  const tasks = c.extra.filter((l) => TASK_LINE.test(l))
  c.extra = [...desc, ...tasks]
}

/** Adds an item to the end of a card's checklist */
export function addChecklistItem(c, title) {
  const unit = indentUnit(c)
  c.extra.push(`${unit}- [ ] ${String(title).replace(/\s+/g, ' ').trim()}`)
}

/** Changes the checklist item at `at` (an index into extra) */
export function editChecklistItem(c, at, patch, opts) {
  const r = editTaskLine(c.extra[at], patch, opts)
  if (r) c.extra[at] = r.line
}

/** Removes the checklist item at `at`, with the lines nested under it */
export function removeChecklistItem(c, at) {
  const depth = /^\s*/.exec(c.extra[at])[0].length
  let end = at + 1
  while (end < c.extra.length && (/^\s*$/.test(c.extra[end]) || /^\s*/.exec(c.extra[end])[0].length > depth)) end++
  c.extra.splice(at, end - at)
}

/** Tags on a card: adds or removes one */
export function setCardTags(c, tags, opts) {
  const { title } = splitTags(cardTask(c).text)
  editCard(c, { title: joinTags(title, tags) }, opts)
}

// ---------- finding things ----------

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
export const laneNamed = (board, title) => board.lanes.find((l) => same(l.title, title)) || null

/** Where the card `id` is: { lane, index, card } (lane is null for an archived one), or null */
export function findCard(board, id) {
  for (const lane of board.lanes) {
    const index = lane.items.findIndex((c) => c.id === id)
    if (index >= 0) return { lane, index, card: lane.items[index] }
  }
  const index = (board.archive || []).findIndex((c) => c.id === id)
  return index >= 0 ? { lane: null, index, card: board.archive[index] } : null
}

const laneOf = (board, card) => board.lanes.find((l) => l.items.includes(card)) || null

/** The card whose line is `line`, as the note reads now, and its lane */
export function cardAtLine(board, line) {
  for (const lane of board.lanes) {
    const index = lane.items.findIndex((c) => c.line === line)
    if (index >= 0) return { lane, index, card: lane.items[index] }
  }
  return null
}

/** The list a task of a board note is in, from the note's index entry (its headings) */
export function laneOfTask(meta, line) {
  let lane = null
  for (const h of meta?.headings || []) {
    if (h.line > line) break
    if (h.level === 2) lane = h.text
  }
  return lane
}

// ---------- settings ----------

const obiOf = (board) => (board.settings && typeof board.settings.obi === 'object' && board.settings.obi) || {}

/** Changes Obi's settings of the board (merged into what is there) */
export function setObi(board, patch) {
  const settings = board.settings || { 'kanban-plugin': 'board' }
  board.settings = { ...settings, obi: { ...obiOf(board), ...patch } }
  board.settingsRaw = null
}

export const PROJECT_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
export const boardColor = (board) => (PROJECT_COLORS.includes(obiOf(board).color) ? obiOf(board).color : null)
export const laneColor = (board, lane) => {
  const c = obiOf(board).colors?.[lane.title]
  return PROJECT_COLORS.includes(c) ? c : null
}
export function setLaneColor(board, lane, color) {
  const colors = { ...(obiOf(board).colors || {}) }
  if (color) colors[lane.title] = color
  else delete colors[lane.title]
  setObi(board, { colors })
}

// ---------- automation ----------
//
// A rule: when something happens to a card, do one thing to it — Trello's Butler,
// in small. { id, on, list?, status?, do, value?, to?, at?, off? }
//
//   on: 'into' (moved or added to `list`), 'outof' (moved out of `list`), 'added'
//       (made in `list`), 'status' (marked `status`: ' ' to do, '/' in progress, 'x' done)
//   do: 'status' (`value`), 'move' (`to` a list, `at` 'top' or 'bottom'),
//       'due' (`value`: today, tomorrow, next-week, none), 'tag' / 'untag' (`value`),
//       'priority' (`value`, or null), 'archive'
//
// Rules answer what a person does. What a rule does doesn't set off other rules,
// so no set of them can loop, and each does what its sentence says.

export const DEFAULT_LISTS = ['To do', 'Doing', 'Done']

let ruleSeq = 0
export const ruleId = () => `r${Date.now().toString(36)}${(ruleSeq++).toString(36)}`

/** The rules a board starts with, for its to do, doing and done lists (any may be missing) */
export function defaultRules({ todo, doing, done }) {
  const rules = []
  if (done) {
    rules.push({ on: 'into', list: done, do: 'status', value: 'x' })
    rules.push({ on: 'status', status: 'x', do: 'move', to: done, at: 'top' })
    rules.push({ on: 'outof', list: done, do: 'status', value: ' ' })
  }
  if (doing) {
    rules.push({ on: 'into', list: doing, do: 'status', value: '/' })
    rules.push({ on: 'status', status: '/', do: 'move', to: doing, at: 'bottom' })
  }
  if (todo) {
    rules.push({ on: 'into', list: todo, do: 'status', value: ' ' })
    if (done) rules.push({ on: 'status', status: ' ', do: 'move', to: todo, at: 'bottom' })
  }
  return rules.map((r, i) => ({ id: `d${i + 1}`, ...r }))
}

/** The rules a board's list names suggest (To do, Doing, Done and the like): what a board made in Obsidian starts with */
export function suggestedRules(board) {
  const find = (re) => board.lanes.find((l) => re.test(l.title.trim()))?.title
  const done = board.lanes.find((l) => l.complete)?.title || find(/^(done|complete|completed|finished|shipped)$/i)
  return defaultRules({ done, doing: find(/^(doing|in progress|in-progress|wip|started)$/i), todo: find(/^(to ?do|to-do|backlog|next|up next)$/i) })
}

/** A board's rules: its own, or (if it has never had any) those its lists suggest */
export const rulesOf = (board) => (Array.isArray(obiOf(board).rules) ? obiOf(board).rules : suggestedRules(board))

export const setRules = (board, rules) => setObi(board, { rules })

/** A list was renamed: its colour and the rules that name it follow */
export function renameLane(board, lane, title) {
  const was = lane.title
  const explicit = Array.isArray(obiOf(board).rules)
  const rules = rulesOf(board)
  lane.title = title
  const fix = (v) => (v != null && same(v, was) ? title : v)
  const colors = obiOf(board).colors
  if (explicit || rules.some((r) => same(r.list ?? '', was) || same(r.to ?? '', was))) setRules(board, rules.map((r) => ({ ...r, list: fix(r.list), to: fix(r.to) })))
  if (colors && was in colors) {
    const { [was]: c, ...rest } = colors
    setObi(board, { colors: { ...rest, [title]: c } })
  }
}

const isStatus = (a, b) => (isDone(a) && isDone(b)) || a === b

function matches(rule, event) {
  if (rule.off || rule.on !== event.on) return false
  if (rule.on === 'status') return isStatus(rule.status, event.status)
  return same(rule.list ?? '', event.list)
}

const dueFor = (value, today) => ({ today, tomorrow: addDays(today, 1), 'next-week': weekStartOf(addDays(today, 7), 1), none: null })[value]

function place(board, card, lane, at) {
  const from = laneOf(board, card)
  if (from) from.items.splice(from.items.indexOf(card), 1)
  else if (board.archive?.includes(card)) board.archive.splice(board.archive.indexOf(card), 1)
  if (at === 'top') lane.items.unshift(card)
  else lane.items.push(card)
}

// Puts a repeating card's next occurrence just after it, where it was when it was done
const spawn = (board, lane, card, next) => {
  if (!next) return
  const at = lane ? lane.items.indexOf(card) : -1
  if (lane && at >= 0) lane.items.splice(at + 1, 0, next)
}

// Does what a rule says to a card. Says whether that changed anything.
function act(board, card, rule, today) {
  const lane = laneOf(board, card)
  if (!lane) return false // archived meanwhile
  const before = cardLine(card)
  switch (rule.do) {
    case 'status': {
      const st = rule.value === 'x' || rule.value === '/' || rule.value === '-' ? rule.value : ' '
      if (isStatus(card.status, st)) return false
      spawn(board, lane, card, editCard(card, { status: st }, { today }))
      return true
    }
    case 'move': {
      const to = laneNamed(board, rule.to)
      if (!to || to === lane) return false
      place(board, card, to, rule.at === 'top' ? 'top' : 'bottom')
      return true
    }
    case 'due': {
      const v = dueFor(rule.value, today)
      if (v === undefined) return false
      editCard(card, { due: v }, { today })
      break
    }
    case 'tag':
    case 'untag': {
      const tag = String(rule.value || '').replace(/^#/, '').trim()
      if (!tag) return false
      const { tags } = splitTags(cardTask(card).text)
      const has = tags.some((t) => same(t, tag))
      if (rule.do === 'tag' ? has : !has) return false
      setCardTags(card, rule.do === 'tag' ? [...tags, tag] : tags.filter((t) => !same(t, tag)), { today })
      break
    }
    case 'priority':
      editCard(card, { priority: rule.value || null }, { today })
      break
    case 'archive':
      lane.items.splice(lane.items.indexOf(card), 1)
      ;(board.archive ??= []).push(card)
      return true
    default:
      return false
  }
  return cardLine(card) !== before
}

/**
 * Runs the board's rules for what happened to `card` — `events` in order, e.g.
 * [{ on: 'outof', list: 'Done' }, { on: 'into', list: 'Doing' }]. Returns the
 * rules that changed something.
 */
export function runRules(board, card, events, { today = todayIso() } = {}) {
  const fired = []
  const rules = rulesOf(board)
  for (const event of events) {
    for (const rule of rules) {
      if (matches(rule, event) && act(board, card, rule, today)) fired.push(rule)
    }
  }
  return fired
}

// ---------- what a person does to a board ----------
// Each changes `board` in place and gives back the rules that fired.

/** Moves a card to `lane` (a lane object), before the card now at `index` there (the end if null) */
export function moveCard(board, card, lane, index = null, opts) {
  const from = laneOf(board, card)
  if (!from) return []
  const was = from.items.indexOf(card)
  from.items.splice(was, 1)
  let at = index == null ? lane.items.length : index
  if (from === lane && index != null && index > was) at--
  lane.items.splice(Math.max(0, Math.min(at, lane.items.length)), 0, card)
  if (from === lane) return []
  return runRules(board, card, [{ on: 'outof', list: from.title }, { on: 'into', list: lane.title }], opts)
}

/** Changes a card's status (the checkbox, or the status picker) */
export function setCardStatus(board, card, status, opts = {}) {
  if (isStatus(card.status ?? ' ', status)) return []
  const lane = laneOf(board, card)
  spawn(board, lane, card, editCard(card, { status }, opts))
  return runRules(board, card, [{ on: 'status', status }], opts)
}

/** Adds a card at the end (or `top`) of `lane`: its title and fields as for newTaskLine */
export function addCard(board, lane, title, fields = {}, { top = false, ...opts } = {}) {
  const card = { status: ' ', text: '', extra: [], line: -1 }
  editCard(card, { ...fields, title }, opts)
  if (top) lane.items.unshift(card)
  else lane.items.push(card)
  return { card, fired: runRules(board, card, [{ on: 'added', list: lane.title }, { on: 'into', list: lane.title }], opts) }
}

export function archiveCard(board, card) {
  const lane = laneOf(board, card)
  if (!lane) return
  lane.items.splice(lane.items.indexOf(card), 1)
  ;(board.archive ??= []).push(card)
}

/** Puts an archived card back, at the end of `lane` */
export function restoreCard(board, card, lane) {
  const at = board.archive?.indexOf(card) ?? -1
  if (at < 0 || !lane) return
  board.archive.splice(at, 1)
  lane.items.push(card)
}

export function deleteCard(board, card) {
  const lane = laneOf(board, card)
  if (lane) lane.items.splice(lane.items.indexOf(card), 1)
  else if (board.archive?.includes(card)) board.archive.splice(board.archive.indexOf(card), 1)
}

// ---------- a new project ----------

/** The markdown of a new project: the default lists and their rules */
export function newProjectContent({ lists = DEFAULT_LISTS, color = null } = {}) {
  const board = {
    fm: '---\nkanban-plugin: board\n---\n',
    crlf: false,
    preamble: '',
    lanes: lists.map((title) => ({ title, items: [], extra: [], complete: false })),
    archive: null,
    settings: null,
    settingsRaw: null,
    tail: [],
  }
  const [todo, doing, done] = lists
  setObi(board, { rules: defaultRules({ todo, doing, done }), ...(color && { color }) })
  return serializeBoard(board)
}

// ---------- on the server: a board note changed through its tasks ----------

// The board as text, and the lines `cards` are on there (null for one that isn't in a list)
function withLines(board, cards) {
  const where = cards.map((card) => board.lanes.map((l, i) => [i, l.items.indexOf(card)]).find(([, j]) => j >= 0))
  const text = serializeBoard(board)
  const again = where.some(Boolean) ? parseBoard(text) : null
  return { text, lines: where.map((w) => (w ? again.lanes[w[0]].items[w[1]].line : null)) }
}

/**
 * Tasks of a board note had their status changed (from the Tasks page, say):
 * `changes` are { line, status } — the line of each in `text` as it is now. The
 * board's status rules are run for each that is a card (not a checklist item).
 * Returns { text, lines }: `lines` are where the changed tasks are now, in the
 * order of `changes`. If no rule changed anything, the text is `text` itself.
 */
export function applyStatusRules(text, changes, opts) {
  const unchanged = { text, lines: changes.map((ch) => ch.line) }
  if (!changes.length || !isBoardContent(text)) return unchanged
  const board = parseBoard(text)
  const before = serializeBoard(board)
  const hits = changes.map((ch) => cardAtLine(board, ch.line))
  let fired = 0
  changes.forEach((ch, i) => {
    if (hits[i]) fired += runRules(board, hits[i].card, [{ on: 'status', status: ch.status }], opts).length
  })
  if (!fired) return unchanged
  const out = withLines(board, hits.map((h) => h?.card))
  if (out.text === before) return unchanged
  // a checklist item that changed sits where it was among its card's lines; its card may have moved
  return { text: out.text, lines: out.lines.map((l, i) => l ?? (hits[i] ? null : changes[i].line)) }
}

/**
 * A new card in a board note, in the list `list` (else the first): `taskLine` is
 * the new task's line. Returns { text, line } — the card's line in the new text.
 */
export function addCardToText(text, taskLine, { list = null, ...opts } = {}) {
  const board = parseBoard(text)
  if (!board.lanes.length) board.lanes.push({ title: DEFAULT_LISTS[0], items: [], extra: [], complete: false })
  const named = list ? laneNamed(board, list) : null
  const lane = named || board.lanes[0]
  const m = LINE.exec(taskLine.trim())
  const card = { status: m ? m[1] : ' ', text: m ? m[2] : taskLine.trim(), extra: [], line: -1 }
  lane.items.push(card)
  // no list asked for, and already in progress or done: where the rules put such a card
  if (!named && card.status !== ' ') runRules(board, card, [{ on: 'status', status: card.status }], opts)
  else runRules(board, card, [{ on: 'added', list: lane.title }, { on: 'into', list: lane.title }], opts)
  return withLine(board, card)
}

// The board as text, and the line its card `card` is on there
function withLine(board, card) {
  const { text, lines } = withLines(board, [card])
  return { text, line: lines[0] }
}

/** Moves the card at `line` (whose title must still be `title`) to the list `list`. Returns { text, line }, or null if there is no such card or list. */
export function moveCardInText(text, { line, title }, list, opts) {
  const board = parseBoard(text)
  const hit = cardAtLine(board, line)
  const to = laneNamed(board, list)
  if (!hit || !to || (title != null && cardTask(hit.card).text !== title)) return null
  if (hit.lane === to) return { text, line }
  moveCard(board, hit.card, to, null, opts)
  return withLine(board, hit.card)
}
