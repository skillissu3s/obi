// Pure geometry for board elements (no DOM) — shared by the canvas, embeds and published pages.

export const LINEAR = new Set(['line', 'arrow', 'pen'])
export const BINDABLE = new Set(['rect', 'ellipse', 'diamond', 'text', 'sticky', 'image', 'note', 'link', 'frame'])

export const isLinear = (el) => LINEAR.has(el.type)

export function absPoints(el) {
  return (el.points || []).map((p) => [el.x + p[0], el.y + p[1], p[2]])
}

// Bounding box of an element in world coordinates.
export function elementBounds(el) {
  if (isLinear(el) && el.points?.length) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of el.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    const pad = el.type === 'pen' ? (el.sw || 2) * (el.tool === 'marker' ? 6 : 2) : 0
    return { x: el.x + minX - pad, y: el.y + minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
  }
  return { x: el.x || 0, y: el.y || 0, w: Math.max(0, el.w || 0), h: Math.max(0, el.h || 0) }
}

export function unionBounds(list) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of list) {
    if (!b) continue
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const center = (b) => [b.x + b.w / 2, b.y + b.h / 2]

// Re-normalise a linear element so x/y is the top-left of its points.
export function normalizeLinear(el) {
  if (!el.points?.length) return el
  let minX = Infinity
  let minY = Infinity
  for (const [px, py] of el.points) {
    minX = Math.min(minX, px)
    minY = Math.min(minY, py)
  }
  let maxX = -Infinity
  let maxY = -Infinity
  const points = el.points.map((p) => {
    const q = [p[0] - minX, p[1] - minY]
    if (p.length > 2) q.push(p[2])
    maxX = Math.max(maxX, q[0])
    maxY = Math.max(maxY, q[1])
    return q
  })
  return { ...el, x: el.x + minX, y: el.y + minY, w: maxX, h: maxY, points }
}

// Where a ray from the shape's centre towards (tx, ty) leaves the shape outline.
export function outlinePoint(shape, b, tx, ty, gap = 0) {
  const [cx, cy] = center(b)
  const dx = tx - cx
  const dy = ty - cy
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const hw = Math.max(b.w / 2, 1)
  const hh = Math.max(b.h / 2, 1)
  let t
  if (shape === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
  else if (shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  else t = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity)
  if (t >= 1) return null // target point is inside the shape
  const ux = dx / len
  const uy = dy / len
  return [cx + dx * t + ux * gap, cy + dy * t + uy * gap]
}

const shapeOf = (type) => (type === 'ellipse' ? 'ellipse' : type === 'diamond' ? 'diamond' : 'rect')

/**
 * Resolve the visible points of an arrow/line whose ends are bound to elements (or text).
 * `target(binding)` returns { shape, x, y, w, h } or null.
 */
export function resolveLinearPoints(el, target) {
  const pts = absPoints(el)
  if (pts.length < 2 || el.type === 'pen') return pts
  const s = el.start ? target(el.start) : null
  const e = el.end ? target(el.end) : null
  if (!s && !e) return pts
  const gap = 5 + (el.sw || 2)
  const out = pts.map((p) => [p[0], p[1]])
  const last = out.length - 1
  if (s) {
    const ref = out.length > 2 ? out[1] : e ? center(e) : out[last]
    const p = outlinePoint(s.shape || 'rect', s, ref[0], ref[1], gap)
    if (p) out[0] = p
    else out[0] = center(s)
  }
  if (e) {
    const ref = out.length > 2 ? out[last - 1] : s ? center(s) : out[0]
    const p = outlinePoint(e.shape || 'rect', e, ref[0], ref[1], gap)
    if (p) out[last] = p
    else out[last] = center(e)
  }
  return out
}

// Standard binding target resolver over an id → element map.
export function elementTarget(byId, bounds = elementBounds) {
  return (binding) => {
    if (!binding?.id) return null
    const t = byId.get(binding.id)
    if (!t || isLinear(t)) return null
    return { shape: shapeOf(t.type), ...bounds(t) }
  }
}

// Catmull-Rom → cubic Bézier through points.
export function smoothPath(points) {
  if (points.length < 3) return polyPath(points)
  let d = `M${f(points[0][0])} ${f(points[0][1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}

export function polyPath(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join(' ')
}

export const f = (n) => Math.round(n * 100) / 100

// Point halfway along a polyline, plus the direction there (for labels).
export function midPoint(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    if (acc + seg >= total / 2 && seg > 0) {
      const t = (total / 2 - acc) / seg
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
    }
    acc += seg
  }
  return points[0] || [0, 0]
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function distToPolyline(px, py, points) {
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distToSegment(px, py, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]))
  if (points.length === 1) best = Math.hypot(px - points[0][0], py - points[0][1])
  return best
}

// Sample a Catmull-Rom curve so hit-testing follows what is drawn.
export function sampleSmooth(points, steps = 8) {
  if (points.length < 3) return points
  const out = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  out.push(points[points.length - 1])
  return out
}

// Ramer–Douglas–Peucker simplification for freehand strokes.
export function simplify(points, tolerance = 0.8) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let idx = -1
    let max = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i][0], points[i][1], points[a][0], points[a][1], points[b][0], points[b][1])
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
}

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}
