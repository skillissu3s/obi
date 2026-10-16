// Run with: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { applyToYText, computeChanges } from './textdiff.js'

// a character cut in half: a lone surrogate, or what Yjs puts in its place
const broken = (s) => /�|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)

const ytextOf = (s) => {
  const doc = new Y.Doc()
  const t = doc.getText('t')
  t.insert(0, s)
  return t
}

test('changing one emoji for another never cuts either in half', () => {
  // 🔼 and 🔽 (the medium and low priority flags) differ only in their second half
  const flags = ['🔺', '⏫', '🔼', '🔽', '⏬', '']
  for (const a of flags) {
    for (const b of flags) {
      const t = ytextOf(`- [ ] Write the copy #feature ${a}`.trim())
      const want = `- [ ] Write the copy #feature ${b}`.trim()
      applyToYText(t, want)
      assert.equal(t.toString(), want, `${a || 'none'} → ${b || 'none'}`)
    }
  }
})

test('the changes themselves start and end on whole characters', () => {
  const pairs = [
    ['a 🔼 b', 'a 🔽 b'],
    ['🔺🔺', '🔺🔼'],
    ['x😀y', 'x😃y'],
    ['📅 2026-10-15 🔼', '📅 2026-10-16 🔽'],
  ]
  for (const [a, b] of pairs) {
    for (const c of computeChanges(a, b)) {
      assert.ok(!broken(c.insert), `insert ${JSON.stringify(c.insert)} for ${a} → ${b}`)
      assert.ok(!broken(a.slice(c.from, c.to)), `deleted ${JSON.stringify(a.slice(c.from, c.to))} for ${a} → ${b}`)
    }
    const t = ytextOf(a)
    applyToYText(t, b)
    assert.equal(t.toString(), b)
  }
})
