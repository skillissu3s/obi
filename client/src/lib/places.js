// Your place in a note: the line you were reading when you marked it, so a long note
// can be picked up where you left off. Kept per person in the preferences (synced
// across devices), never in the note. A place is the line's words and its number:
// the words find it again after edits above it, the number when the words changed.
import { usePrefs } from '../store/prefs.js'

const MAX = 400 // places kept (the oldest go first)
const keyOf = (ws, path) => `${ws}:${path}`

export const usePlace = (ws, path) => usePrefs((s) => s.places?.[keyOf(ws, path)] || null)

/** Keeps `place` ({ line, text }) as your place in the note, or forgets it (null) */
export function savePlace(ws, path, place) {
  const all = { ...(usePrefs.getState().places || {}) }
  const key = keyOf(ws, path)
  if (place) all[key] = { line: place.line, text: String(place.text || '').trim().slice(0, 300), at: Date.now() }
  else delete all[key]
  const keys = Object.keys(all)
  if (keys.length > MAX)
    keys
      .sort((a, b) => all[a].at - all[b].at)
      .slice(0, keys.length - MAX)
      .forEach((k) => delete all[k])
  usePrefs.getState().set({ places: all })
}

/** Where a place is in the note now (a 0-based line): its words nearest to where they were, else its line */
export function placeLine(lines, place) {
  if (!place || !lines.length) return null
  const words = String(place.text || '').trim()
  if (words) {
    let best = -1
    // (a long line is kept by its start)
    const same = (l) => (words.length >= 40 ? l.trim().startsWith(words) : l.trim() === words)
    lines.forEach((l, i) => {
      if (same(l) && (best < 0 || Math.abs(i - place.line) < Math.abs(best - place.line))) best = i
    })
    if (best >= 0) return best
  }
  return Math.max(0, Math.min(lines.length - 1, place.line))
}

/** A line's words as they read rendered: without the markdown around them */
export const plainLine = (s) =>
  String(s)
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/==|~~|\*\*|__|[*_`]/g, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/-]\]\s*)?/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?(?:\[![^\]]*\]\s*)?/, '')
    .replace(/\s+/g, ' ')
    .trim()
