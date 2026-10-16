// Minimal-diff helpers to apply a full text replacement onto a Y.Text (or CM doc)
// without clobbering unrelated regions, plus a 3-way merge for reconnect scenarios.
import DiffMatchPatch from 'diff-match-patch'

const dmp = new DiffMatchPatch()
dmp.Diff_Timeout = 0.5

const isHigh = (code) => code >= 0xd800 && code <= 0xdbff
const isLow = (code) => code >= 0xdc00 && code <= 0xdfff

/**
 * The diff works on UTF-16 units, so it can start or end a change between the two
 * halves of one character (🔼 and 🔽 differ only in their second half). Yjs turns a
 * character cut like that into "�". Each change is widened to whole characters.
 */
function wholeCharacters(changes, oldText) {
  const out = []
  for (const c of changes) {
    let { from, to, insert } = c
    // starts just after a first half: take that half in
    if (from > 0 && isHigh(oldText.charCodeAt(from - 1)) && (isLow(oldText.charCodeAt(from)) || isLow(insert.charCodeAt(0)))) {
      from--
      insert = oldText[from] + insert
    }
    // ends just before a second half: take that half in
    if (to < oldText.length && isLow(oldText.charCodeAt(to)) && (isHigh(oldText.charCodeAt(to - 1)) || isHigh(insert.charCodeAt(insert.length - 1)))) {
      insert += oldText[to]
      to++
    }
    // (widening can make a change meet the one before it: one change, then)
    const prev = out[out.length - 1]
    if (prev && from <= prev.to) {
      prev.insert += oldText.slice(prev.to, from) + insert
      prev.to = Math.max(prev.to, to)
    } else out.push({ from, to, insert })
  }
  return out
}

// Returns [{from, to, insert}] operations in ascending order against `oldText`.
export function computeChanges(oldText, newText) {
  if (oldText === newText) return []
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)
  const changes = []
  let pos = 0
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]
    if (op === 0) {
      pos += text.length
    } else if (op === -1) {
      const next = diffs[i + 1]
      if (next && next[0] === 1) {
        changes.push({ from: pos, to: pos + text.length, insert: next[1] })
        i++
      } else {
        changes.push({ from: pos, to: pos + text.length, insert: '' })
      }
      pos += text.length
    } else {
      changes.push({ from: pos, to: pos, insert: text })
    }
  }
  return wholeCharacters(changes, oldText)
}

export function applyToYText(ytext, newText, origin = null) {
  const oldText = ytext.toString()
  const changes = computeChanges(oldText, newText)
  if (!changes.length) return false
  const doc = ytext.doc
  const apply = () => {
    // apply from the end so earlier offsets stay valid
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i]
      if (c.to > c.from) ytext.delete(c.from, c.to - c.from)
      if (c.insert) ytext.insert(c.from, c.insert)
    }
  }
  if (doc) doc.transact(apply, origin)
  else apply()
  return true
}

// Rebase local edits (base -> local) onto a new remote text.
export function merge3(base, local, remote) {
  if (base === local) return remote
  if (base === remote) return local
  if (local === remote) return local
  const patches = dmp.patch_make(base, local)
  const [merged] = dmp.patch_apply(patches, remote)
  return merged
}
