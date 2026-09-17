import { one, all } from './db.js'
import { basename } from '../shared/paths.js'
import { isBoardPath } from '../shared/board.js'

export const RANK = { viewer: 1, editor: 2, owner: 3 }

export function workspaceRole(userId, wsId) {
  return one('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?', wsId, userId)?.role || null
}

export function noteRole(userId, wsId, path) {
  const r = workspaceRole(userId, wsId)
  if (r) return r
  return one('SELECT role FROM note_shares WHERE workspace_id = ? AND path = ? AND user_id = ?', wsId, path, userId)?.role || null
}

export function hasRank(role, min) {
  return !!role && RANK[role] >= RANK[min]
}

// Files (attachments) may be read by members, or by users with a shared note referencing the file.
export async function canReadFile(userId, rt, path) {
  if (workspaceRole(userId, rt.id)) return true
  const shares = all('SELECT path FROM note_shares WHERE workspace_id = ? AND user_id = ?', rt.id, userId)
  if (!shares.length) return false
  const name = basename(path).toLowerCase()
  const embeddedBoards = []
  for (const s of shares) {
    const text = rt.contents.get(s.path)
    if (text && text.toLowerCase().includes(name)) return true
    // images placed on the note's canvas layer
    const layer = await rt.readLayer(s.path)
    if (layer && layer.toLowerCase().includes(name)) return true
    if (text) for (const m of text.matchAll(/!\[\[([^\]|#]+\.board)/gi)) embeddedBoards.push(rt.resolver.resolve(m[1], s.path, 'wiki'))
  }
  // whiteboards embedded in a shared note, and images inside them
  for (const b of embeddedBoards) {
    if (!b) continue
    if (b === path) return true
    if (isBoardPath(b)) {
      const text = await rt.readNote(b).catch(() => null)
      if (text && text.toLowerCase().includes(name)) return true
    }
  }
  return false
}
