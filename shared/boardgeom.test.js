// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLinear } from './boardgeom.js'

// A phrase on one row of text, in a column from x = 0 to x = 620. ga and gb are
// the middles of the free bands above and below the row.
const text = { shape: 'rect', text: true, x: 100, y: 200, w: 120, h: 19, ga: 195, gb: 224, col: [0, 620] }
const sticky = (x, y) => ({ shape: 'rect', x, y, w: 200, h: 150 })
const arrow = (extra = {}) => ({ type: 'arrow', x: 0, y: 0, sw: 1, points: [[0, 0], [1, 1]], start: { anchor: 1 }, end: { id: 's' }, ...extra })
const resolve = (el, t, s) => resolveLinear(el, (b) => (b.anchor ? t : s))
const inRow = ([x, y]) => y > 200 && y < 219 && x > 100 && x < 620

test('a line leaving text goes under it and along the gap between lines, out past the column', () => {
  const { points, handles } = resolve(arrow(), text, sticky(676, 160))
  assert.equal(points.length, 4)
  assert.equal(points[0][1], 224, 'starts in the gap below')
  assert.ok(points[0][0] >= 100 && points[0][0] <= 220, 'starts under the phrase')
  assert.deepEqual([points[1][1], points[2][1]], [224, 224], 'runs along the gap')
  assert.ok(points[1][0] > 620, 'is past the column before it turns to the sticky')
  assert.ok(!points.slice(0, 3).some(inRow), 'crosses no word')
  // its handles edit the line's own two ends, not the route
  assert.deepEqual(handles, [points[0], points[3]])
})

test('a sticky above the text is reached from the top of the phrase', () => {
  const { points } = resolve(arrow(), text, sticky(676, 20))
  assert.equal(points[0][1], 195)
  assert.equal(points[1][1], 195)
})

test('a sticky left of the column mirrors it', () => {
  const { points } = resolve(arrow(), text, sticky(-300, 260))
  assert.ok(points[1][0] < 0, 'runs out past the left edge')
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
  assert.equal(points.length, 4)
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
