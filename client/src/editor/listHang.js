// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
//
// A list item whose text runs onto a second row carries on under its own text,
// not back at the left edge under the bullet: its line gets a hanging indent as
// wide as what comes before the text (the indentation, the bullet or number,
// the checkbox). That width is measured from the rendered line rather than
// worked out, so it is right for any font; the published page measures its own
// list items the same way (hangListItems in client/src/publish/main.js), which
// keeps every line breaking at the same word on both.
//
// Only an item that is one line of text gets it — not one whose paragraph goes
// on over more source lines, holds a second block, or is not text at all — on
// both sides alike.
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { revealSelection } from './livePreview.js'

// indentation, the mark, an optional task box, and the space before the text
const LEAD = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+\[[ xX/-]\])?[ \t]+(?=\S)/

// the item on `line` is one line of text: a paragraph (or task) ending on it,
// nothing but nested lists after it
function plainItem(state, line, lead) {
  let node = syntaxTree(state).resolveInner(line.from + lead, 1)
  while (node && node.name !== 'ListItem') node = node.parent
  if (!node || state.doc.lineAt(node.from).number !== line.number) return false
  let blocks = 0
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'ListMark' || c.name === 'BulletList' || c.name === 'OrderedList') continue
    if (++blocks > 1 || (c.name !== 'Paragraph' && c.name !== 'Task') || c.to > line.to) return false
  }
  return blocks === 1
}

// { ranges: [[from, to]], hang: Map(line start -> px), held: Set(line start) }:
// what was measured where, and the lines in those ranges left as they were
const setHang = StateEffect.define()

const mark = (px) => Decoration.line({ class: 'cm-lp-hang', attributes: { style: `--hang:${px}px` } })

const hangField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setHang)) continue
      const { ranges, hang, held } = e.value
      // lines out of view keep what they had, so scrolling back to them changes nothing
      deco = deco.update({
        filter: (from) => held.has(from) || !ranges.some(([a, b]) => from >= a && from <= b),
        add: [...hang].sort((x, y) => x[0] - y[0]).map(([from, px]) => mark(px).range(from)),
      })
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const round = (n) => Math.round(n * 100) / 100

// A line whose measured indent changes again and again in a short while is in
// some loop between its indent and its own layout; it keeps the value it has
// rather than shake. (Text edits start the count afresh.)
const RESTLESS = 3
const RESTLESS_MS = 2000

const measurer = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view
      this.changes = new Map() // line start -> { n, since }
      this.measure = { read: (v) => this.read(v), write: (m, v) => this.write(m, v) }
      view.requestMeasure(this.measure)
      document.fonts?.ready.then(() => !this.gone && view.requestMeasure(this.measure))
    }
    update(u) {
      if (u.docChanged) this.changes.clear()
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.selectionSet) u.view.requestMeasure(this.measure)
    }
    read(view) {
      const hang = new Map()
      const held = new Set()
      const scale = view.scaleX || 1
      const { doc } = view.state
      const selection = revealSelection(view.state)
      const ranges = view.visibleRanges.map(({ from, to }) => [doc.lineAt(from).from, to])
      // While the cursor is at an item's bullet, live preview shows the raw "- "
      // (livePreview.js, editingMark), a little narrower or wider than the bullet.
      // Such a line keeps the indent it had rather than re-wrapping as the cursor
      // comes and goes; it is measured again once the cursor leaves the bullet.
      const covered = (from, to) => selection.ranges.some((r) => (r.empty ? r.from >= from && r.from <= to : r.from >= from && r.to <= to))
      for (const [from, to] of ranges) {
        for (let pos = from; pos <= to; ) {
          const line = doc.lineAt(pos)
          pos = line.to + 1
          const m = LEAD.exec(line.text)
          if (!m || !plainItem(view.state, line, m[0].length)) continue
          if (covered(line.from, line.from + m[0].length)) {
            held.add(line.from)
            continue
          }
          const a = view.coordsAtPos(line.from, 1)
          const b = view.coordsAtPos(line.from + m[0].length, 1)
          // both on the first row (a lead too wide for the column wraps itself: leave that line be)
          if (!a || !b || b.top >= a.bottom - 1 || b.bottom <= a.top + 1 || b.left <= a.left) continue
          hang.set(line.from, round((b.left - a.left) / scale))
        }
      }
      return { doc, ranges, hang, held }
    }
    write({ doc, ranges, hang, held }, view) {
      // what is there already, for the lines just measured
      const now = new Map()
      view.state.field(hangField).between(0, doc.length, (from, to, d) => {
        if (!held.has(from) && ranges.some(([a, b]) => from >= a && from <= b)) now.set(from, d.spec.attributes.style)
      })
      // lines that keep changing keep what they have
      const t = Date.now()
      for (const [k, v] of [...hang]) {
        const had = now.get(k)
        if (had == null || had === `--hang:${v}px`) continue
        const c = this.changes.get(k)
        const fresh = !c || t - c.since > RESTLESS_MS
        const n = fresh ? 1 : c.n + 1
        this.changes.set(k, { n, since: fresh ? t : c.since })
        if (n > RESTLESS) {
          hang.delete(k)
          held.add(k)
        }
      }
      // nothing to do when every measured line already has its value, and no line lost one
      const stale = [...hang].some(([k, v]) => now.get(k) !== `--hang:${v}px`) || [...now.keys()].some((k) => !held.has(k) && !hang.has(k))
      if (!stale) return
      queueMicrotask(() => {
        if (this.gone) return
        // the text changed in between: those positions are stale, measure again
        if (view.state.doc !== doc) return view.requestMeasure(this.measure)
        view.dispatch({ effects: setHang.of({ ranges, hang, held }) })
      })
    }
    destroy() {
      this.gone = true
    }
  },
)

export const listHang = [hangField, measurer]
