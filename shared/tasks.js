// Tasks live in the note's own markdown, as checkbox list items in the format
// of the Obsidian Tasks plugin, so a vault works in both:
//
//   - [ ] Title #tag 🔼 🔁 every week 🛫 2026-10-01 ⏳ 2026-10-02 📅 2026-10-05
//   - [x] Title ✅ 2026-10-03
//
// This is the one place that reads those lines, rewrites them and does the
// date arithmetic. The index, the editor, the reading view, the Tasks view, the
// calendar and the server all go through it, so a task behaves the same whichever
// way it is changed.

import { parseNote } from './parse.js'

// ---------- dates (ISO yyyy-mm-dd strings, worked out in UTC so no zone or DST can shift a day) ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86400000
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10)

export const isIsoDate = (s) => typeof s === 'string' && ISO.test(s) && fromUtc(utc(s)) === s
/** Today in the local time zone */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
export const addDays = (iso, n) => fromUtc(utc(iso) + n * DAY)
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY)
/** 0 = Sunday */
export const weekdayOf = (iso) => new Date(utc(iso)).getUTCDay()

/** n months on, staying within the month (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(iso, n) {
  const first = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return fromUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(+iso.slice(8, 10), last)))
}

/** The first day of the week `iso` is in (`startDay`: 0 Sunday, 1 Monday) */
export const weekStartOf = (iso, startDay) => addDays(iso, -((weekdayOf(iso) - startDay + 7) % 7))

/** The days of the whole weeks that make up the month `iso` is in */
export function monthDays(iso, startDay) {
  const first = `${iso.slice(0, 8)}01`
  const start = weekStartOf(first, startDay)
  const weeks = Math.ceil(daysBetween(start, addMonths(first, 1)) / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
}

// ---------- the line ----------

/** indent, bullet, status character, then everything after the checkbox */
export const TASK_LINE = /^(\s*)((?:[-*+]|\d+[.)])\s+)\[([ xX/\-])\] ?(.*)$/

export const isDone = (status) => status === 'x' || status === 'X'
export const isCancelled = (status) => status === '-'
/** open, or in progress */
export const isOpen = (status) => !isDone(status) && !isCancelled(status)

const V = '\\uFE0F?' // many editors add a variation selector after an emoji
const DATE = '(\\d{4}-\\d{2}-\\d{2})'

// A date field is its emoji, or the Dataview inline form some vaults use:
// [due:: 2026-10-05], (due:: …), due:: …, @due(…).
const dateField = (emoji, dv) => new RegExp(`(?:[${emoji}]${V}|[\\[(]?(?<!\\w)${dv}::?|@${dv}\\()\\s*${DATE}[\\])]?`, 'u')
const DATE_FIELDS = {
  start: dateField('🛫', 'start'),
  scheduled: dateField('⏳⌛', 'scheduled'),
  due: dateField('📅📆🗓', '(?:due|deadline)'),
  done: dateField('✅', '(?:completion|done)'),
  cancelled: dateField('❌', 'cancelled'),
  created: dateField('➕', 'created'),
}
const PRIORITY = /[🔺⏫🔼🔽⏬]️?/u
// the rule runs up to the next emoji field
const RECURRENCE = /🔁️?\s*([^🔺⏫🔼🔽⏬🛫⏳⌛📅📆🗓✅❌➕🔁🏁⛔🆔]*)/u
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu
const BLOCK_ID = / \^[A-Za-z0-9-]+$/

export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest']
export const PRIORITY_EMOJI = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }
const PRIORITY_OF = Object.fromEntries(Object.entries(PRIORITY_EMOJI).map(([name, e]) => [e, name]))
// higher = more urgent; no priority sits between medium and low, as in Obsidian Tasks
const RANK = { highest: 4, high: 3, medium: 2, low: 0, lowest: -1 }
export const priorityRank = (p) => RANK[p] ?? 1

// Every field found in the text after the checkbox, where it sits and what it
// says. Editing replaces fields in place, so the order and style of what the
// person wrote survive.
function scan(rest) {
  const found = []
  for (const [key, re] of Object.entries(DATE_FIELDS)) {
    const m = re.exec(rest)
    if (m) found.push({ key, value: m[1], start: m.index, end: m.index + m[0].length })
  }
  let m = PRIORITY.exec(rest)
  if (m) found.push({ key: 'priority', value: PRIORITY_OF[m[0].replace('️', '')], start: m.index, end: m.index + m[0].length })
  m = RECURRENCE.exec(rest)
  // (not the space after the rule: the next field keeps its own)
  if (m) found.push({ key: 'recurrence', value: m[1].trim(), start: m.index, end: m.index + m[0].trimEnd().length })
  return found.sort((a, b) => a.start - b.start)
}

function titleOf(rest, found) {
  let out = ''
  let at = 0
  for (const f of found) {
    out += rest.slice(at, f.start)
    at = f.end
  }
  return (out + rest.slice(at)).replace(/\s+/g, ' ').trim()
}

const tagsOf = (title) => [...title.matchAll(TAG)].map((m) => m[2].replace(/\/+$/, '')).filter(Boolean)

/**
 * A task line as the index keeps it, or null if the line isn't a task. Empty
 * fields are left out, so a plain task is small.
 *   { text, status, checked, indent, due?, scheduled?, start?, done?, cancelled?,
 *     created?, priority?, recurrence?, tags? }
 * `text` is the title: what is left once the fields are taken out.
 */
export function parseTask(line) {
  const m = TASK_LINE.exec(String(line).replace(/\r$/, ''))
  if (!m) return null
  const rest = m[4].replace(BLOCK_ID, '')
  const found = scan(rest)
  const text = titleOf(rest, found)
  const task = { text, status: m[3], checked: isDone(m[3]), indent: m[1].length }
  for (const f of found) task[f.key] = f.value
  const tags = tagsOf(text)
  if (tags.length) task.tags = tags
  return task
}

// ---------- recurrence ----------

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_NAME = '(?:sun|mon|tues|wednes|thurs|fri|satur)day'
const SHORT = { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year', annually: 'every year' }

/**
 * "every 2 weeks", "every month", "every weekday", "every monday and friday",
 * "every week on sunday", each optionally "when done" (counted from the day it
 * was done rather than from its date). null if it isn't a rule we know.
 */
export function parseRecurrence(rule) {
  let s = String(rule || '').toLowerCase().trim().replace(/\s+/g, ' ')
  s = SHORT[s] || s
  const whenDone = / when done$/.test(s)
  if (whenDone) s = s.slice(0, -' when done'.length).trim()
  let m = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(s)
  if (m) return { n: Math.max(1, Number(m[1] || 1)), unit: m[2], whenDone }
  if (s === 'every weekday') return { weekdays: [1, 2, 3, 4, 5], whenDone }
  m = /^every week on (\w+)$/.exec(s)
  if (m && DAY_NAMES.includes(m[1])) return { weekdays: [DAY_NAMES.indexOf(m[1])], whenDone }
  m = new RegExp(`^every (${DAY_NAME}(?:(?:, and |, | and | )${DAY_NAME})*)$`).exec(s)
  if (m) return { weekdays: [...new Set(m[1].match(new RegExp(DAY_NAME, 'g')).map((d) => DAY_NAMES.indexOf(d)))], whenDone }
  return null
}

/** The first date the rule gives after `from` */
export function nextOccurrence(rec, from) {
  if (rec.weekdays) {
    for (let i = 1; i <= 7; i++) if (rec.weekdays.includes(weekdayOf(addDays(from, i)))) return addDays(from, i)
  }
  switch (rec.unit) {
    case 'day':
      return addDays(from, rec.n)
    case 'week':
      return addDays(from, 7 * rec.n)
    case 'month':
      return addMonths(from, rec.n)
    default:
      return addMonths(from, 12 * rec.n)
  }
}

// ---------- rewriting a line ----------

const tokenFor = (key, value) =>
  key === 'priority' ? PRIORITY_EMOJI[value] : key === 'recurrence' ? `🔁 ${value}` : `${{ start: '🛫', scheduled: '⏳', due: '📅', done: '✅', cancelled: '❌', created: '➕' }[key]} ${value}`

const FIELD_KEYS = [...Object.keys(DATE_FIELDS), 'priority', 'recurrence']

function validate(key, value) {
  if (value == null) return
  if (key in DATE_FIELDS && !isIsoDate(value)) throw new RangeError(`"${value}" is not a date (yyyy-mm-dd)`)
  if (key === 'priority' && !PRIORITIES.includes(value)) throw new RangeError(`"${value}" is not a priority`)
  if (key === 'recurrence' && !parseRecurrence(value)) throw new RangeError(`"${value}" is not a repeat rule`)
}

/**
 * Applies `patch` to a task line. A field set to a value is written (in place
 * if the line already has it, else at the end); set to null it is removed;
 * left out it is left alone. Also: `title`, and `status` (a character: space,
 * x, / or -).
 *
 * A status change keeps the dates honest: becoming done stamps ✅ today (becoming
 * cancelled, ❌), and leaving that status takes the stamp off. Completing a task
 * that repeats also produces the line of its next occurrence.
 *
 * Returns { line, next } — `next` is that new line, or null — or null if the
 * line isn't a task.
 */
export function editTaskLine(line, patch = {}, { today = todayIso() } = {}) {
  const cr = String(line).endsWith('\r') ? '\r' : ''
  const m = TASK_LINE.exec(String(line).replace(/\r$/, ''))
  if (!m) return null
  const [, indent, bullet, was, rest0] = m
  const blockId = BLOCK_ID.exec(rest0)?.[0] || ''
  const rest = blockId ? rest0.slice(0, -blockId.length) : rest0

  const next = { ...patch }
  const status = patch.status ?? was
  if (patch.status != null && patch.status !== was) {
    if (isDone(status) && !isDone(was)) Object.assign(next, { done: patch.done ?? today, cancelled: null })
    else if (isCancelled(status)) Object.assign(next, { cancelled: patch.cancelled ?? today, done: null })
    else Object.assign(next, { done: null, cancelled: null })
  }
  for (const k of FIELD_KEYS) validate(k, next[k])

  const found = scan(rest)
  const byKey = new Map(found.map((f) => [f.key, f]))
  const values = Object.fromEntries(found.map((f) => [f.key, f.value]))

  // the line as it will read: each field in place, new ones at the end
  const pieces = []
  let at = 0
  for (const f of found) {
    pieces.push({ text: rest.slice(at, f.start) })
    at = f.end
    const raw = rest.slice(f.start, f.end)
    const v = next[f.key]
    if (v === undefined) pieces.push({ text: raw })
    else if (v !== null) pieces.push({ text: f.key === 'priority' || f.key === 'recurrence' ? tokenFor(f.key, v) : raw.replace(f.value, v) })
    if (v !== undefined) values[f.key] = v
  }
  pieces.push({ text: rest.slice(at) })
  let body = pieces.map((p) => p.text).join('')
  const added = []
  for (const k of FIELD_KEYS) {
    if (next[k] == null || byKey.has(k)) continue
    added.push(tokenFor(k, next[k]))
    values[k] = next[k]
  }
  if (patch.title != null) {
    body = [String(patch.title).replace(/\s+/g, ' ').trim(), ...scan(body).map((f) => body.slice(f.start, f.end).trim())].join(' ')
  }
  body = [body, ...added].join(' ').replace(/ {2,}/g, ' ').trim()
  for (const k of FIELD_KEYS) if (next[k] === null) delete values[k]

  const build = (st, text) => `${indent}${bullet}[${st}]${text ? ` ${text}` : ''}${blockId}${cr}`
  const out = { line: build(status, body), next: null }

  const rec = values.recurrence && parseRecurrence(values.recurrence)
  if (rec && isDone(status) && !isDone(was)) out.next = nextTaskLine(build, body, values, rec, today)
  return out
}

// The next occurrence of a repeating task: open again, the stamps off, and its
// dates moved on by the same distance the rule moves its first one.
function nextTaskLine(build, body, values, rec, today) {
  const from = values.due || values.scheduled || values.start || today
  const base = rec.whenDone ? today : from
  const to = nextOccurrence(rec, base)
  const shift = daysBetween(from, to)
  const patch = { done: null, cancelled: null }
  const dated = ['due', 'scheduled', 'start'].filter((k) => values[k])
  for (const k of dated) patch[k] = addDays(values[k], shift)
  // a repeating task with no date of its own gets its next date as a due date
  if (!dated.length) patch.due = to
  return editTaskLine(build(' ', body), patch, { today }).line
}

/** Done ↔ open: the checkbox. A cancelled or in-progress task counts as not done. */
export function toggleTaskLine(line, opts) {
  const m = TASK_LINE.exec(String(line).replace(/\r$/, ''))
  if (!m) return null
  return editTaskLine(line, { status: isDone(m[3]) || isCancelled(m[3]) ? ' ' : 'x' }, opts)
}

// ---------- editing a note's text ----------

export class TaskChangedError extends Error {
  constructor() {
    super('That task has changed — refresh and try again')
    this.status = 409
  }
}

// The lines of a note that the index reads as tasks: not an example that looks
// like one in a code block, a math block or a comment
const taskLinesOf = (text) => new Set(parseNote(text).tasks.map((t) => t.line))

// Where the task the index called (`line`, `title`) is now. The note may have
// changed since the line number was read, so `title` must still match; if the
// line moved, the task is found by its title as long as that is unambiguous.
// Only a line in `indexed` (see taskLinesOf) can be it.
function findTask(lines, indexed, line, title) {
  const is = (n) => {
    const t = indexed.has(n) && parseTask(lines[n])
    return !!t && (title == null || t.text === title)
  }
  if (is(line)) return line
  const hits = lines.map((_, n) => n).filter(is)
  if (hits.length !== 1) throw new TaskChangedError()
  return hits[0]
}

const indentOf = (line) => /^\s*/.exec(line)[0].length

// The last line of what is nested under the task at `at`: the lines below it
// that are indented further, with the blank lines between them
function blockEnd(lines, at) {
  const indent = indentOf(lines[at])
  let end = at
  for (let n = at + 1; n < lines.length; n++) {
    if (!/\S/.test(lines[n])) continue
    if (indentOf(lines[n]) <= indent) break
    end = n
  }
  return end
}

// a checklist item as it is in a new occurrence: open again, without the stamp of having been finished
function reopen(line) {
  const t = parseTask(line)
  return t && t.status !== ' ' ? editTaskLine(line, { status: ' ' }).line : line
}

// What completing the task at `at` writes below its checklist (which ends at
// `end`): its next occurrence, `head`, with a fresh copy of that checklist
const spawnedBy = (lines, at, end, head) => [head, ...lines.slice(at + 1, end + 1).map(reopen)]

/**
 * Where the next occurrence of a repeating task goes, and what goes there: the
 * task at `at` of `lines` has just been completed, and `next` (from
 * editTaskLine) is its next occurrence. That goes below the task's checklist —
 * what is nested under it — not right under the task, together with a copy of
 * that checklist, open again. Returns { after, lines }: `lines` follow line `after`.
 */
export function nextBlock(lines, at, next) {
  const end = blockEnd(lines, at)
  return { after: end, lines: spawnedBy(lines, at, end, next) }
}

/** nextBlock, put into `lines` */
export function insertNext(lines, at, next) {
  const block = nextBlock(lines, at, next)
  lines.splice(block.after + 1, 0, ...block.lines)
}

// How many lines below the checklist of the task at `at` (which ends at `end`)
// are what completing it wrote there: all of them, exactly as they were written,
// or none. `was` is the completed line as it stands now, from which what its
// completion wrote is worked out again.
function spawnedLines(lines, at, end, was, today) {
  const task = parseTask(was)
  if (!task || !isDone(task.status)) return 0
  const reopened = editTaskLine(was, { status: ' ' }).line
  const head = editTaskLine(reopened, { status: 'x' }, { today: task.done || today }).next
  if (!head) return 0
  const want = spawnedBy(lines, at, end, head)
  // at the very end of a note with Windows line endings the last line has none (see editAt)
  const toEnd = end + 1 + want.length === lines.length
  const bare = (l) => (toEnd ? l.replace(/\r$/, '') : l)
  return want.every((l, i) => (i === want.length - 1 ? bare(lines[end + 1 + i]) === bare(l) : lines[end + 1 + i] === l)) ? want.length : 0
}

// Changes the task at `at` of `lines`, which are changed in place. Gives what
// applyTaskEdit does (but the text), and where that left the lines: those from
// `from` on have moved by `by`.
function editAt(lines, at, { patch, today, dropNext = false }) {
  const was = lines[at]
  const r = editTaskLine(was, patch, { today })
  lines[at] = r.line
  const end = blockEnd(lines, at)
  // the last line of a note has no line ending of its own: in a note with Windows
  // ones, the line that stops being last takes one and the one that becomes last gives it up
  const atEnd = end === lines.length - 1
  const crlf = lines.some((l) => l.endsWith('\r'))
  let by = 0
  let dropped
  if (r.next) {
    const added = spawnedBy(lines, at, end, r.next)
    lines.splice(end + 1, 0, ...added)
    if (atEnd && crlf) lines[end] += '\r'
    by = added.length
  } else if (dropNext) {
    by = -spawnedLines(lines, at, end, was, today)
    dropped = by < 0
    const toEnd = end + 1 - by === lines.length
    lines.splice(end + 1, -by)
    if (dropped && toEnd) lines[end] = lines[end].replace(/\r$/, '')
  }
  return { result: { line: at, task: parseTask(r.line), next: r.next ? parseTask(r.next) : null, dropped }, from: end + 1, by }
}

/**
 * Edits the task at `line` in a note's text. Returns { text, line, task, next,
 * dropped }. `next` is the next occurrence of a repeating task that was
 * completed: it goes below the task's checklist (see nextBlock).
 * `dropNext` is for taking back the completion of a repeating task: what
 * completing it wrote (the next occurrence, and the copy of the checklist) goes
 * with the reopening, but only if all of it is still there as it was written;
 * `dropped` says whether it was. If the note was changed meanwhile it stays.
 */
export function applyTaskEdit(text, { line, title, patch, today, dropNext = false }) {
  const lines = text.split('\n')
  const at = findTask(lines, taskLinesOf(text), line, title)
  const { result } = editAt(lines, at, { patch, today, dropNext })
  return { text: lines.join('\n'), ...result }
}

/** How many tasks one request to change several of them may name */
export const MAX_TASK_EDITS = 1000

const failure = (e) => {
  if (!(e instanceof TaskChangedError || e instanceof RangeError)) throw e
  return { error: e.message, status: e instanceof RangeError ? 400 : e.status }
}

/**
 * Edits several tasks of one note at once: `items` are { line, title, patch,
 * dropNext }, each as for applyTaskEdit and found in the note as it is now.
 * Returns { text, results }, a result for each item in its order — what
 * applyTaskEdit gives (but the text), with the line its task is on in the text
 * that comes back — or { error, status } for one that can't be done, while the
 * others still are.
 */
export function applyTaskEdits(text, items, { today } = {}) {
  const lines = text.split('\n')
  const indexed = taskLinesOf(text)
  const results = new Array(items.length)
  const found = []
  items.forEach((item, i) => {
    try {
      found.push({ i, at: findTask(lines, indexed, item.line, item.title) })
    } catch (e) {
      results[i] = failure(e)
    }
  })
  // from the bottom up, so what a task writes below itself moves none of those still to do
  found.sort((a, b) => b.at - a.at)
  const made = []
  for (const { i, at } of found) {
    try {
      const { result, from, by } = editAt(lines, at, { ...items[i], today })
      for (const m of made) if (m.line >= from) m.line += by
      made.push((results[i] = result))
    } catch (e) {
      results[i] = failure(e)
    }
  }
  return { text: lines.join('\n'), results }
}

/**
 * A new subtask (the line `taskLine`) under the task at `line`: after the last
 * line nested beneath it, indented like its other subtasks, or else to sit
 * inside it. Returns { text, line }.
 */
export function addSubtask(text, { line, title }, taskLine) {
  const lines = text.split('\n')
  const at = findTask(lines, taskLinesOf(text), line, title)
  const parent = TASK_LINE.exec(lines[at].replace(/\r$/, ''))
  const nested = (n) => /\S/.test(lines[n] ?? '') && /^\s*/.exec(lines[n])[0].length > parent[1].length
  let end = at
  while (nested(end + 1)) end++
  const sibling = lines
    .slice(at + 1, end + 1)
    .map((l) => TASK_LINE.exec(l.replace(/\r$/, '')))
    .find((m) => m && m[1].length > parent[1].length)
  const indent = sibling ? sibling[1] : parent[1] + (parent[1].includes('\t') ? '\t' : ' '.repeat(parent[2].length))
  lines.splice(end + 1, 0, `${indent}${taskLine.trimStart()}${lines[at].endsWith('\r') ? '\r' : ''}`)
  return { text: lines.join('\n'), line: end + 1 }
}

/** A new task at the end of a note, with its siblings if it ends in a list of them */
export function appendTask(text, taskLine) {
  const body = text.replace(/\n+$/, '')
  if (!body) return `${taskLine}\n`
  const last = body.slice(body.lastIndexOf('\n') + 1)
  return `${body}${TASK_LINE.test(last) ? '\n' : '\n\n'}${taskLine}\n`
}

/** The line for a new task: open, or in progress with `status: '/'` */
export function newTaskLine(title, fields = {}, { today = todayIso() } = {}) {
  const base = `- [${fields.status === '/' ? '/' : ' '}] ${String(title).replace(/\s+/g, ' ').trim()}`
  const patch = {}
  for (const k of FIELD_KEYS) if (fields[k]) patch[k] = fields[k]
  return editTaskLine(base, patch, { today }).line
}

// ---------- lists of tasks ----------

/** The day a task belongs to on a list or a calendar */
export const taskDate = (t) => t.due || t.scheduled || t.start || null

export const BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
  { id: 'done', label: 'Done' },
]

export function bucketOf(t, today) {
  if (!isOpen(t.status)) return 'done'
  const d = taskDate(t)
  if (!d) return 'none'
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d === addDays(today, 1)) return 'tomorrow'
  return d <= addDays(today, 7) ? 'week' : 'later'
}

/** open before done, then by day, then most urgent first, then where it is written */
export function compareTasks(a, b) {
  const open = Number(!isOpen(a.status)) - Number(!isOpen(b.status))
  if (open) return open
  const da = taskDate(a)
  const db = taskDate(b)
  if (da !== db) return da == null ? 1 : db == null ? -1 : da < db ? -1 : 1
  return priorityRank(b.priority) - priorityRank(a.priority) || (a.path || '').localeCompare(b.path || '') || a.line - b.line
}

/** the most recently finished first */
export function compareFinished(a, b) {
  const on = (t) => t.done || t.cancelled || ''
  return on(b).localeCompare(on(a)) || compareTasks(a, b)
}

// ---------- boards ----------
// A board is a view over one field of the tasks: its columns are that field's
// values, and moving a card changes the field on its line. Nothing about a board
// is stored anywhere.

export const BOARD_GROUPS = [
  { id: 'status', label: 'Status' },
  { id: 'date', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
]

const COLUMNS = {
  status: [
    { id: 'todo', label: 'To do' },
    { id: 'doing', label: 'Doing' },
  ],
  date: BUCKETS.filter((b) => b.id !== 'done'),
  priority: [...PRIORITIES, 'none'].map((id) => ({ id, label: id === 'none' ? 'No priority' : id[0].toUpperCase() + id.slice(1) })),
}
const DONE = BUCKETS.find((b) => b.id === 'done')

/** The columns of a grouping, then Done (cancelled tasks are there too) unless `done` is off */
export const boardColumns = (group, { done = true } = {}) => (done ? [...COLUMNS[group], DONE] : COLUMNS[group])

export function columnOf(task, group, today) {
  if (!isOpen(task.status)) return 'done'
  if (group === 'status') return task.status === '/' ? 'doing' : 'todo'
  if (group === 'priority') return task.priority || 'none'
  return bucketOf(task, today)
}

/** The date a task sits on is the one `taskDate` reads, so that is the one a move changes */
export const dateKeyOf = (t) => (t.due ? 'due' : t.scheduled ? 'scheduled' : t.start ? 'start' : 'due')

/**
 * What being in a column means for a task, as a patch (null: it can't be set,
 * as for Overdue). "Next 7 days" is the day after tomorrow, "Later" a month on.
 */
export function columnFields(group, column, today, dateKey = 'due') {
  if (column === 'done') return { status: 'x' }
  if (group === 'status') return { status: column === 'doing' ? '/' : ' ' }
  if (group === 'priority') return { priority: column === 'none' ? null : column }
  const day = { today, tomorrow: addDays(today, 1), week: addDays(today, 2), later: addMonths(today, 1) }[column]
  if (day) return { [dateKey]: day }
  return column === 'none' ? { due: null, scheduled: null, start: null } : null
}

/** The change dropping `task` on a column makes: null if it is there already or can't go there */
export function dropPatch(task, group, column, today) {
  if (columnOf(task, group, today) === column) return null
  const patch = columnFields(group, column, today, dateKeyOf(task))
  // out of Done into a column that says nothing about the status: open again
  if (patch && !isOpen(task.status) && !patch.status) patch.status = ' '
  return patch
}

/** The patch that puts `task` back as it was before `patch` */
export function undoPatch(task, patch) {
  const back = {}
  for (const k of Object.keys(patch)) back[k] = k === 'title' ? task.text : (task[k] ?? null)
  if ('status' in patch) Object.assign(back, task.done && { done: task.done }, task.cancelled && { cancelled: task.cancelled })
  return back
}

/**
 * A note's tasks as a tree: `roots` (what a board shows as cards) and, for each
 * root with any, its checklist — every task below it in order, with its depth,
 * and how many are finished. `tasks` are one note's, in line order, each with
 * the `parent` line the index gave it.
 */
export function taskTree(tasks) {
  const roots = []
  const lists = new Map()
  const at = new Map() // line → { root: line of its top-level task, depth }
  for (const task of tasks) {
    const parent = at.get(task.parent)
    if (!parent) {
      roots.push(task)
      at.set(task.line, { root: task.line, depth: 0 })
      continue
    }
    const depth = parent.depth + 1
    at.set(task.line, { root: parent.root, depth })
    const list = lists.get(parent.root) || lists.set(parent.root, { items: [], done: 0, total: 0 }).get(parent.root)
    list.items.push({ task, depth })
    list.total++
    if (!isOpen(task.status)) list.done++
  }
  return { roots, lists }
}

/**
 * The checklist of the task at `line`, whichever task that is (taskTree has
 * those of the top-level ones): `tasks` are its note's, in line order. The same
 * { items, done, total } as taskTree gives, depths counted from that task; null
 * if nothing is nested under it.
 */
export function checklistOf(tasks, line) {
  const depths = new Map([[line, 0]])
  const list = { items: [], done: 0, total: 0 }
  for (const task of tasks) {
    const parent = depths.get(task.parent)
    if (parent == null) continue
    depths.set(task.line, parent + 1)
    list.items.push({ task, depth: parent + 1 })
    list.total++
    if (!isOpen(task.status)) list.done++
  }
  return list.total ? list : null
}

// ---------- tags and filters ----------

const TAG_WORD = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)$/u

/** A title and the tags that end it: "Pay rent #home #bills" → { title: "Pay rent", tags: ["home", "bills"] } */
export function splitTags(text) {
  const words = String(text).trim().split(/\s+/)
  const tags = []
  while (words.length > 1) {
    const tag = TAG_WORD.exec(words[words.length - 1])?.[1].replace(/\/+$/, '')
    if (!tag) break
    tags.unshift(tag)
    words.pop()
  }
  return { title: words.join(' '), tags }
}

export const joinTags = (title, tags) => [title, ...tags.map((t) => `#${t}`)].join(' ')

/** What someone typed as a tag, made into one (spaces become dashes); '' if it can't be */
export function cleanTag(typed) {
  const tag = String(typed).trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, '').replace(/\/+$/, '')
  return TAG_WORD.test(`#${tag}`) ? tag : ''
}

/** Is the task under `tag`, or one of its subtags (#home/bills is under #home)? */
export function hasTag(task, tag) {
  const want = tag.toLowerCase()
  return !!task.tags?.some((t) => {
    const have = t.toLowerCase()
    return have === want || have.startsWith(`${want}/`)
  })
}

/** `filter`: { q: words in the title or the note's name, tags: any of these, priority: one, or 'none' } */
export function matchTask(task, { q = '', tags = [], priority = null }) {
  if (priority && (priority === 'none' ? task.priority : task.priority !== priority)) return false
  if (tags.length && !tags.some((t) => hasTag(task, t))) return false
  const needle = q.trim().toLowerCase()
  return !needle || task.text.toLowerCase().includes(needle) || (task.path || '').toLowerCase().includes(needle)
}

// ---------- showing a change before it is written ----------

// the task as a line, from what the index keeps of it
function lineOf(t) {
  const fields = FIELD_KEYS.filter((k) => t[k]).map((k) => tokenFor(k, t[k]))
  return `${' '.repeat(t.indent || 0)}- [${t.status}] ${[t.text, ...fields].join(' ')}`
}

/** What an index entry becomes under `patch`, worked out without the note */
export function previewEdit(task, patch, opts) {
  const r = editTaskLine(lineOf(task), patch, opts)
  return { ...parseTask(r.line), line: task.line, ...(task.parent != null && { parent: task.parent }) }
}
