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

/**
 * Edits the task at `line` in a note's text. The note may have changed since
 * the line number was read, so `title` (as the index gave it) must still match;
 * if the line moved, the task is found by its title as long as that is
 * unambiguous. Returns { text, line, task, next }.
 */
export function applyTaskEdit(text, { line, title, patch, today }) {
  const lines = text.split('\n')
  const is = (n) => {
    const t = lines[n] != null && parseTask(lines[n])
    return !!t && (title == null || t.text === title)
  }
  let at = line
  if (!is(at)) {
    const hits = lines.map((_, n) => n).filter(is)
    if (hits.length !== 1) throw new TaskChangedError()
    at = hits[0]
  }
  const r = editTaskLine(lines[at], patch, { today })
  lines[at] = r.line
  if (r.next) lines.splice(at + 1, 0, r.next)
  return { text: lines.join('\n'), line: at, task: parseTask(r.line), next: r.next ? parseTask(r.next) : null }
}

/** A new task at the end of a note, with its siblings if it ends in a list of them */
export function appendTask(text, taskLine) {
  const body = text.replace(/\n+$/, '')
  if (!body) return `${taskLine}\n`
  const last = body.slice(body.lastIndexOf('\n') + 1)
  return `${body}${TASK_LINE.test(last) ? '\n' : '\n\n'}${taskLine}\n`
}

/** The line for a new, open task */
export function newTaskLine(title, fields = {}, { today = todayIso() } = {}) {
  const base = `- [ ] ${String(title).replace(/\s+/g, ' ').trim()}`
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
