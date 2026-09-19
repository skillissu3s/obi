// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing this file.
//
// Runs on a published note. It lays the note's canvas out with the very same
// code the app uses (resolveLayout + resolveAnchor), answering its two
// questions — "where is this line?" and "where is this text?" — from the
// published page instead of from CodeMirror. That is what keeps a sticky note,
// an arrow to a phrase or a highlight exactly where the author put them.
// fonts are imported from publish.css so they land in that file, not in a
// chunk shared with the app that a published page never loads
import './publish.css'
import { resolveLayout, measureMarkdown } from '../canvas/layout.js'
import { resolveAnchor } from '../canvas/anchors.js'
import { boardToSvg, highlightCss } from '@shared/boardsvg.js'

const article = document.getElementById('content')
let data = readPayload()

// A phone is narrower than the author's text column. The column keeps its
// width (so every line breaks where it did for the author and the drawings stay
// on them) and the browser is asked to lay the page out that wide and show it
// scaled to the screen; pinch-zoom still works.
function fitViewport() {
  const main = article.closest('main')
  const meta = document.querySelector('meta[name="viewport"]')
  if (!main || !meta) return
  const need = Math.ceil(main.offsetWidth)
  const screenW = Math.min(window.screen?.width || Infinity, document.documentElement.clientWidth || Infinity)
  if (need > screenW) meta.setAttribute('content', `width=${need}, initial-scale=${(screenW / need).toFixed(4)}`)
}
fitViewport()

function readPayload() {
  try {
    return JSON.parse(document.getElementById('obi-canvas')?.textContent || 'null')
  } catch {
    return null
  }
}

const lineOf = (text, pos) => {
  let n = 0
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++
  return n
}

// Source-line positions, measured from the page. World coordinates put x = 0
// at the left edge of the text column and y = 0 at its top, like the editor's
// canvas origin; only the relation between lines and drawings matters.
function measure() {
  const box = article.getBoundingClientRect()
  const ox = box.left + window.scrollX
  const oy = box.top + window.scrollY
  const style = getComputedStyle(article)
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.75
  const tops = new Map()
  const bottoms = new Map()
  // document order: a block that starts on a line comes before anything inside
  // it, so the block wins — and a heading's block includes its padding, which
  // is exactly how the editor measures a heading line
  for (const el of article.querySelectorAll('[data-line]:not(input)')) {
    const n = Number(el.getAttribute('data-line'))
    if (!Number.isFinite(n) || tops.has(n)) continue
    const r = el.getBoundingClientRect()
    tops.set(n, r.top + window.scrollY - oy)
    const end = el.getAttribute('data-line-end')
    if (end != null && el.tagName === 'PRE') {
      // a fence: the opening line is the block's top (the editor hides it),
      // each code line follows at the code line-height, and the closing line
      // is the block's bottom
      const cs = getComputedStyle(el)
      const codeLine = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6
      const padTop = parseFloat(cs.paddingTop) || 0
      const last = Number(end) - 1
      for (let k = n + 1; k < last; k++) if (!tops.has(k)) tops.set(k, r.top + window.scrollY - oy + padTop + (k - n - 1) * codeLine)
      if (!tops.has(last)) tops.set(last, r.bottom + window.scrollY - oy)
    }
    bottoms.set(n, r.bottom + window.scrollY - oy)
  }
  const known = [...tops.keys()].sort((a, b) => a - b)
  return { ox, oy, line, tops, known, width: box.width }
}

// The top of any source line: exact when the page marks it, otherwise between
// its nearest marked neighbours (lines inside widgets, blank lines).
function lineTop(m, n) {
  if (m.tops.has(n)) return m.tops.get(n)
  let lo = -1
  let hi = -1
  for (const k of m.known) {
    if (k < n) lo = k
    else if (k > n) {
      hi = k
      break
    }
  }
  if (lo < 0 && hi < 0) return 0
  if (lo < 0) return m.tops.get(hi) - (hi - n) * m.line
  if (hi < 0) return m.tops.get(lo) + (n - lo) * m.line
  const a = m.tops.get(lo)
  const b = m.tops.get(hi)
  return a + ((b - a) * (n - lo)) / (hi - lo)
}

// Markdown syntax a quote can carry that the rendered text no longer has.
const plain = (q) =>
  String(q)
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/==|~~|\*\*|__|[*_`]/g, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/-]\]\s*)?/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/\s+/g, ' ')

// The text node run that holds a source line: from its marker (or block) up
// to the next line's marker.
function lineNodes(n) {
  const start = article.querySelector(`[data-line="${n}"]:not(input)`)
  if (!start) return null
  const marker = start.classList.contains('obi-ln')
  const block = marker ? start.parentElement : start
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const nodes = []
  let on = !marker
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      if (node === start) on = true
      // anything that starts another source line ends this one (the next
      // marker, a nested list item, a table row…)
      else if (on && node.hasAttribute('data-line') && node.tagName !== 'INPUT') break
      continue
    }
    // the bullet, number and indentation are drawing, not the line's words
    if (on && node.nodeValue && !node.parentElement.closest('.obi-bullet, .obi-num, .obi-indent')) nodes.push(node)
  }
  return nodes
}

// A DOM Range over the anchored text, found by its words within its own line.
function rangeFor(anchor) {
  const r = resolveAnchor(data.text, anchor)
  if (!r || r.to <= r.from) return null
  const n = lineOf(data.text, r.from)
  const nodes = lineNodes(n)
  if (!nodes?.length) return null
  let joined = ''
  const at = []
  for (const node of nodes) {
    at.push([joined.length, node])
    joined += node.nodeValue
  }
  const want = plain(data.text.slice(r.from, r.to)).trim()
  if (!want) return null
  const flat = joined.replace(/\s+/g, ' ')
  // map positions in the whitespace-collapsed string back to the joined one
  const map = []
  for (let i = 0, prevSpace = false; i < joined.length; i++) {
    const space = /\s/.test(joined[i])
    if (space && prevSpace) continue
    map.push(i)
    prevSpace = space
  }
  let i = flat.indexOf(want)
  if (i < 0) i = flat.toLowerCase().indexOf(want.toLowerCase())
  if (i < 0) return null
  const from = map[i]
  const to = map[i + want.length - 1] + 1
  const locate = (pos) => {
    let hit = at[0]
    for (const e of at) if (e[0] <= pos) hit = e
    return [hit[1], Math.min(pos - hit[0], hit[1].nodeValue.length)]
  }
  const range = document.createRange()
  range.setStart(...locate(from))
  range.setEnd(...locate(to))
  return range
}

function textRect(m, anchor) {
  const range = rangeFor(anchor)
  if (!range) return null
  const rects = [...range.getClientRects()].filter((r) => r.width > 0)
  if (!rects.length) return null
  const first = rects[0]
  const last = rects[rects.length - 1]
  const top = first.top + window.scrollY - m.oy
  // one line: a tight box; several lines: the column, as the editor does
  if (Math.abs(first.top - last.top) < 4) {
    return { x: first.left + window.scrollX - m.ox, y: top, w: Math.max(4, last.right - first.left), h: Math.max(4, last.bottom - first.top) }
  }
  return { x: 0, y: top, w: m.width, h: last.bottom - first.top }
}

let layers = null

function ensureLayers() {
  if (layers) return layers
  const under = document.createElement('div')
  under.className = 'obi-under'
  const over = document.createElement('div')
  over.className = 'obi-over'
  document.body.append(under, over)
  layers = { under, over }
  return layers
}

// Boards drawn by the server (a published whiteboard, or one embedded in the
// note) can't measure their markdown blocks, so a block whose stored height is
// out of date would be cut off. Let each one grow to fit what it holds.
function fitMarkdownBlocks() {
  for (const fo of document.querySelectorAll('svg.board-svg foreignObject')) {
    const md = fo.querySelector('.cv-md')
    if (!md) continue
    const box = md.parentElement
    const need = Math.ceil(md.scrollHeight + (parseFloat(getComputedStyle(box).paddingTop) || 0) * 2)
    const have = Number(fo.getAttribute('height')) || 0
    if (need > have) {
      fo.setAttribute('height', String(need))
      box.style.height = `${need}px`
    }
  }
}

function render() {
  fitMarkdownBlocks()
  if (!article || !data?.elements?.length) {
    if (layers) layers.under.replaceChildren(), layers.over.replaceChildren()
    return
  }
  const m = measure()
  const env = {
    version: Math.random(),
    lineTop: (anchor) => {
      const r = resolveAnchor(data.text, anchor)
      return r ? lineTop(m, lineOf(data.text, r.from)) : null
    },
    textRect: (anchor) => textRect(m, anchor),
  }
  // A markdown block grows to fit its content in the editor, so its stored
  // height can be stale; measure it here with the same rules and font.
  const elements = data.elements.map((el) => {
    if (el.type !== 'text' || !el.md) return el
    const m2 = measureMarkdown(data.md?.[el.id] || '', { fs: el.fs ?? 20, width: el.w || 320, family: 'var(--font-editor)' })
    return m2.h > (el.h || 0) ? { ...el, h: m2.h } : el
  })
  const layout = resolveLayout({ list: elements }, env)

  // Draw with the resolved geometry: bound arrows get their resolved points
  // baked in, so the renderer doesn't try to re-resolve text it can't see.
  const flat = layout.list.map((el) => {
    const { anchor, dy, _src, _pts, ...rest } = el
    void anchor
    void dy
    void _src
    if (_pts) {
      const { start, end, ...plainEl } = rest
      void start
      void end
      return { ...plainEl, points: _pts.map(([x, y]) => [x - plainEl.x, y - plainEl.y]) }
    }
    return rest
  })
  const { svg, empty, x, y, width, height } = boardToSvg(flat, {
    position: true,
    padding: 24,
    fileUrl: (src) => `${data.fileBase}${encodeURIComponent(src)}`,
    renderMarkdown: (text, el) => data.md?.[el.id] ?? '',
  })

  const { under, over } = ensureLayers()
  over.innerHTML = empty ? '' : svg
  const svgEl = over.firstElementChild
  if (svgEl) {
    svgEl.style.position = 'absolute'
    svgEl.style.left = `${m.ox + x}px`
    svgEl.style.top = `${m.oy + y}px`
    svgEl.style.width = `${width}px`
    svgEl.style.height = `${height}px`
  }

  fitMarkdownBlocks()

  // Text highlights and the dashed underline of text an arrow points at:
  // painted under the words, the way the editor marks them.
  const marks = []
  for (const el of data.elements) {
    if (el.type === 'highlight' && el.anchor) marks.push([el.anchor, 'hl', highlightCss(el.color)])
    for (const k of ['start', 'end']) if (el[k]?.anchor) marks.push([el[k].anchor, 'ref'])
  }
  under.replaceChildren()
  for (const [anchor, kind, color] of marks) {
    const range = rangeFor(anchor)
    if (!range) continue
    for (const r of range.getClientRects()) {
      if (!r.width) continue
      const d = document.createElement('div')
      d.className = kind === 'hl' ? 'obi-hl' : 'obi-ref'
      d.style.left = `${r.left + window.scrollX}px`
      d.style.top = `${r.top + window.scrollY}px`
      d.style.width = `${r.width}px`
      d.style.height = `${r.height}px`
      if (color) d.style.background = color
      under.append(d)
    }
  }
}

let raf = 0
const schedule = () => {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(render)
}

render()
window.addEventListener('resize', schedule)
window.addEventListener('load', schedule)
document.fonts?.ready.then(schedule)
for (const img of article?.querySelectorAll('img') || []) if (!img.complete) img.addEventListener('load', schedule, { once: true })

// Live updates: the text and the drawings come together, so they never drift
// apart between polls.
const slug = document.body.dataset.slug
if (slug) {
  let last = null
  setInterval(async () => {
    if (document.hidden) return
    try {
      const res = await fetch(`/p/${slug}/data`, { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.text()
      if (last === null) {
        last = body
        return
      }
      if (body === last) return
      last = body
      const next = JSON.parse(body)
      article.innerHTML = next.html
      data = next.canvas
      schedule()
    } catch {}
  }, 8000)
}

// published checkboxes are read-only
document.addEventListener('change', (e) => {
  if (e.target.matches?.('.task-checkbox')) e.target.checked = !e.target.checked
})
