// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
// Anchors are persisted in every note's canvas layer, and the published page
// resolves them with this same code. Changing the format or the matching
// changes where existing drawings land, everywhere.
//
// Anchors tie canvas elements to text in a note without touching the markdown.
// Stored as a quote plus a little context (like W3C text-quote selectors), so they
// survive edits made anywhere — other devices, git pulls, other apps.

const CTX = 32
const MAX_QUOTE = 160

export function makeAnchor(text, from, to) {
  const q = text.slice(from, Math.min(to, from + MAX_QUOTE))
  return { q, pre: text.slice(Math.max(0, from - CTX), from), suf: text.slice(from + q.length, from + q.length + CTX), pos: from }
}

// Anchor to a whole line (used to keep drawings next to the paragraph they were drawn on).
export function makeLineAnchor(doc, lineNumber) {
  const line = doc.line(lineNumber)
  const text = doc.sliceString(Math.max(0, line.from - CTX), Math.min(doc.length, line.to + CTX))
  const offset = line.from - Math.max(0, line.from - CTX)
  const a = makeAnchor(text, offset, offset + line.length)
  return { ...a, pos: line.from, line: 1 }
}

function commonSuffix(a, b) {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
function commonPrefix(a, b) {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

export function resolveAnchor(text, a) {
  if (!a || !a.q) return null
  const q = a.q
  let best = null
  const consider = (idx) => {
    const pre = commonSuffix(text.slice(Math.max(0, idx - CTX), idx), a.pre || '')
    const suf = commonPrefix(text.slice(idx + q.length, idx + q.length + CTX), a.suf || '')
    const score = pre + suf - Math.abs(idx - (a.pos || 0)) / 4000
    if (!best || score > best.score) best = { idx, score }
  }
  if (text.startsWith(q, a.pos)) consider(a.pos)
  let idx = text.indexOf(q)
  let n = 0
  while (idx >= 0 && n < 300) {
    consider(idx)
    idx = text.indexOf(q, idx + 1)
    n++
  }
  if (best) return { from: best.idx, to: best.idx + q.length }
  // the quoted text was edited: fall back to its surrounding context
  if (a.pre && a.pre.length >= 8) {
    const i = text.indexOf(a.pre)
    if (i >= 0) {
      const from = i + a.pre.length
      const end = a.suf && a.suf.length >= 8 ? text.indexOf(a.suf, from) : -1
      const to = end >= 0 && end - from < MAX_QUOTE * 3 ? end : Math.min(text.length, from + q.length)
      return { from, to: Math.max(from, to) }
    }
  }
  if (a.line && a.pos != null) {
    const pos = Math.min(a.pos, text.length)
    return { from: pos, to: pos }
  }
  return null
}

/**
 * Keeps live positions for every anchor on the layer: resolved once from the stored
 * quote, then mapped through each editor change so they follow typing exactly.
 */
export class AnchorTracker {
  constructor() {
    this.entries = new Map() // anchor object -> { from, to, sig, line }
    this.textVersion = -1
    this.text = ''
    this.dirty = false // local edits moved anchors since they were stored
  }

  setText(text, version) {
    this.text = text
    this.textVersion = version
  }

  get(anchor) {
    if (!anchor) return null
    const sig = `${anchor.q}${anchor.pos}${anchor.pre}`
    let e = this.entries.get(anchor)
    if (!e || e.sig !== sig) {
      const r = resolveAnchor(this.text, anchor)
      e = { from: r?.from ?? null, to: r?.to ?? null, sig, line: !!anchor.line, lost: !r }
      this.entries.set(anchor, e)
    }
    return e.lost ? null : e
  }

  // keep only anchors that still exist on the layer
  retain(anchors) {
    for (const a of this.entries.keys()) if (!anchors.has(a)) this.entries.delete(a)
  }

  map(changes, local) {
    for (const e of this.entries.values()) {
      if (e.lost || e.from == null) continue
      const from = changes.mapPos(e.from, 1)
      let to = changes.mapPos(e.to, -1)
      if (to < from) to = from
      if (from !== e.from || to !== e.to) {
        e.from = from
        e.to = to
        if (local) {
          e.moved = true
          this.dirty = true
        }
      }
    }
  }
}
