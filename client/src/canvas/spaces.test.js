// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { spaceEnds, spacePlacements, spaceHeight, SPACE_MIN, SPACE_MAX } from './spaces.js'

test('a space under an ordinary line opens right under it', () => {
  const ends = spaceEnds('# Title\n\nFirst line\nSecond line\n- item\n\t- nested\n')
  assert.deepEqual(ends, [0, 1, 2, 3, 4, 5, 6])
})

test('a code block, a math block, a table, a callout and the front matter are not split', () => {
  const text = [
    '---', // 0
    'tags: [a]', // 1
    '---', // 2
    'Before', // 3
    '```js', // 4
    'let a = 1', // 5
    '```', // 6
    '$$', // 7
    'x^2', // 8
    '$$', // 9
    '| a | b |', // 10
    '| --- | --- |', // 11
    '| 1 | 2 |', // 12
    '> [!note] Title', // 13
    '> body', // 14
    '> more', // 15
    'After', // 16
    '$$ one line $$', // 17
    'a | b', // 18
    '--|--', // 19
    'c | d', // 20
    '', // 21
  ].join('\n')
  const ends = spaceEnds(text)
  assert.deepEqual(ends.slice(0, 3), [2, 2, 2])
  assert.equal(ends[3], 3)
  assert.deepEqual(ends.slice(4, 7), [6, 6, 6])
  assert.deepEqual(ends.slice(7, 10), [9, 9, 9])
  assert.deepEqual(ends.slice(10, 13), [12, 12, 12])
  assert.deepEqual(ends.slice(13, 16), [15, 15, 15])
  assert.equal(ends[16], 16)
  assert.equal(ends[17], 17)
  assert.deepEqual(ends.slice(18, 21), [20, 20, 20])
})

test('an unclosed fence runs to the end of the note', () => {
  assert.deepEqual(spaceEnds('a\n```\ncode\nmore'), [0, 3, 3, 3])
})

test('placements: in order down the note, snapped, heights kept in range', () => {
  const text = 'One\n```\ncode\n```\nTwo\n'
  const anchors = { a: 0, b: 2, c: 4 } // the line each element's anchor is on
  const els = [
    { id: 'c', type: 'space', anchor: 'c', h: 99999 },
    { id: 'b', type: 'space', anchor: 'b', h: 3 },
    { id: 'x', type: 'rect', anchor: 'a' },
    { id: 'a', type: 'space', anchor: 'a', h: 160.4 },
    { id: 'lost', type: 'space', anchor: 'gone', h: 100 },
  ]
  const lineOf = (a) => anchors[a] ?? null
  assert.deepEqual(spacePlacements(els, lineOf, spaceEnds(text)), [
    { id: 'a', line: 0, h: 160 },
    { id: 'b', line: 3, h: SPACE_MIN },
    { id: 'c', line: 4, h: SPACE_MAX },
  ])
  assert.equal(spaceHeight(undefined), 160)
})
