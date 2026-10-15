// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
// The editor (editor/spaces.js, fed by NoteCanvas) and the published page
// (publish/main.js) both place a note's drawing spaces with this code, so a
// space opens under the same line on both and moves the lines below it by the
// same amount.
//
// A drawing space is room opened under a line of the note for drawing in,
// without blank lines in the markdown: a canvas element { type: 'space',
// anchor (a line anchor), h } kept in the note's canvas layer like any drawing.
// The note's text never changes.

export const SPACE_MIN = 24
export const SPACE_MAX = 2400
export const SPACE_DEFAULT = 160
export const SPACE_STEP = 8

export const spaceHeight = (h) => Math.round(Math.min(SPACE_MAX, Math.max(SPACE_MIN, Number(h) || SPACE_DEFAULT)))

const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/

/**
 * For each line of `text` (0-based), the line a space asked for under it really
 * opens under: a line inside a block that is shown whole — a fenced code block,
 * a math block, a table, a callout, the front matter — gives the block's last
 * line, since a space can't split it (the editor shows those as one widget, the
 * page as one element).
 */
export function spaceEnds(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\r$/, ''))
  const end = lines.map((_, i) => i)
  const span = (a, b) => {
    for (let k = a; k <= b; k++) end[k] = b
  }
  let i = 0
  if (/^---\s*$/.test(lines[0] || '')) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j])) {
        span(0, j)
        i = j + 1
        break
      }
    }
  }
  for (; i < lines.length; i++) {
    const s = lines[i]
    const fence = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(s)
    if (fence) {
      const ch = fence[1][0]
      const len = fence[1].length
      let j = i + 1
      for (; j < lines.length; j++) {
        const t = lines[j].replace(/^\s*(?:>\s*)*/, '').trim()
        if (t.length >= len && t === ch.repeat(t.length)) break
      }
      const last = Math.min(j, lines.length - 1)
      span(i, last)
      i = last
      continue
    }
    if (/^\s*\$\$/.test(s)) {
      if (s.trim().slice(2).includes('$$')) continue // a one-line block
      let j = i + 1
      while (j < lines.length && !lines[j].includes('$$')) j++
      const last = Math.min(j, lines.length - 1)
      span(i, last)
      i = last
      continue
    }
    if (/^\s*>\s*\[!/.test(s)) {
      let j = i
      while (j + 1 < lines.length && /^\s*>/.test(lines[j + 1])) j++
      span(i, j)
      i = j
      continue
    }
    if (s.includes('|') && i + 1 < lines.length && DELIM.test(lines[i + 1])) {
      let j = i + 1
      while (j + 1 < lines.length && lines[j + 1].includes('|') && lines[j + 1].trim()) j++
      span(i, j)
      i = j
    }
  }
  return end
}

/**
 * Where each drawing space of `elements` opens: [{ id, line, h }], `line` the
 * (0-based) line it opens under, in order down the note (spaces under the same
 * line by id). `lineOf(anchor)` gives the line an anchor is on now, or null;
 * `ends` is spaceEnds of the note's text.
 */
export function spacePlacements(elements, lineOf, ends) {
  const out = []
  for (const el of elements || []) {
    if (el?.type !== 'space' || !el.anchor) continue
    const n = lineOf(el.anchor)
    if (n == null || n < 0) continue
    const line = ends[Math.min(n, ends.length - 1)] ?? n
    out.push({ id: el.id, line, h: spaceHeight(el.h) })
  }
  return out.sort((a, b) => a.line - b.line || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
