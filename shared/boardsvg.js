// Turns board elements into SVG paths. Used by the live canvas (per element),
// by note/board embeds and by published pages (whole board as one SVG string).
import rough from 'roughjs'
import { getStroke } from 'perfect-freehand'
import { absPoints, elementBounds, elementTarget, resolveLinearPoints, smoothPath, polyPath, sampleSmooth, midPoint, unionBounds, isLinear, f } from './boardgeom.js'

const gen = rough.generator()

export const STROKE_COLORS = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink']
export const STICKY_COLORS = ['yellow', 'orange', 'pink', 'violet', 'blue', 'teal', 'green', 'gray']
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'violet', 'orange']

export const DEFAULTS = {
  stroke: 'ink',
  fill: 'none',
  fillStyle: 'hachure',
  sw: 2,
  dash: 'solid',
  rough: 1,
  round: true,
  opacity: 100,
  font: 'hand',
  fs: 20,
  align: 'center',
  color: 'yellow',
}

// style values from a file are untrusted: numeric ones are always coerced to numbers
export const val = (el, k) => {
  const v = el[k] ?? DEFAULTS[k]
  if (typeof DEFAULTS[k] !== 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : DEFAULTS[k]
}
const ALIGNS = new Set(['left', 'center', 'right'])

const HEX = /^#[0-9a-f]{3,8}$/i
export function colorCss(c) {
  if (!c || c === 'ink') return 'var(--cv-ink)'
  if (c === 'none') return 'none'
  if (HEX.test(c)) return c
  return STROKE_COLORS.includes(c) ? `var(--cv-${c})` : 'var(--cv-ink)'
}
export function fillCss(c) {
  if (!c || c === 'none') return 'none'
  if (HEX.test(c)) return c
  return STROKE_COLORS.includes(c) ? `var(--cv-${c}-fill)` : 'none'
}
export const stickyCss = (c) => `var(--cv-sticky-${STICKY_COLORS.includes(c) ? c : 'yellow'})`
export const highlightCss = (c) => `var(--cv-hl-${HIGHLIGHT_COLORS.includes(c) ? c : 'yellow'})`

export const FONTS = {
  hand: "'Caveat Variable', Caveat, 'Segoe Print', 'Comic Sans MS', cursive",
  sans: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
}
// Caveat runs small; scale it so sizes feel equal across fonts
export const fontScale = (font) => (font === 'hand' ? 1.25 : 1)
export const lineHeight = (font) => (font === 'hand' ? 1.2 : 1.35)

export function dashArray(dash, sw) {
  if (dash === 'dashed') return `${f(sw * 4 + 2)} ${f(sw * 3 + 2)}`
  if (dash === 'dotted') return `0.1 ${f(sw * 2.5 + 1.5)}`
  return null
}

function roughOptions(el, extra = {}) {
  const r = val(el, 'rough')
  const sw = val(el, 'sw')
  return {
    seed: el.seed || 1,
    roughness: r >= 2 ? 2.6 : r >= 1 ? 1.1 : 0,
    bowing: r >= 2 ? 2.2 : 1,
    strokeWidth: sw,
    stroke: 'currentColor',
    fillWeight: Math.max(0.6, sw / 2),
    hachureGap: sw * 4 + 2,
    preserveVertices: r < 2,
    disableMultiStroke: r === 0,
    ...extra,
  }
}

function fromRough(drawable, el) {
  const sw = val(el, 'sw')
  const stroke = colorCss(el.stroke)
  const fill = el.fill && el.fill !== 'none' ? el.fill : null
  const dash = dashArray(val(el, 'dash'), sw)
  return drawable.sets.map((set) => {
    const d = gen.opsToPath(set, 2)
    if (set.type === 'path') return { d, stroke, fill: 'none', sw, dash }
    if (set.type === 'fillPath') return { d, stroke: 'none', fill: fillCss(fill) }
    return { d, stroke: colorCss(fill), fill: 'none', sw: Math.max(0.6, sw / 2), soft: true }
  })
}

export function roundRectPath(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  if (!r) return `M0 0H${f(w)}V${f(h)}H0Z`
  return `M${f(r)} 0H${f(w - r)}Q${f(w)} 0 ${f(w)} ${f(r)}V${f(h - r)}Q${f(w)} ${f(h)} ${f(w - r)} ${f(h)}H${f(r)}Q0 ${f(h)} 0 ${f(h - r)}V${f(r)}Q0 0 ${f(r)} 0Z`
}

function diamondPath(w, h, round) {
  if (!round) return `M${f(w / 2)} 0L${f(w)} ${f(h / 2)}L${f(w / 2)} ${f(h)}L0 ${f(h / 2)}Z`
  const c = Math.min(12, Math.min(w, h) * 0.12)
  const pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]
  let d = ''
  for (let i = 0; i < 4; i++) {
    const p = pts[i]
    const prev = pts[(i + 3) % 4]
    const next = pts[(i + 1) % 4]
    const lp = Math.hypot(prev[0] - p[0], prev[1] - p[1]) || 1
    const ln = Math.hypot(next[0] - p[0], next[1] - p[1]) || 1
    const a = [p[0] + ((prev[0] - p[0]) / lp) * c, p[1] + ((prev[1] - p[1]) / lp) * c]
    const b = [p[0] + ((next[0] - p[0]) / ln) * c, p[1] + ((next[1] - p[1]) / ln) * c]
    d += `${i ? 'L' : 'M'}${f(a[0])} ${f(a[1])}Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])}`
  }
  return d + 'Z'
}

const ellipsePath = (w, h) => `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)}Z`

export const cornerRadius = (el) => (val(el, 'round') ? Math.min(14, Math.min(el.w, el.h) * 0.22) : 0)

// Closed shapes, in local coordinates (0,0 = element top-left).
function shapeDrawables(el) {
  const w = Math.max(1, el.w || 1)
  const h = Math.max(1, el.h || 1)
  const r = val(el, 'rough')
  const sw = val(el, 'sw')
  const fill = el.fill && el.fill !== 'none' ? el.fill : null
  const fillStyle = r ? val(el, 'fillStyle') : el.fillStyle && el.fillStyle !== 'solid' ? el.fillStyle : 'solid'
  const d = el.type === 'ellipse' ? ellipsePath(w, h) : el.type === 'diamond' ? diamondPath(w, h, val(el, 'round')) : roundRectPath(w, h, cornerRadius(el))
  if (r === 0) {
    const out = []
    if (fill && fillStyle !== 'solid') {
      const sketch = gen.path(d, { ...roughOptions(el), roughness: 0, fill: 'currentColor', fillStyle: fillStyle === 'cross' ? 'cross-hatch' : fillStyle, stroke: 'none' })
      out.push(...fromRough(sketch, el).filter((p) => p.soft))
    }
    out.push({ d, stroke: colorCss(el.stroke), fill: fill && fillStyle === 'solid' ? fillCss(fill) : 'none', sw, dash: dashArray(val(el, 'dash'), sw), join: 'round' })
    return out
  }
  const opts = roughOptions(el, fill ? { fill: 'currentColor', fillStyle: fillStyle === 'cross' ? 'cross-hatch' : fillStyle } : {})
  let drawable
  if (el.type === 'ellipse') drawable = gen.ellipse(w / 2, h / 2, w, h, opts)
  else if (el.type === 'diamond') drawable = val(el, 'round') ? gen.path(d, opts) : gen.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], opts)
  else drawable = val(el, 'round') ? gen.path(d, opts) : gen.rectangle(0, 0, w, h, opts)
  return fromRough(drawable, el)
}

function headDrawables(kind, tip, from, el, stroke) {
  if (!kind || kind === 'none') return []
  const sw = val(el, 'sw')
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  const seg = Math.hypot(tip[0] - from[0], tip[1] - from[1])
  const len = Math.min(Math.max(10, sw * 4 + 8), Math.max(6, seg * 0.6))
  if (kind === 'dot') {
    const rr = sw * 1.5 + 2.5
    return [{ d: `M${f(tip[0] - rr)} ${f(tip[1])}a${f(rr)} ${f(rr)} 0 1 0 ${f(rr * 2)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-rr * 2)} 0Z`, fill: stroke, stroke: 'none' }]
  }
  if (kind === 'bar') {
    const px = Math.cos(ang + Math.PI / 2) * len * 0.55
    const py = Math.sin(ang + Math.PI / 2) * len * 0.55
    return [{ d: `M${f(tip[0] - px)} ${f(tip[1] - py)}L${f(tip[0] + px)} ${f(tip[1] + py)}`, stroke, fill: 'none', sw, cap: 'round' }]
  }
  const spread = kind === 'triangle' ? 0.42 : 0.47
  const a = [tip[0] - Math.cos(ang - spread) * len, tip[1] - Math.sin(ang - spread) * len]
  const b = [tip[0] - Math.cos(ang + spread) * len, tip[1] - Math.sin(ang + spread) * len]
  if (kind === 'triangle') return [{ d: `M${f(tip[0])} ${f(tip[1])}L${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}Z`, fill: stroke, stroke, sw: Math.max(1, sw / 2), join: 'round' }]
  if (val(el, 'rough')) {
    const opts = roughOptions(el, { roughness: 0.6, bowing: 0.5 })
    return fromRough(gen.linearPath([a, tip, b], opts), { ...el, dash: 'solid' })
  }
  return [{ d: `M${f(a[0])} ${f(a[1])}L${f(tip[0])} ${f(tip[1])}L${f(b[0])} ${f(b[1])}`, stroke, fill: 'none', sw, cap: 'round', join: 'round' }]
}

export const heads = (el) => [el.heads?.[0] ?? 'none', el.heads?.[1] ?? (el.type === 'arrow' ? 'arrow' : 'none')]

// Lines and arrows; `pts` are local points (already resolved for bindings).
function linearDrawables(el, pts) {
  if (!pts || pts.length < 2) return []
  const sw = val(el, 'sw')
  const stroke = colorCss(el.stroke)
  const out = []
  if (val(el, 'rough')) {
    const opts = roughOptions(el)
    const drawable = el.curve && pts.length > 2 ? gen.curve(pts, opts) : gen.linearPath(pts, opts)
    out.push(...fromRough(drawable, el))
  } else {
    out.push({ d: el.curve ? smoothPath(pts) : polyPath(pts), stroke, fill: 'none', sw, dash: dashArray(val(el, 'dash'), sw), cap: 'round', join: 'round' })
  }
  const trace = el.curve && pts.length > 2 ? sampleSmooth(pts, 10) : pts
  const [h0, h1] = heads(el)
  const n = trace.length
  if (h0 !== 'none') out.push(...headDrawables(h0, trace[0], backPoint(trace, 0, 1), el, stroke))
  if (h1 !== 'none') out.push(...headDrawables(h1, trace[n - 1], backPoint(trace, n - 1, -1), el, stroke))
  return out
}

// a point a little way back along the line, so heads follow curves nicely
function backPoint(trace, from, dir) {
  const tip = trace[from]
  let i = from + dir
  while (i >= 0 && i < trace.length) {
    if (Math.hypot(trace[i][0] - tip[0], trace[i][1] - tip[1]) > 12) return trace[i]
    i += dir
  }
  return trace[from + dir] || trace[from]
}

const avg = (a, b) => (a + b) / 2
function strokeToPath(points) {
  const len = points.length
  if (len < 4) return ''
  let a = points[0]
  let b = points[1]
  const c = points[2]
  let d = `M${f(a[0])},${f(a[1])} Q${f(b[0])},${f(b[1])} ${f(avg(b[0], c[0]))},${f(avg(b[1], c[1]))} T`
  for (let i = 2; i < len - 1; i++) {
    a = points[i]
    b = points[i + 1]
    d += `${f(avg(a[0], b[0]))},${f(avg(a[1], b[1]))} `
  }
  return d + 'Z'
}

export function penSize(el) {
  const sw = val(el, 'sw')
  return el.tool === 'marker' ? sw * 5 + 8 : sw * 1.5 + 2
}

function penDrawables(el) {
  const pts = el.points || []
  if (!pts.length) return []
  const marker = el.tool === 'marker'
  const pressure = pts.some((p) => p[2] != null && p[2] !== 0.5)
  const outline = getStroke(
    pts.map((p) => [p[0], p[1], p[2] ?? 0.5]),
    {
      size: penSize(el),
      thinning: marker ? 0 : 0.55,
      smoothing: 0.6,
      streamline: 0.45,
      simulatePressure: !pressure && !marker,
      last: true,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
    },
  )
  return [{ d: strokeToPath(outline), fill: colorCss(el.stroke), stroke: 'none', opacity: marker ? 0.4 : undefined }]
}

// Everything drawable for an element, in local coordinates. `pts` = resolved absolute points (linear only).
export function drawables(el, pts) {
  switch (el.type) {
    case 'rect':
    case 'ellipse':
    case 'diamond':
      return shapeDrawables(el)
    case 'line':
    case 'arrow':
      return linearDrawables(el, (pts || absPoints(el)).map((p) => [p[0] - el.x, p[1] - el.y]))
    case 'pen':
      return penDrawables(el)
    default:
      return []
  }
}

// ---------------- static SVG (embeds, published pages) ----------------

const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function pathSvg(p) {
  const attrs = [`d="${p.d}"`]
  const style = [`fill:${p.fill || 'none'}`, `stroke:${p.stroke || 'none'}`]
  if (p.sw) style.push(`stroke-width:${num(p.sw, 1)}`)
  if (p.dash) style.push(`stroke-dasharray:${p.dash}`)
  if (p.cap) style.push(`stroke-linecap:${p.cap}`)
  else if (p.dash) style.push('stroke-linecap:round')
  if (p.join) style.push(`stroke-linejoin:${p.join}`)
  if (p.opacity != null) style.push(`opacity:${p.opacity}`)
  attrs.push(`style="${esc(style.join(';'))}"`)
  return `<path ${attrs.join(' ')}/>`
}

// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
// How text sits inside an element when exported or published; it must match
// how ElementView draws it on the canvas (font, size, line-height, alignment).
function textBlock(el, w, h, { color, padding = 0, valign = 'top', bg = null, extra = '', innerStyle = '', html = null } = {}) {
  const font = val(el, 'font')
  // a markdown block (html) is set in the editor font: no hand-font boost
  const fs = num(val(el, 'fs'), DEFAULTS.fs) * (html != null ? 1 : fontScale(font))
  const style = [
    `width:${f(w)}px`,
    `height:${f(h)}px`,
    'box-sizing:border-box',
    `padding:${padding}px`,
    `font-family:${html != null ? 'var(--font-editor)' : FONTS[font] || FONTS.sans}`,
    `font-size:${f(fs)}px`,
    `line-height:${html != null ? lineHeight('sans') : lineHeight(font)}`,
    `color:${color}`,
    // a free text block reads from the left unless told otherwise, as the
    // canvas draws it (textStyle in ElementView); labels in shapes centre
    `text-align:${ALIGNS.has(el.align) ? el.align : el.type === 'text' ? 'left' : DEFAULTS.align}`,
    // rendered markdown is HTML, where the newlines between tags are just
    // whitespace — keeping pre-wrap turns each of them into a blank line
    html != null ? 'white-space:normal' : 'white-space:pre-wrap',
    'overflow-wrap:anywhere',
    'overflow:hidden',
    'display:flex',
    'flex-direction:column',
    `justify-content:${valign === 'middle' ? 'center' : 'flex-start'}`,
    bg ? `background:${bg}` : '',
    extra,
  ].filter(Boolean)
  // innerStyle puts a patch behind the words themselves, not the whole box
  const inner = innerStyle ? ` style="${esc(innerStyle)}"` : ''
  const content = html != null ? `<div xmlns="http://www.w3.org/1999/xhtml" class="cv-md">${html}</div>` : `<div${inner}>${esc(el.text)}</div>`
  return `<foreignObject x="0" y="0" width="${f(w)}" height="${f(h)}"><div xmlns="http://www.w3.org/1999/xhtml" style="${esc(style.join(';'))}">${content}</div></foreignObject>`
}

const basenameOf = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '')

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Render a whole board to an SVG string.
 * opts: { fileUrl(path) -> url|null, padding, maxHeight, title }
 */
export function boardToSvg(elements, opts = {}) {
  const padding = opts.padding ?? 24
  const list = elements.filter((e) => e.type !== 'highlight' && (opts.position || !e.anchor)).sort((a, b) => (a.z || 0) - (b.z || 0))
  const byId = new Map(list.map((e) => [e.id, e]))
  const target = elementTarget(byId)
  const resolved = new Map()
  for (const el of list) if (el.type === 'line' || el.type === 'arrow') resolved.set(el.id, resolveLinearPoints(el, target))
  const bounds = unionBounds(
    list.map((el) => {
      const pts = resolved.get(el.id)
      if (pts) return unionBounds([elementBounds(el), unionBounds(pts.map((p) => ({ x: p[0], y: p[1], w: 0, h: 0 })))])
      return el.type === 'frame' ? { ...elementBounds(el), y: el.y - 26, h: el.h + 26 } : elementBounds(el)
    }),
  )
  if (!bounds) return { svg: '', width: 0, height: 0, empty: true }
  const vx = bounds.x - padding
  const vy = bounds.y - padding
  const vw = bounds.w + padding * 2
  const vh = bounds.h + padding * 2
  const parts = []
  for (const el of list) {
    const op = Math.max(0, Math.min(1, num(val(el, 'opacity'), 100) / 100))
    const open = `<g transform="translate(${f(el.x)} ${f(el.y)})"${op < 1 ? ` opacity="${op}"` : ''}>`
    const body = []
    switch (el.type) {
      case 'rect':
      case 'ellipse':
      case 'diamond':
        body.push(...drawables(el).map(pathSvg))
        if (el.text) {
          // a hatched fill would otherwise run straight through the letters
          const patterned = el.fill && (el.fillStyle ?? DEFAULTS.fillStyle) !== 'solid'
          body.push(
            textBlock(el, el.w, el.h, {
              color: colorCss(el.stroke),
              padding: 10,
              valign: 'middle',
              innerStyle: patterned ? 'background:var(--cv-bg);border-radius:4px;padding:1px 6px' : '',
            }),
          )
        }
        break
      case 'line':
      case 'arrow': {
        const pts = resolved.get(el.id)
        body.push(...drawables(el, pts).map(pathSvg))
        if (el.text) {
          const [mx, my] = midPoint(pts.map((p) => [p[0] - el.x, p[1] - el.y]))
          const w = Math.min(260, Math.max(60, el.text.length * val(el, 'fs') * 0.6))
          const h = val(el, 'fs') * 2
          body.push(`<g transform="translate(${f(mx - w / 2)} ${f(my - h / 2)})">${textBlock({ ...el, align: 'center' }, w, h, { color: colorCss(el.stroke), valign: 'middle', extra: 'text-shadow:0 0 4px var(--cv-bg),0 0 2px var(--cv-bg)' })}</g>`)
        }
        break
      }
      case 'pen':
        body.push(...drawables(el).map(pathSvg))
        break
      case 'text':
        // a markdown block exports as the formatting it means, when the caller
        // hands us a renderer (published pages and exports both do)
        body.push(textBlock(el, el.w, el.h, { color: colorCss(el.stroke), html: el.md ? opts.renderMarkdown?.(el.text || '', el) : null }))
        break
      case 'sticky':
        body.push(`<rect x="1" y="3" width="${f(el.w)}" height="${f(el.h)}" rx="4" style="fill:rgba(0,0,0,.18)"/>`)
        body.push(textBlock({ ...el, align: el.align || 'left', font: el.font || 'hand' }, el.w, el.h, { color: '#23201a', padding: 14, bg: stickyCss(el.color), extra: 'border-radius:4px' }))
        break
      case 'image': {
        const url = opts.fileUrl?.(el.src)
        if (url) body.push(`<image href="${esc(url)}" x="0" y="0" width="${f(el.w)}" height="${f(el.h)}" preserveAspectRatio="xMidYMid slice"/>`)
        else body.push(`<rect width="${f(el.w)}" height="${f(el.h)}" rx="6" style="fill:var(--cv-gray-fill);stroke:var(--cv-gray)"/>`)
        break
      }
      case 'note':
        body.push(`<rect width="${f(el.w)}" height="${f(el.h)}" rx="10" style="fill:var(--cv-card);stroke:var(--cv-card-border)"/>`)
        body.push(textBlock({ text: `📄 ${basenameOf(el.path)}`, font: 'sans', fs: 15, align: 'left' }, el.w, el.h, { color: 'var(--cv-ink)', padding: 14 }))
        break
      case 'link':
        body.push(`<rect width="${f(el.w)}" height="${f(el.h)}" rx="10" style="fill:var(--cv-card);stroke:var(--cv-card-border)"/>`)
        body.push(textBlock({ text: `🔗 ${el.name || hostOf(el.url)}\n${el.url || ''}`, font: 'sans', fs: 13, align: 'left' }, el.w, el.h, { color: 'var(--cv-ink)', padding: 12 }))
        break
      case 'frame':
        body.push(`<rect width="${f(el.w)}" height="${f(el.h)}" rx="12" style="fill:var(--cv-frame);stroke:var(--cv-card-border)"/>`)
        body.push(`<text x="4" y="-9" style="font:600 13px ${FONTS.sans};fill:var(--cv-gray)">${esc(el.name || 'Frame')}</text>`)
        break
      default:
        continue
    }
    parts.push(open + body.join('') + '</g>')
  }
  let width = vw
  let height = vh
  if (opts.maxHeight && height > opts.maxHeight) {
    width = (width * opts.maxHeight) / height
    height = opts.maxHeight
  }
  // `position` keeps the drawing at its own size: the caller places it in the
  // page itself (a note's canvas layer), rather than fitting it to a column.
  const style = opts.position ? 'display:block' : 'max-width:100%;height:auto'
  // Markdown blocks carry their own compact rules so an exported file or a
  // published page shows them the way the canvas does.
  const mdStyle = parts.some((p) => p.includes('class="cv-md"'))
    ? `<style>.cv-md{overflow-wrap:anywhere}.cv-md>*:first-child{margin-top:0}.cv-md>*:last-child{margin-bottom:0}.cv-md p,.cv-md ul,.cv-md ol,.cv-md blockquote,.cv-md pre{margin:.4em 0}.cv-md h1,.cv-md h2,.cv-md h3,.cv-md h4{margin:.5em 0 .25em;line-height:1.25}.cv-md h1{font-size:1.5em}.cv-md h2{font-size:1.28em}.cv-md h3{font-size:1.12em}.cv-md ul,.cv-md ol{padding-left:1.3em}.cv-md code{font-family:ui-monospace,monospace;font-size:.88em}.cv-md blockquote{border-left:2px solid currentColor;opacity:.85;padding-left:.7em}</style>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="board-svg" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" width="${f(width)}" height="${f(height)}" style="${style}">${opts.title ? `<title>${esc(opts.title)}</title>` : ''}${mdStyle}${parts.join('')}</svg>`
  return { svg, width: vw, height: vh, x: vx, y: vy, empty: false }
}

export { isLinear }
