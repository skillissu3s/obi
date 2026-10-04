// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLinear, sampleSmooth } from './boardgeom.js'

// A phrase on one row of text, in a column from x = 0 to x = 620. ga and gb are
// the middles of the free bands above and below the row.
const text = { shape: 'rect', text: true, x: 100, y: 200, w: 120, h: 19, ga: 195, gb: 224, col: [0, 620] }
const sticky = (x, y) => ({ shape: 'rect', x, y, w: 200, h: 150 })
const arrow = (extra = {}) => ({ type: 'arrow', x: 0, y: 0, sw: 1, points: [[0, 0], [1, 1]], start: { anchor: 1 }, end: { id: 's' }, ...extra })
const resolve = (el, t, s) => resolveLinear(el, (b) => (b.anchor ? t : s))
const inRow = ([x, y]) => y > 200 && y < 219 && x > 100 && x < 620
// how far along the gap the line runs: the last of the points on it
const runEnd = (points, gy) => Math.max(...points.filter((p) => p[1] === gy).map((p) => p[0]))

// Rows of text 24px apart, 19px tall; rights[r] is where the words of row r end
// and lefts[r] where they start (at x = 0, the edge of the column, unless said
// otherwise). reach is what the editor and the published page measure: the
// words on the rows next to a gap and on those down to the target, as far as
// they go, however far past the column that is.
const LH = 24
const rowTop = (r) => 200 + LH * r
const reachOf = (rights, lefts = []) => (from, to) => {
  const lo = Math.min(from - LH, to)
  const hi = Math.max(from + LH, to)
  const hit = rights.map((right, r) => [lefts[r] ?? 0, right, r]).filter(([, , r]) => rowTop(r) + 9.5 >= lo && rowTop(r) + 9.5 <= hi)
  return hit.length ? [Math.min(...hit.map((h) => h[0])), Math.max(...hit.map((h) => h[1]))] : null
}
const phrase = (rights, r, a, b, lefts) => ({
  shape: 'rect', text: true, x: a, y: rowTop(r), w: b - a, h: 19, ga: rowTop(r) - 2.5, gb: rowTop(r) + 21.5, col: [0, 620], reach: reachOf(rights, lefts),
})
// how far out to the left the line runs along the gap: the first of the points on it
const runStart = (points, gy) => Math.min(...points.filter((p) => p[1] === gy).map((p) => p[0]))

test('a line leaving text goes under it and along the gap between lines, out past the column', () => {
  const { points, handles } = resolve(arrow(), text, sticky(676, 160))
  assert.equal(points[0][1], 224, 'starts in the gap below')
  assert.ok(points[0][0] >= 100 && points[0][0] <= 220, 'starts under the phrase')
  assert.ok(runEnd(points, 224) > 620, 'is past the column before it turns to the sticky')
  assert.ok(!points.some(inRow), 'crosses no word')
  // its handles edit the line's own two ends, not the route
  assert.deepEqual(handles, [points[0], points.at(-1)])
})

test('a sticky above the text is reached from the top of the phrase', () => {
  const { points } = resolve(arrow(), text, sticky(676, 20))
  assert.equal(points[0][1], 195)
  assert.equal(points[1][1], 195)
})

test('a sticky left of the column mirrors it', () => {
  const { points } = resolve(arrow(), text, sticky(-300, 260))
  assert.ok(points.some((p) => p[0] < 0), 'runs out past the left edge')
  assert.ok(points[0][0] <= 110, 'starts at the left end of the phrase')
})

test('a sticky inside the column is reached directly from underneath', () => {
  const { points, handles } = resolve(arrow(), text, sticky(100, 400))
  assert.equal(points.length, 2)
  assert.equal(handles, undefined)
  assert.ok(points[0][1] > 219)
})

test('a line with bends of its own is left alone, but still never leaves a text side', () => {
  const { points, handles } = resolve(arrow({ points: [[0, 0], [300, 90], [1, 1]] }), text, sticky(676, 160))
  assert.equal(points.length, 3)
  assert.equal(handles, undefined)
  assert.ok(points[0][1] > 219 || points[0][1] < 200)
})

test('text to text uses the facing edges and adds no route', () => {
  const other = { ...text, y: 300, ga: 295, gb: 324 }
  const { points } = resolveLinear(arrow({ end: { anchor: 2 } }), (b) => (b.anchor === 1 ? text : other))
  assert.equal(points.length, 2)
  assert.ok(points[0][1] > 219 && points[1][1] < 300)
})

test('a free end is left where it was put', () => {
  const free = arrow({ end: undefined, x: 640, y: 209, points: [[0, 0], [140, 0]] })
  const { points } = resolveLinear(free, (b) => (b.anchor ? text : null))
  assert.deepEqual(points.at(-1), [780, 209])
  assert.equal(points[1][1], 224, 'level with the row, it leaves from underneath')
})

test('lines between shapes are unchanged', () => {
  const a = { shape: 'rect', x: 0, y: 0, w: 100, h: 50 }
  const b = { shape: 'rect', x: 300, y: 0, w: 100, h: 50 }
  const el = { type: 'arrow', x: 0, y: 0, sw: 2, points: [[0, 0], [1, 1]], start: { id: 'a' }, end: { id: 'b' } }
  const { points, handles } = resolveLinear(el, (r) => (r.id === 'a' ? a : b))
  assert.equal(points.length, 2)
  assert.equal(handles, undefined)
  assert.ok(points[0][0] > 100 && points[1][0] < 300)
})

test('a short line of text is left where the text ends, not at the edge of the column', () => {
  const t = phrase([220], 0, 34, 109)
  const { points } = resolve(arrow(), t, sticky(653, 480))
  assert.equal(points[0][1], t.gb)
  assert.equal(runEnd(points, t.gb), 230, 'ten past the last word')
})

test('past a full-width paragraph the line still runs out to the edge of the column', () => {
  const t = phrase([620, 615, 620, 590], 1, 200, 300)
  assert.equal(runEnd(resolve(arrow(), t, sticky(676, 200)).points, t.gb), 630)
  // and from the top of it
  assert.equal(runEnd(resolve(arrow(), t, sticky(676, -300)).points, t.ga), 630)
})

test('only the rows beside the gap and down to the other end count', () => {
  // a short row, a longer one under it, a long one below that
  const rights = [220, 400, 600]
  const t = phrase(rights, 0, 34, 109)
  const down = (cy) => runEnd(resolve(arrow(), t, sticky(676, cy - 75)).points, t.gb)
  assert.equal(down(rowTop(0) + 20), 410, 'the row under the phrase')
  assert.equal(down(rowTop(1) + 20), 410, 'the row the other end is level with')
  assert.equal(down(rowTop(2) + 20), 610, 'rows between the phrase and the other end')
  assert.equal(down(rowTop(2) + 300), 610)
  // from the top: its own row and the one above it
  const u = phrase([500, 220, 600], 1, 34, 109)
  assert.equal(runEnd(resolve(arrow(), u, sticky(676, -200)).points, u.ga), 510)
  assert.equal(runEnd(resolve(arrow(), u, sticky(676, 500)).points, u.gb), 610)
})

test('going out to the left clears the words where they start, not the edge of the column', () => {
  // an indented list or a quote: the words of the rows start at x = 40
  const lefts = [40, 40, 40]
  const t = phrase([400, 450, 300], 0, 60, 160, lefts)
  const { points } = resolve(arrow(), t, sticky(-300, 260))
  assert.equal(runStart(points, t.gb), 30, 'ten left of where the words start')
  // the leftmost words on the rows it passes count, and no rows beyond the other end
  const u = phrase([400, 450, 300], 0, 60, 160, [40, 60, 15])
  assert.equal(runStart(resolve(arrow(), u, sticky(-300, 155)).points, u.gb), 30, 'rows 0 and 1: the words start at 40')
  assert.equal(runStart(resolve(arrow(), u, sticky(-300, 260)).points, u.gb), 5, 'down to row 2, which starts at 15')
  // the same text and a sticky on the other side: the right end of the words, as before
  assert.equal(runEnd(resolve(arrow(), t, sticky(676, 260)).points, t.gb), 460)
})

test('text beyond the column is not on show, so the line does not run out past the column for it', () => {
  // a long line of code or a wide table under the phrase: the page scrolls it inside the column
  const long = phrase([220, 1350], 0, 34, 109)
  const { points } = resolve(arrow(), long, sticky(676, 220))
  assert.equal(runEnd(points, long.gb), 630, 'ten past the edge of the column, no further')
  assert.ok(points.every((p) => p[0] < 676), 'and never past its sticky and back again')
  assert.ok(!points.some(inRow))
  // the phrase's own row is the one that runs on
  const own = phrase([5000], 0, 34, 109)
  assert.equal(runEnd(resolve(arrow(), own, sticky(676, 400)).points, own.gb), 630)
  assert.ok(resolve(arrow(), own, sticky(676, 400)).points[0][0] <= 109, 'it starts under the phrase')
  // and to the left, where the words may start beyond the column too
  const left = phrase([400, 450], 0, 60, 160, [-700, -900])
  assert.equal(runStart(resolve(arrow(), left, sticky(-300, 260)).points, left.gb), -10)
  const nowhere = phrase([5000, 5000], 0, 60, 160, [900, 900])
  const odd = resolve(arrow(), nowhere, sticky(-300, 260)).points
  assert.ok(odd.every((p) => p.every(Number.isFinite)) && odd.every((p) => p[0] <= 640 && p[0] >= -320), 'text wholly past the column cannot send the line anywhere odd')
})

test('with no measurement of the words the line runs out to the column', () => {
  assert.equal(runEnd(resolve(arrow(), text, sticky(676, 400)).points, 224), 630)
})

test('a phrase on a wrapped paragraph starts under words, not past the end of the last row', () => {
  // three rows; the last one is short, but the phrase covers all of them, so its box is the column
  const t = { ...phrase([615, 618, 140], 2, 0, 620), y: rowTop(0), h: 67, ga: rowTop(0) - 2.5, gb: rowTop(2) + 21.5 }
  const { points } = resolve(arrow(), t, sticky(676, 400))
  assert.ok(points[0][0] <= 140, 'under the last row')
  assert.equal(runEnd(points, t.gb), 150)
})

test('it starts under the words beside the gap, then runs on past longer rows further down', () => {
  // a two-row phrase over short rows, with a long row lower down on the way to the sticky
  const t = { ...phrase([600, 140, 140, 600], 1, 0, 620), y: rowTop(0), h: 43, ga: rowTop(0) - 2.5, gb: rowTop(1) + 21.5 }
  const { points } = resolve(arrow(), t, sticky(676, 400))
  assert.equal(points[0][0], 140, 'under the short rows, not out beyond them')
  assert.equal(runEnd(points, t.gb), 610, 'and on to past the long row')
})

test('reversing an arrow reverses its points', () => {
  const t = phrase([220, 400, 600], 0, 34, 109)
  const forward = resolve(arrow(), t, sticky(676, 500)).points
  const back = resolve(arrow({ start: { id: 's' }, end: { anchor: 1 } }), t, sticky(676, 500)).points
  assert.deepEqual(back, [...forward].reverse())
})

// ---- every kind of route, many times over ----

// a small deterministic generator, so a failure can be replayed
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// do the segments ab and cd cross? (Segments that run along one another do not.)
const crossing = (a, b, c, d) => {
  const side = (p, q, r) => {
    const turn = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return Math.abs(turn) < 1e-6 ? 0 : Math.sign(turn)
  }
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)
}

test('whatever the geometry, the curve never loops, hooks back, overshoots or cuts a word', () => {
  const rand = rng(7)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  for (let i = 0; i < 4000; i++) {
    const rows = 1 + Math.floor(rand() * 8)
    // a few rows run on past the column (code, tables: the page scrolls them inside it), some start further in
    const rights = Array.from({ length: rows }, () => (rand() < 0.1 ? 700 + rand() * 4000 : rand() < 0.4 ? 600 + rand() * 20 : 60 + rand() * 420))
    const lefts = rights.map((r) => (rand() < 0.35 ? rand() * Math.min(140, r - 50) : rand() < 0.05 ? -rand() * 800 : 0))
    // what shows of a row is what lies in the column
    const shows = (r) => [Math.max(lefts[r], 0), Math.min(rights[r], 620)]
    const row = Math.floor(rand() * rows)
    const [shownL, shownR] = shows(row)
    const a = shownL + rand() * (shownR - shownL - 20)
    const t = phrase(rights, row, a, a + 10 + rand() * (shownR - a - 10), lefts)
    // the other end: a sticky (or a free point) clear of the column, near or far, above, level or below
    const out = rand() < 0.7 ? 1 : -1
    const w = pick([30, 200, 400])
    const h = pick([20, 150, 500])
    const cx = out > 0 ? 634 + w / 2 + pick([0, 3, 30, 300, 3000]) : -14 - w / 2 - pick([0, 3, 30, 300, 3000])
    const cy = rowTop(row) + pick([-800, -300, -100, -30, -5, 0, 8, 20, 40, 90, 300, 900, 4000])
    const free = rand() < 0.2
    const target = { shape: 'rect', x: cx - w / 2, y: cy - h / 2, w, h }
    const start = rand() < 0.5
    const other = free ? undefined : { id: 's' }
    const el = arrow({ ...(free && { x: cx, y: cy, points: [[0, 0], [0, 0]] }), ...(start ? { end: other } : { start: other, end: { anchor: 1 } }) })
    const { points: raw, handles } = resolve(el, t, target)
    const points = start ? raw : [...raw].reverse()
    const where = `case ${i}: ${JSON.stringify({ rights, lefts, row, a, out, cx, cy, w, h, free, start })}`
    assert.equal(handles?.length, 2, where)

    // work in the line's own frame: u runs the way out, v away from the text
    const below = !(cy < t.y)
    const gy = below ? t.gb : t.ga
    const side = below ? 1 : -1
    const frame = ([x, y]) => [x * out, (y - gy) * side]
    const f = points.map(frame)
    const curve = sampleSmooth(points, 12).map(frame)

    // it leaves the text on the gap, in the gap, and goes only as far as the words it could cut
    assert.equal(points[0][1], gy, where)
    const reach = t.reach(gy, cy)
    const far = out > 0 ? Math.min(reach[1], 620) : -Math.max(reach[0], 0)
    const onGap = []
    for (const p of f) if (Math.abs(p[1]) < 1e-9) onGap.push(p[0]); else break
    const end = onGap.at(-1)
    assert.ok(end <= far + 10 + 1e-6 && end >= far + 2 - 1e-6, `${where}: run ${end} is not 2 to 10 past ${far}`)
    // the full ten, unless the sticky is too close to leave room for the bend
    const room = (out > 0 ? cx - w / 2 : -cx - w / 2) - 6 - far
    if (free ? cx * out - far >= 50 : room >= 50) assert.ok(Math.abs(end - (far + 10)) < 1e-6, `${where}: run ${end} stops short of ${far + 10}`)

    // never to the wrong side of the gap, never beyond the line's own points
    const lo = [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1]))]
    const hi = [Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))]
    for (const [u, v] of curve) {
      assert.ok(u >= lo[0] - 1 && u <= hi[0] + 1 && v >= lo[1] - 1 && v <= hi[1] + 1, `${where}: leaves its points at ${u.toFixed(1)},${v.toFixed(1)}`)
      assert.ok(v >= Math.min(0, f.at(-1)[1]) - 1, `${where}: wrong side of the gap`)
    }
    // no loop (a curl of less than 3px is a pixel's wobble, not a loop), no U-turn
    const along = curve.reduce((sum, p, j) => [...sum, j ? sum[j - 1] + Math.hypot(p[0] - curve[j - 1][0], p[1] - curve[j - 1][1]) : 0], [])
    for (let j = 0; j < curve.length - 1; j++) {
      const [du, dv] = [curve[j + 1][0] - curve[j][0], curve[j + 1][1] - curve[j][1]]
      if (Math.hypot(du, dv) > 0.5) assert.ok(Math.abs(Math.atan2(dv, du)) < (3 * Math.PI) / 4, `${where}: turns back on itself`)
      for (let k = j + 2; k < curve.length - 1; k++) if (along[k] - along[j + 1] > 3) assert.ok(!crossing(curve[j], curve[j + 1], curve[k], curve[k + 1]), `${where}: loops`)
    }
    // no word of the rows it passes is touched
    for (let r = 0; r < rows; r++) {
      const mid = rowTop(r) + 9.5
      if (mid < Math.min(gy - LH, cy) || mid > Math.max(gy + LH, cy)) continue
      const [shownL, shownR] = shows(r)
      for (const p of sampleSmooth(points, 12)) assert.ok(!(p[0] > shownL && p[0] < shownR && p[1] > rowTop(r) && p[1] < rowTop(r) + 19), `${where}: cuts row ${r}`)
    }
  }
})

test('a sticky right up against the text still gets a sane line', () => {
  const rand = rng(11)
  for (let i = 0; i < 500; i++) {
    const t = phrase([500 + rand() * 120, 400 + rand() * 220], 0, 20, 120)
    const w = 40 + rand() * 200
    const h = 20 + rand() * 300
    const x = 610 + rand() * 40
    const target = { shape: 'rect', x, y: 150 + rand() * 200, w, h }
    const { points } = resolve(arrow(), t, target)
    assert.ok(points.every((p) => p.every(Number.isFinite)), `case ${i}: not finite`)
    const curve = sampleSmooth(points, 12)
    const [x0, x1] = [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))]
    const [y0, y1] = [Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))]
    for (const [cx, cy] of curve) assert.ok(cx >= x0 - 1 && cx <= x1 + 1 && cy >= y0 - 1 && cy <= y1 + 1, `case ${i}: leaves its points at ${cx},${cy}`)
  }
})
