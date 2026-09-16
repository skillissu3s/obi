// Minimal-diff helpers to apply a full text replacement onto a Y.Text (or CM doc)
// without clobbering unrelated regions, plus a 3-way merge for reconnect scenarios.
import DiffMatchPatch from 'diff-match-patch'

const dmp = new DiffMatchPatch()
dmp.Diff_Timeout = 0.5

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
  return changes
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
