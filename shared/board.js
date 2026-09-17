// Whiteboard file format shared by server and client.
//
// Boards are plain JSON so they live happily in a git repository:
//   * one element per line, sorted by id, so concurrent edits merge line-by-line
//   * every element line ends with a comma and the list is closed by a `null`
//     sentinel, so appending on two machines never touches the same line.
// The same format is used for standalone `.board` files and for the canvas layer
// kept beside each note in `.obi/layers/<note path>.json`.

export const BOARD_EXT = 'board'
export const BOARD_TYPE = 'obi-board'
export const BOARD_VERSION = 1
export const LAYER_DIR = '.obi/layers'

export const isBoardPath = (p) => typeof p === 'string' && /\.board$/i.test(p)
export const layerPathFor = (notePath) => `${LAYER_DIR}/${notePath}.json`
export const notePathForLayer = (p) => (p.startsWith(LAYER_DIR + '/') && p.endsWith('.json') ? p.slice(LAYER_DIR.length + 1, -5) : null)
export const isLayerPath = (p) => notePathForLayer(p) != null

export class BoardParseError extends Error {}

const KEY_ORDER = ['id', 'type', 'x', 'y', 'w', 'h', 'z']

// Stable key order keeps diffs small and makes equality checks cheap.
export function normalizeElement(el) {
  const out = {}
  for (const k of KEY_ORDER) if (el[k] !== undefined) out[k] = el[k]
  for (const k of Object.keys(el).sort()) {
    if (out[k] !== undefined || el[k] === undefined || el[k] === null) continue
    const v = el[k]
    out[k] = typeof v === 'number' ? roundNum(v) : v
  }
  for (const k of ['x', 'y', 'w', 'h']) if (typeof out[k] === 'number') out[k] = roundNum(out[k])
  if (Array.isArray(out.points)) out.points = out.points.map((p) => p.map(roundNum))
  return out
}

const roundNum = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)

export function isValidElement(el) {
  return !!el && typeof el === 'object' && typeof el.id === 'string' && el.id.length > 0 && el.id.length <= 64 && typeof el.type === 'string'
}

export function parseBoard(text) {
  if (text == null || !String(text).trim()) return []
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new BoardParseError('This board file is not valid JSON')
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.elements) ? data.elements : null
  if (!list) throw new BoardParseError('This file is not an Obi board')
  const seen = new Set()
  const out = []
  for (const el of list) {
    if (!isValidElement(el) || seen.has(el.id)) continue
    seen.add(el.id)
    out.push(el)
  }
  return out
}

export function serializeBoard(elements) {
  const list = [...elements].filter(isValidElement).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lines = list.map((e) => `    ${JSON.stringify(normalizeElement(e))},`)
  return `{\n  "type": "${BOARD_TYPE}",\n  "version": ${BOARD_VERSION},\n  "elements": [\n${lines.length ? lines.join('\n') + '\n' : ''}    null\n  ]\n}\n`
}

export const emptyBoard = () => serializeBoard([])

const sig = (el) => (el ? JSON.stringify(normalizeElement(el)) : null)

// Element-wise three-way merge. Returns the merged file text, or null when any side is unreadable.
export function mergeBoards(baseText, oursText, theirsText) {
  let base, ours, theirs
  try {
    base = new Map(parseBoard(baseText || '').map((e) => [e.id, e]))
    ours = new Map(parseBoard(oursText || '').map((e) => [e.id, e]))
    theirs = new Map(parseBoard(theirsText || '').map((e) => [e.id, e]))
  } catch {
    return null
  }
  const ids = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])
  const out = []
  for (const id of ids) {
    const b = sig(base.get(id))
    const o = sig(ours.get(id))
    const t = sig(theirs.get(id))
    let pick
    if (o === t) pick = ours.get(id)
    else if (o === b) pick = theirs.get(id)
    else if (t === b) pick = ours.get(id)
    else pick = ours.get(id) || theirs.get(id) // both changed: keep ours, and never lose an element to a delete
    if (pick) out.push(pick)
  }
  return serializeBoard(out)
}

// Diff two element lists: what to set and what to delete to go from `current` to `next`.
export function diffElements(current, next) {
  const cur = new Map(current.map((e) => [e.id, e]))
  const set = []
  const del = []
  const seen = new Set()
  for (const e of next) {
    seen.add(e.id)
    const c = cur.get(e.id)
    if (!c || sig(c) !== sig(e)) set.push(e)
  }
  for (const id of cur.keys()) if (!seen.has(id)) del.push(id)
  return { set, del }
}

// Notes an element refers to (note cards, element links) — used for backlinks and the graph.
export function boardLinks(elements) {
  const out = new Set()
  for (const e of elements) {
    if (e.type === 'note' && e.path) out.add(e.path)
    if (typeof e.link === 'string' && e.link && !/^[a-z]+:/i.test(e.link)) out.add(e.link)
  }
  return [...out]
}

// Plain text inside a board, for search.
export function boardText(elements) {
  return elements
    .map((e) => [e.text, e.name].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n')
}
