/**
 * ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
 * The editor (NoteCanvas.jsx) and the published page (publish/main.js) both
 * answer "how far sideways do the words go?" with this, from their own DOM, so
 * a line routed past the end of the text ends in the same place on both.
 *
 * Returns reach(from, to) -> [left, right] in world pixels, or null: where the
 * words extend on the rows whose middle lies within a line (`pitch`) of height
 * `from`, which is the row either side of a gap, and on every row from there to
 * height `to`. Words are what a reader sees, so a trailing space or an
 * indentation never counts; `ignore` is a selector for text that is not words
 * (the editor's remote cursor labels). `world` turns a DOMRect into world
 * pixels { left, right, top, bottom }.
 */
export function wordReach(root, { world, pitch, ignore }) {
  const range = document.createRange()
  let nodes = null

  // each text node with the heights it spans; its words are measured only if a row of it is asked about
  const collect = () => {
    const found = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/\S/.test(node.nodeValue) || (ignore && node.parentElement.closest(ignore))) continue
      range.selectNodeContents(node)
      const r = range.getBoundingClientRect()
      if (r.width > 0) found.push({ node, ...world(r), words: null })
    }
    return found
  }

  const measure = (node) => {
    const words = []
    for (const m of node.nodeValue.matchAll(/\S+/g)) {
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      for (const r of range.getClientRects()) {
        if (r.width <= 0) continue
        const w = world(r)
        words.push({ left: w.left, right: w.right, mid: (w.top + w.bottom) / 2 })
      }
    }
    return words
  }

  return (from, to) => {
    nodes ??= collect()
    const lo = Math.min(from - pitch, to)
    const hi = Math.max(from + pitch, to)
    let left = Infinity
    let right = -Infinity
    for (const n of nodes) {
      if (n.bottom < lo || n.top > hi) continue
      n.words ??= measure(n.node)
      for (const w of n.words) {
        if (w.mid < lo || w.mid > hi) continue
        left = Math.min(left, w.left)
        right = Math.max(right, w.right)
      }
    }
    return right >= left ? [left, right] : null
  }
}
