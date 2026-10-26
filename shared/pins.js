// Calendar pins: a day marked with a badge — "Launch day", a birthday, a deadline.
// They live beside the notes in .obi/calendar.json (never in a note's markdown),
// so they travel with a vault or a repository the same way canvas drawings do.
import { isIsoDate } from './tasks.js'

export const CALENDAR_FILE = '.obi/calendar.json'
export const MAX_PINS = 1000

export const PIN_COLORS = {
  red: '#e5484d',
  orange: '#f76b15',
  amber: '#e2a336',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#3e7bfa',
  violet: '#8e4ec6',
  pink: '#d6409f',
  gray: '#8b8d98',
}

/** Ready-made pins: a name, a mark and a colour to start from */
export const PIN_TEMPLATES = [
  { id: 'launch', title: 'Launch day', emoji: '🚀', color: 'violet' },
  { id: 'deadline', title: 'Deadline', emoji: '⏰', color: 'red' },
  { id: 'release', title: 'Release', emoji: '📦', color: 'blue' },
  { id: 'milestone', title: 'Milestone', emoji: '🏁', color: 'teal' },
  { id: 'meeting', title: 'Big meeting', emoji: '🤝', color: 'amber' },
  { id: 'exam', title: 'Exam', emoji: '📚', color: 'orange' },
  { id: 'trip', title: 'Trip', emoji: '✈️', color: 'blue' },
  { id: 'holiday', title: 'Holiday', emoji: '🌴', color: 'green' },
  { id: 'birthday', title: 'Birthday', emoji: '🎂', color: 'pink', repeat: 'yearly' },
  { id: 'anniversary', title: 'Anniversary', emoji: '💍', color: 'pink', repeat: 'yearly' },
  { id: 'custom', title: '', emoji: '📌', color: 'gray' },
]

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
// a mark is one emoji (or a character or two); anything longer is cut
const mark = (s) => [...String(s ?? '').trim()].slice(0, 4).join('') || '📌'

/** One pin, cleaned up, or null if it isn't one */
export function cleanPin(p) {
  if (!p || typeof p !== 'object' || !isIsoDate(p.date)) return null
  const title = clip(p.title, 80)
  if (!title) return null
  const pin = {
    id: /^[a-z0-9]{6,24}$/i.test(p.id || '') ? p.id : null,
    date: p.date,
    title,
    emoji: mark(p.emoji),
    color: p.color in PIN_COLORS ? p.color : 'gray',
  }
  if (p.repeat === 'yearly') pin.repeat = 'yearly'
  if (isIsoDate(p.until) && p.until > p.date) pin.until = p.until // a stretch of days: a trip, a holiday
  const note = clip(p.note, 300)
  if (note) pin.note = note
  return pin
}

/** The file's contents, cleaned up: { pins: [...] } */
export function parseCalendar(text) {
  let data
  try {
    data = typeof text === 'string' ? JSON.parse(text || '{}') : text
  } catch {
    data = {}
  }
  const pins = Array.isArray(data?.pins) ? data.pins.map(cleanPin).filter((p) => p && p.id).slice(0, MAX_PINS) : []
  return { pins }
}

export const serializeCalendar = (cal) => JSON.stringify({ pins: cal.pins }, null, 2) + '\n'

// the day a yearly pin falls on in a given year (29 February: the 28th when there is none)
function inYear(date, year) {
  const md = date.slice(5)
  if (md === '02-29' && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) return `${year}-02-28`
  return `${year}-${md}`
}

/** Does a pin mark this day? (its own day, every day of its stretch, or yearly on the day) */
export function pinOn(pin, iso) {
  if (pin.repeat === 'yearly') return iso >= pin.date && inYear(pin.date, Number(iso.slice(0, 4))) === iso
  if (pin.until) return iso >= pin.date && iso <= pin.until
  return iso === pin.date
}

/** The next day (from `today`, inclusive) a pin marks, or null once it has gone by */
export function nextOccurrence(pin, today) {
  if (pin.repeat === 'yearly') {
    if (pin.date >= today) return pin.date
    const y = Number(today.slice(0, 4))
    const d = inYear(pin.date, y)
    return d >= today ? d : inYear(pin.date, y + 1)
  }
  if (pin.until && pin.date <= today && today <= pin.until) return today
  return pin.date >= today ? pin.date : null
}

/** Pins still to come, soonest first: [{ pin, date }] */
export function upcomingPins(pins, today, limit = 5) {
  return pins
    .map((pin) => ({ pin, date: nextOccurrence(pin, today) }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.pin.title.localeCompare(b.pin.title)))
    .slice(0, limit)
}

/** Whole days from `today` to `iso` (both YYYY-MM-DD) */
export function daysBetween(today, iso) {
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
  return Math.round((d - t) / 86400000)
}
