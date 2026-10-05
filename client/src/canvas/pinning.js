// Which drawings on a note move together when its text changes.
//
// Every drawing is pinned to a line of text (its anchor) at an offset (dy). If
// the pieces of one picture were pinned each to the line beside its own top, a
// new line typed between them would pull the picture apart: the arrow's shaft
// stays, its head moves down with the box below. So drawings that touch — their
// outlines within TOUCH of each other, or an arrow bound to a shape — form a
// group, and the whole group is pinned to the line at its top. Text added beside
// a group then moves all of it or none of it.
//
// This only decides what to store (anchor and dy, as always); where a pinned
// drawing is drawn is still resolveLayout's business, on the published page too.
import { isLinear, absPoints, distToPolyline, sampleSmooth, rectsIntersect } from '@shared/boardgeom.js'
import { visualBounds, visiblePoints } from './layout.js'

export const TOUCH = 12 // world px

const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })

// the line as drawn, as points close enough together to test against
function trace(el) {
  if (!isLinear(el)) return null
  let pts = el.type === 'pen' ? absPoints(el) : visiblePoints(el)
  if (el.curve && pts.length > 2) pts = sampleSmooth(pts, 8)
  const out = []
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i])
    const next = pts[i + 1]
    if (!next) break
    const steps = Math.min(64, Math.floor(Math.hypot(next[0] - pts[i][0], next[1] - pts[i][1]) / 6))
    for (let k = 1; k < steps; k++) out.push([pts[i][0] + ((next[0] - pts[i][0]) * k) / steps, pts[i][1] + ((next[1] - pts[i][1]) * k) / steps])
  }
  return out
}

const nearBox = (pts, b) => pts.some(([x, y]) => x >= b.x - TOUCH && x <= b.x + b.w + TOUCH && y >= b.y - TOUCH && y <= b.y + b.h + TOUCH)

/** Whether two resolved elements touch */
const boundTo = (line, el) => line.start?.id === el.id || line.end?.id === el.id

export function touches(a, b, cache = new Map()) {
  if (boundTo(a, b) || boundTo(b, a)) return true
  const ba = visualBounds(a)
  const bb = visualBounds(b)
  if (!rectsIntersect(grow(ba, TOUCH), bb)) return false
  const ta = cache.has(a) ? cache.get(a) : cache.set(a, trace(a)).get(a)
  const tb = cache.has(b) ? cache.get(b) : cache.set(b, trace(b)).get(b)
  if (!ta && !tb) return true // two boxes whose edges are within reach
  if (ta && tb) return ta.some(([x, y]) => distToPolyline(x, y, tb) <= TOUCH)
  return ta ? nearBox(ta, bb) : nearBox(tb, ba)
}

/**
 * The groups of touching elements that hold the elements `ids`, from a resolved
 * layout: an array of arrays of resolved elements. Highlights (in the text) and
 * elements not in the layout take no part.
 */
export function touchingGroups(layout, ids) {
  const all = layout.list.filter((el) => el.type !== 'highlight')
  const cache = new Map()
  const seen = new Set()
  const groups = []
  for (const id of ids) {
    const seed = layout.byId.get(id)
    if (!seed || seen.has(seed.id)) continue
    const group = [seed]
    seen.add(seed.id)
    for (let i = 0; i < group.length; i++) {
      for (const el of all) {
        if (seen.has(el.id) || !touches(group[i], el, cache)) continue
        seen.add(el.id)
        group.push(el)
      }
    }
    groups.push(group)
  }
  return groups
}
