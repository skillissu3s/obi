// Resolves where elements actually sit (note anchors, arrow bindings) and hit-tests them.
import {
  elementBounds, resolveLinearPoints, isLinear, distToPolyline, sampleSmooth, midPoint, rectsIntersect, center, BINDABLE, absPoints,
} from '@shared/boardgeom.js'
import { val, penSize, FONTS, fontScale, lineHeight, cornerRadius } from '@shared/boardsvg.js'

const shapeOf = (type) => (type === 'ellipse' ? 'ellipse' : type === 'diamond' ? 'diamond' : 'rect')

const resolvedCache = new WeakMap()

/**
 * ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
 * The published page runs this very function (client/src/publish/main.js), so
 * a change here changes both — keep it a pure function of snapshot + env.
 *
 * env (note mode only):
 *   lineTop(anchor) -> world y of the anchored line, or null
 *   textRect(anchor) -> { x, y, w, h } in world space, or null
 *   version -> changes whenever anchors may have moved
 */
export function resolveLayout(snapshot, env = null) {
  const list = []
  const byId = new Map()
  for (const el of snapshot.list) {
    if (el.type === 'highlight') continue
    let r = el
    if (env && el.anchor) {
      const top = env.lineTop(el.anchor)
      if (top != null) {
        const y = Math.round((top + (el.dy || 0)) * 100) / 100
        if (y !== el.y) r = cached(el, `y${y}`, () => ({ ...el, y, _src: el }))
      }
    }
    list.push(r)
    byId.set(el.id, r)
  }
  const target = (b) => {
    if (!b) return null
    if (b.id) {
      const t = byId.get(b.id)
      if (!t || isLinear(t)) return null
      return { shape: shapeOf(t.type), ...elementBounds(t) }
    }
    if (b.anchor && env?.textRect) {
      const rect = env.textRect(b.anchor)
      return rect ? { shape: 'rect', ...rect, text: true } : null
    }
    return null
  }
  for (let i = 0; i < list.length; i++) {
    const el = list[i]
    if ((el.type !== 'arrow' && el.type !== 'line') || (!el.start && !el.end)) continue
    const pts = resolveLinearPoints(el, target)
    const sig = pts.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(' ')
    const base = el._src || el
    const r = cached(base, `p${el.y}|${sig}`, () => ({ ...el, _src: base, _pts: pts }))
    list[i] = r
    byId.set(el.id, r)
  }
  return { list, byId, target }
}

// keep object identity stable while nothing changed so React.memo can skip work
function cached(el, key, make) {
  const hit = resolvedCache.get(el)
  if (hit && hit.key === key) return hit.value
  const value = make()
  resolvedCache.set(el, { key, value })
  return value
}

export const source = (el) => el._src || el

export function visiblePoints(el) {
  return el._pts || absPoints(el)
}

// ---------------- hit testing ----------------

const FILLED = new Set(['text', 'sticky', 'image', 'note', 'link'])

function insideShape(el, x, y) {
  const b = elementBounds(el)
  if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return false
  const [cx, cy] = center(b)
  const hw = b.w / 2 || 1
  const hh = b.h / 2 || 1
  if (el.type === 'ellipse') return ((x - cx) / hw) ** 2 + ((y - cy) / hh) ** 2 <= 1
  if (el.type === 'diamond') return Math.abs(x - cx) / hw + Math.abs(y - cy) / hh <= 1
  return true
}

function nearOutline(el, x, y, tol) {
  const b = elementBounds(el)
  if (x < b.x - tol || y < b.y - tol || x > b.x + b.w + tol || y > b.y + b.h + tol) return false
  const [cx, cy] = center(b)
  const hw = b.w / 2 || 1
  const hh = b.h / 2 || 1
  if (el.type === 'ellipse') {
    const d = Math.sqrt(((x - cx) / hw) ** 2 + ((y - cy) / hh) ** 2)
    return Math.abs(d - 1) * Math.min(hw, hh) <= tol
  }
  if (el.type === 'diamond') {
    const d = Math.abs(x - cx) / hw + Math.abs(y - cy) / hh
    return Math.abs(d - 1) * Math.min(hw, hh) <= tol
  }
  const r = cornerRadius(el)
  const dx = Math.min(Math.abs(x - b.x), Math.abs(x - b.x - b.w))
  const dy = Math.min(Math.abs(y - b.y), Math.abs(y - b.y - b.h))
  const inX = x >= b.x - tol && x <= b.x + b.w + tol
  const inY = y >= b.y - tol && y <= b.y + b.h + tol
  void r
  return (dx <= tol && inY) || (dy <= tol && inX)
}

/**
 * Topmost element under the point. Hollow shapes are hit on their outline or label;
 * clicking inside one only selects it when nothing else is there (the smallest wins).
 */
export function hitTest(layout, x, y, { tol = 6, includeLocked = true, skip = null, hollowInside = true } = {}) {
  let hollowHit = null
  for (let i = layout.list.length - 1; i >= 0; i--) {
    const el = layout.list[i]
    if (skip?.has(el.id)) continue
    if (el.locked && !includeLocked) continue
    if (hitsElement(el, x, y, tol)) return el
    if (hollowInside && (el.type === 'rect' || el.type === 'ellipse' || el.type === 'diamond' || el.type === 'frame') && insideShape(el, x, y)) {
      const b = elementBounds(el)
      if (!hollowHit || b.w * b.h < hollowHit.area) hollowHit = { el, area: b.w * b.h }
    }
  }
  return hollowHit?.el || null
}

export function hitsElement(el, x, y, tol = 6) {
  switch (el.type) {
    case 'rect':
    case 'ellipse':
    case 'diamond': {
      const filled = el.fill && el.fill !== 'none'
      if (filled || el.text) {
        if (insideShape(el, x, y)) return !!filled || nearLabel(el, x, y)
      }
      return nearOutline(el, x, y, tol + val(el, 'sw') / 2)
    }
    case 'frame': {
      const b = elementBounds(el)
      // the title strip above the frame, or its border
      if (x >= b.x && x <= b.x + Math.max(80, (el.name || 'Frame').length * 8) && y >= b.y - 24 && y <= b.y) return true
      return nearOutline(el, x, y, tol)
    }
    case 'line':
    case 'arrow': {
      const pts = visiblePoints(el)
      const trace = el.curve && pts.length > 2 ? sampleSmooth(pts, 8) : pts
      if (distToPolyline(x, y, trace) <= tol + val(el, 'sw')) return true
      if (el.text) {
        const [mx, my] = midPoint(pts)
        const fs = val(el, 'fs')
        const w = Math.max(30, el.text.length * fs * 0.55)
        return Math.abs(x - mx) <= w / 2 && Math.abs(y - my) <= fs
      }
      return false
    }
    case 'pen': {
      const pts = absPoints(el)
      return distToPolyline(x, y, pts) <= tol + penSize(el) / 2
    }
    default:
      if (FILLED.has(el.type)) {
        const b = elementBounds(el)
        return x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h
      }
      return false
  }
}

function nearLabel(el, x, y) {
  const [cx, cy] = center(elementBounds(el))
  const fs = val(el, 'fs')
  const lines = String(el.text).split('\n')
  const w = Math.min(el.w, Math.max(...lines.map((l) => l.length)) * fs * 0.6 + 16)
  const h = Math.min(el.h, lines.length * fs * 1.4 + 12)
  return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2
}

// Elements touched by a marquee (fully contained, like most canvas apps).
export function inMarquee(layout, rect) {
  const out = []
  for (const el of layout.list) {
    const b = visualBounds(el)
    if (b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h) out.push(el)
  }
  return out
}

export function boundsOfPts(pts) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [px, py] of pts) {
    minX = Math.min(minX, px)
    minY = Math.min(minY, py)
    maxX = Math.max(maxX, px)
    maxY = Math.max(maxY, py)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Bounds of what is drawn (resolved arrow ends included).
export function visualBounds(el) {
  return el._pts ? boundsOfPts(el._pts) : elementBounds(el)
}

// Anything the eraser path passes over.
export function erasedBy(layout, x, y, tol) {
  const out = []
  for (const el of layout.list) {
    if (el.locked) continue
    if (hitsElement(el, x, y, tol)) out.push(el.id)
  }
  return out
}

// Bindable element under a point (for arrow ends).
export function bindTargetAt(layout, x, y, skipId) {
  for (let i = layout.list.length - 1; i >= 0; i--) {
    const el = layout.list[i]
    if (el.id === skipId || !BINDABLE.has(el.type)) continue
    const b = elementBounds(el)
    const pad = 10
    if (x >= b.x - pad && y >= b.y - pad && x <= b.x + b.w + pad && y <= b.y + b.h + pad) {
      if (el.type === 'frame' && x > b.x + 8 && y > b.y + 8 && x < b.x + b.w - 8 && y < b.y + b.h - 8) continue
      return el
    }
  }
  return null
}

export function elementsInRect(layout, rect) {
  return layout.list.filter((el) => rectsIntersect(visualBounds(el), rect))
}

// ---------------- text measuring ----------------

let measurer = null
// Markdown text blocks are measured from the rendered HTML, since a heading or
// a list takes a different amount of room than the source line it came from.
let mdMeasurer = null
export function measureMarkdown(html, { font = 'sans', fs = 16, width = 320, family = null } = {}) {
  if (!mdMeasurer) {
    mdMeasurer = document.createElement('div')
    mdMeasurer.className = 'cv-md'
    mdMeasurer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none'
    document.body.appendChild(mdMeasurer)
  }
  mdMeasurer.style.fontFamily = family || FONTS[font] || FONTS.sans
  // ⚠ LAYOUT CONTRACT: markdown blocks use the editor font, so no hand-font
  // size boost and the sans line-height — as ElementView and boardsvg do
  void font
  mdMeasurer.style.fontSize = `${fs}px`
  mdMeasurer.style.lineHeight = String(lineHeight('sans'))
  mdMeasurer.style.width = `${Math.max(40, width)}px`
  mdMeasurer.innerHTML = html || '<p></p>'
  // a couple of pixels of slack so a descender or a border never gets clipped
  return { w: Math.ceil(mdMeasurer.offsetWidth), h: Math.max(24, Math.ceil(mdMeasurer.offsetHeight) + 4) }
}

export function measureText(text, { font = 'hand', fs = 20, width = null, padding = 0 } = {}) {
  if (!measurer) {
    measurer = document.createElement('div')
    measurer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none'
    document.body.appendChild(measurer)
  }
  const size = fs * fontScale(font)
  measurer.style.fontFamily = FONTS[font] || FONTS.sans
  measurer.style.fontSize = `${size}px`
  measurer.style.lineHeight = String(lineHeight(font))
  measurer.style.padding = `${padding}px`
  measurer.style.width = width ? `${width}px` : 'auto'
  measurer.style.whiteSpace = width ? 'pre-wrap' : 'pre'
  measurer.textContent = (text || ' ') + (String(text).endsWith('\n') ? ' ' : '')
  return { w: Math.ceil(measurer.offsetWidth) + 2, h: Math.ceil(measurer.offsetHeight) }
}
