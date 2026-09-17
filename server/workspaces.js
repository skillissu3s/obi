import express from 'express'
import fs from 'node:fs/promises'
import { Zip, ZipDeflate, ZipPassThrough, unzipSync } from 'fflate'
import { one, all, run, now, parseJSON, tx } from './db.js'
import { requireAuth } from './auth.js'
import { encrypt, decrypt, newId, randomToken } from './security.js'
import { workspaceRole, noteRole, hasRank, canReadFile } from './access.js'
import { getRuntime, peekRuntime, disposeRuntime } from './runtime.js'
import { HttpError, safePath, absPath, mimeFor, INLINE_SAFE } from './fsutil.js'
import { createOnlineWorkspace } from './users.js'
import { notifyUser } from './hub.js'
import * as git from './git.js'
import { MAX_UPLOAD_MB } from './config.js'
import { extname, isNote, basename, dirname, safeName, joinPath } from '../shared/paths.js'
import { isBoardPath, isLayerPath, notePathForLayer, parseBoard, BoardParseError } from '../shared/board.js'
import { scanDir } from './fsutil.js'
import path from 'node:path'

export const wsRouter = express.Router()
export const miscRouter = express.Router()
wsRouter.use(requireAuth)
miscRouter.use(requireAuth)

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX/\-])(\].*)$/

function serializeWorkspace(w, role, userId) {
  const rt = peekRuntime(w.id)
  const settings = parseJSON(w.settings)
  const owner = one('SELECT username, display_name FROM users WHERE id = ?', w.owner_id)
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    icon: w.icon,
    role,
    isDefault: !!w.is_default && w.owner_id === userId,
    owner: { id: w.owner_id, username: owner?.username, name: owner?.display_name },
    github: w.type === 'github' ? { repo: w.github_repo, label: git.repoLabel(w.github_repo), branch: w.github_branch, hasToken: !!w.github_token } : null,
    settings,
    memberCount: one('SELECT COUNT(*) AS n FROM members WHERE workspace_id = ?', w.id).n,
    sync: rt ? rt.syncStatus() : w.type === 'github' ? { state: w.sync_error ? 'error' : 'idle', lastSync: w.last_sync_at, error: w.sync_error } : null,
    createdAt: w.created_at,
  }
}

function loadWs(req, min) {
  const w = one('SELECT * FROM workspaces WHERE id = ?', req.params.id)
  if (!w) throw new HttpError(404, 'Workspace not found')
  const role = workspaceRole(req.user.id, w.id)
  if (!hasRank(role, min)) throw new HttpError(role ? 403 : 404, role ? 'You do not have permission to do that' : 'Workspace not found')
  req.ws = w
  req.role = role
  return w
}

// member access with minimum role
const access = (min) => (req, res, next) => {
  loadWs(req, min)
  next()
}

// path-level access (members or users the note is shared with)
function notePathAccess(req, min, p) {
  const w = one('SELECT * FROM workspaces WHERE id = ?', req.params.id)
  if (!w) throw new HttpError(404, 'Workspace not found')
  const role = noteRole(req.user.id, w.id, p)
  if (!hasRank(role, min)) throw new HttpError(404, 'Note not found')
  req.ws = w
  req.role = role
}

async function boardAccess(req, p) {
  const w = one('SELECT * FROM workspaces WHERE id = ?', req.params.id)
  if (!w) throw new HttpError(404, 'Workspace not found')
  const role = workspaceRole(req.user.id, w.id)
  req.ws = w
  req.role = role
  if (role) return
  const rt = await getRuntime(w.id)
  if (!(await canReadFile(req.user.id, rt, p))) throw new HttpError(404, 'Whiteboard not found')
  req.role = 'viewer'
}

const settingsKeys = new Set([
  'dailyFolder', 'dailyFormat', 'dailyTemplate', 'templatesFolder', 'attachmentsFolder', 'newNoteFolder',
  'autoSync', 'autoSyncSeconds', 'pullIntervalSeconds', 'authorName', 'authorEmail', 'gitUsername', 'description',
])

// ---------------- list / create ----------------
wsRouter.get('/', (req, res) => {
  const rows = all(
    `SELECT w.*, m.role FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.is_default DESC, w.created_at ASC`,
    req.user.id,
  )
  res.json({ workspaces: rows.map((w) => serializeWorkspace(w, w.role, req.user.id)) })
})

wsRouter.post('/test-github', async (req, res) => {
  const { repoUrl, token } = req.body || {}
  const url = git.normalizeRepoUrl(repoUrl)
  const info = await git.lsRemote(url, token)
  res.json({ url, label: git.repoLabel(url), ...info })
})

wsRouter.post('/', async (req, res) => {
  const { name, type, icon, github } = req.body || {}
  const n = String(name || '').trim().slice(0, 80)
  if (!n) throw new HttpError(400, 'Name is required')
  if (type === 'online') {
    const id = await createOnlineWorkspace({ ownerId: req.user.id, name: n, icon: icon || '' })
    return res.json({ workspace: serializeWorkspace(one('SELECT * FROM workspaces WHERE id = ?', id), 'owner', req.user.id) })
  }
  if (type !== 'github') throw new HttpError(400, 'Invalid workspace type')
  const url = git.normalizeRepoUrl(github?.repoUrl)
  const token = String(github?.token || '').trim()
  if (!token && !url.startsWith('file:') && !url.startsWith('/') && !/^[A-Z]:/i.test(url)) throw new HttpError(400, 'An access token is required')
  const info = await git.lsRemote(url, token)
  const branch = String(github?.branch || '').trim() || info.defaultBranch || 'main'
  if (!info.empty && !info.branches.includes(branch)) throw new HttpError(400, `Branch "${branch}" was not found. Available: ${info.branches.slice(0, 10).join(', ')}`)
  const id = newId()
  const t = now()
  const settings = { autoSync: true, autoSyncSeconds: 30, pullIntervalSeconds: 120 }
  tx(() => {
    run(
      'INSERT INTO workspaces (id, name, type, owner_id, icon, github_repo, github_branch, github_token, settings, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, n, 'github', req.user.id, icon || '', url, branch, encrypt(token), JSON.stringify(settings), t, t,
    )
    run('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?,?,?,?)', id, req.user.id, 'owner', t)
  })
  getRuntime(id).catch((e) => console.error('[clone]', e.message))
  res.json({ workspace: serializeWorkspace(one('SELECT * FROM workspaces WHERE id = ?', id), 'owner', req.user.id) })
})

wsRouter.get('/:id', access('viewer'), (req, res) => {
  res.json({ workspace: serializeWorkspace(req.ws, req.role, req.user.id) })
})

wsRouter.patch('/:id', access('owner'), async (req, res) => {
  const w = req.ws
  const { name, icon, settings, github } = req.body || {}
  if (name != null) {
    const n = String(name).trim().slice(0, 80)
    if (!n) throw new HttpError(400, 'Name is required')
    run('UPDATE workspaces SET name = ? WHERE id = ?', n, w.id)
  }
  if (icon != null) run('UPDATE workspaces SET icon = ? WHERE id = ?', String(icon).slice(0, 16), w.id)
  if (settings && typeof settings === 'object') {
    const merged = parseJSON(w.settings)
    for (const [k, v] of Object.entries(settings)) if (settingsKeys.has(k)) merged[k] = v
    run('UPDATE workspaces SET settings = ? WHERE id = ?', JSON.stringify(merged), w.id)
  }
  if (github && w.type === 'github') {
    const url = github.repoUrl ? git.normalizeRepoUrl(github.repoUrl) : w.github_repo
    const branch = github.branch ? String(github.branch).trim() : w.github_branch
    const token = github.token ? String(github.token).trim() : null
    if (url !== w.github_repo || branch !== w.github_branch || token) {
      const info = await git.lsRemote(url, token || decrypt(w.github_token))
      if (!info.empty && !info.branches.includes(branch)) throw new HttpError(400, `Branch "${branch}" was not found`)
    }
    if (url !== w.github_repo || branch !== w.github_branch) {
      await disposeRuntime(w.id, { removeFiles: true })
      run('UPDATE workspaces SET github_repo = ?, github_branch = ?, last_sync_at = NULL, sync_error = NULL WHERE id = ?', url, branch, w.id)
    }
    if (token) run('UPDATE workspaces SET github_token = ?, sync_error = NULL WHERE id = ?', encrypt(token), w.id)
  }
  run('UPDATE workspaces SET updated_at = ? WHERE id = ?', now(), w.id)
  const rt = peekRuntime(w.id)
  if (rt) {
    rt.reloadRow()
    if (rt.type === 'github') {
      rt.startPullLoop()
      if (github?.token) {
        rt.initError = null
        rt.requestSync()
      }
    }
  } else if (w.type === 'github') {
    getRuntime(w.id).catch(() => {})
  }
  const updated = one('SELECT * FROM workspaces WHERE id = ?', w.id)
  for (const m of all('SELECT user_id FROM members WHERE workspace_id = ?', w.id)) notifyUser(m.user_id, { t: 'workspaces' })
  res.json({ workspace: serializeWorkspace(updated, req.role, req.user.id) })
})

wsRouter.delete('/:id', access('owner'), async (req, res) => {
  const w = req.ws
  const others = one('SELECT COUNT(*) AS n FROM members WHERE user_id = ? AND workspace_id != ?', req.user.id, w.id).n
  if (!others) throw new HttpError(400, 'You cannot delete your only workspace')
  const members = all('SELECT user_id FROM members WHERE workspace_id = ?', w.id)
  await disposeRuntime(w.id, { removeFiles: true })
  run('DELETE FROM workspaces WHERE id = ?', w.id)
  for (const m of members) notifyUser(m.user_id, { t: 'workspaces' })
  res.json({ ok: true })
})

wsRouter.post('/:id/leave', access('viewer'), (req, res) => {
  if (req.role === 'owner') throw new HttpError(400, 'Owners cannot leave their workspace')
  run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', req.ws.id, req.user.id)
  res.json({ ok: true })
})

// ---------------- content ----------------
wsRouter.get('/:id/tree', access('viewer'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  res.json({ entries: rt.getTree(), sync: rt.type === 'github' ? rt.syncStatus() : null, initError: rt.initError })
})

wsRouter.get('/:id/index', access('viewer'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  res.json({ notes: rt.getIndex() })
})

wsRouter.get('/:id/note', async (req, res) => {
  const p = safePath(req.query.path)
  if (isBoardPath(p)) await boardAccess(req, p)
  else notePathAccess(req, 'viewer', p)
  const rt = await getRuntime(req.ws.id)
  const content = await rt.readNote(p)
  if (content == null) throw new HttpError(404, 'Note not found')
  res.json({ path: p, content, mtime: rt.tree.get(p)?.mtime, role: req.role })
})

wsRouter.put('/:id/note', async (req, res) => {
  const { path: rawPath, content, ifMissing, mustNotExist } = req.body || {}
  const p = safePath(rawPath)
  const board = isBoardPath(p)
  if (!isNote(p) && !board) throw new HttpError(400, 'Notes must end with .md')
  notePathAccess(req, 'editor', p)
  if (board) {
    try {
      parseBoard(content)
    } catch (e) {
      throw new HttpError(400, e instanceof BoardParseError ? e.message : 'Invalid whiteboard')
    }
  }
  if (!workspaceRole(req.user.id, req.ws.id)) {
    // share-only editors may only modify existing notes
    const rt0 = await getRuntime(req.ws.id)
    if (!rt0.hasFile(p)) throw new HttpError(403, 'You do not have permission to do that')
  }
  if (typeof content !== 'string') throw new HttpError(400, 'Content is required')
  const rt = await getRuntime(req.ws.id)
  const r = await rt.writeNote(p, content, { userId: req.user.id, ifMissing, mustNotExist })
  res.json({ path: p, ...r })
})

wsRouter.post('/:id/folder', access('editor'), async (req, res) => {
  const p = safePath(req.body?.path)
  const rt = await getRuntime(req.ws.id)
  await rt.createFolder(p)
  res.json({ path: p })
})

wsRouter.post('/:id/move', access('editor'), async (req, res) => {
  const from = safePath(req.body?.from)
  const to = safePath(req.body?.to)
  const rt = await getRuntime(req.ws.id)
  const entry = rt.tree.get(from)
  if (entry?.type === 'file' && isNote(from) && !isNote(to)) throw new HttpError(400, 'Notes must end with .md')
  if (entry?.type === 'file' && isBoardPath(from) && !isBoardPath(to)) throw new HttpError(400, 'Whiteboards must end with .board')
  const r = await rt.move(from, to, { updateLinks: req.body?.updateLinks !== false, userId: req.user.id })
  res.json(r)
})

wsRouter.delete('/:id/entry', access('editor'), async (req, res) => {
  const p = safePath(req.query.path)
  const rt = await getRuntime(req.ws.id)
  await rt.remove(p, { userId: req.user.id })
  if (rt.type === 'online') {
    run('DELETE FROM note_shares WHERE workspace_id = ? AND (path = ? OR path LIKE ?)', rt.id, p, p + '/%')
    run('DELETE FROM published WHERE workspace_id = ? AND (path = ? OR path LIKE ?)', rt.id, p, p + '/%')
  }
  res.json({ ok: true })
})

const rawUpload = express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` })

wsRouter.put('/:id/file', access('editor'), rawUpload, async (req, res) => {
  let p = safePath(req.query.path)
  const rt = await getRuntime(req.ws.id)
  if (req.query.unique === '1') p = rt.uniquePath(p)
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Empty upload')
  await rt.writeFile(p, req.body)
  res.json({ path: p })
})

wsRouter.get('/:id/file', async (req, res) => {
  const p = safePath(req.query.path)
  const w = one('SELECT * FROM workspaces WHERE id = ?', req.params.id)
  if (!w) throw new HttpError(404, 'Not found')
  const rt = await getRuntime(w.id)
  if (!rt.hasFile(p) || !(await canReadFile(req.user.id, rt, p))) throw new HttpError(404, 'Not found')
  const ext = extname(p)
  res.setHeader('Content-Type', mimeFor(ext))
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=60')
  if (!INLINE_SAFE.has(ext) || req.query.download === '1') res.attachment(basename(p))
  res.sendFile(absPath(rt.dir, p), { dotfiles: 'allow' })
})

wsRouter.get('/:id/search', access('viewer'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  const t = performance.now()
  const results = rt.search(String(req.query.q || ''), { limit: Math.min(Number(req.query.limit) || 60, 200) })
  res.json({ results, took: Math.round(performance.now() - t) })
})

wsRouter.get('/:id/backlinks', access('viewer'), async (req, res) => {
  const p = safePath(req.query.path)
  const rt = await getRuntime(req.ws.id)
  res.json(rt.backlinks(p))
})

wsRouter.post('/:id/tasks/toggle', async (req, res) => {
  const p = safePath(req.body?.path)
  notePathAccess(req, 'editor', p)
  const line = Number(req.body?.line)
  const status = req.body?.status ?? null
  const rt = await getRuntime(req.ws.id)
  let result = null
  await rt.updateNote(
    p,
    (text) => {
      const lines = text.split('\n')
      const m = TASK_RE.exec(lines[line] ?? '')
      if (!m) throw new HttpError(409, 'The task has changed, please refresh')
      const next = status != null ? String(status).slice(0, 1) : m[2] === ' ' ? 'x' : ' '
      lines[line] = m[1] + next + m[3]
      result = next
      return lines.join('\n')
    },
    { userId: req.user.id },
  )
  res.json({ status: result })
})

// ---------------- history ----------------
wsRouter.get('/:id/history', access('viewer'), async (req, res) => {
  const p = safePath(req.query.path)
  const rt = await getRuntime(req.ws.id)
  if (rt.type === 'github') {
    const versions = await git.fileHistory(rt.dir, p)
    return res.json({ versions: versions.map((v) => ({ ...v, source: 'git' })) })
  }
  const rows = all(
    `SELECT v.id, v.created_at, v.user_id, length(v.content) AS size, u.display_name FROM versions v LEFT JOIN users u ON u.id = v.user_id
     WHERE v.workspace_id = ? AND v.path = ? ORDER BY v.created_at DESC LIMIT 200`,
    rt.id, p,
  )
  res.json({ versions: rows.map((r) => ({ id: String(r.id), createdAt: r.created_at, author: r.display_name, size: r.size, path: p, source: 'db' })) })
})

async function versionContent(rt, p, id, vpath) {
  if (rt.type === 'github') return git.showFileAt(rt.dir, String(id), vpath ? safePath(vpath) : p)
  const row = one('SELECT content FROM versions WHERE id = ? AND workspace_id = ? AND path = ?', Number(id), rt.id, p)
  return row?.content ?? null
}

wsRouter.get('/:id/history/version', access('viewer'), async (req, res) => {
  const p = safePath(req.query.path)
  const rt = await getRuntime(req.ws.id)
  const content = await versionContent(rt, p, req.query.id, req.query.vpath)
  if (content == null) throw new HttpError(404, 'Version not found')
  res.json({ content })
})

wsRouter.post('/:id/history/restore', access('editor'), async (req, res) => {
  const p = safePath(req.body?.path)
  const rt = await getRuntime(req.ws.id)
  const content = await versionContent(rt, p, req.body?.id, req.body?.vpath)
  if (content == null) throw new HttpError(404, 'Version not found')
  if (rt.type === 'online') {
    const current = await rt.readNote(p)
    if (current != null) rt._maybeSnapshot(p, current, req.user.id, true)
  }
  await rt.writeNote(p, content, { userId: req.user.id })
  res.json({ ok: true })
})

// ---------------- sync ----------------
wsRouter.get('/:id/sync', access('viewer'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  res.json({ sync: rt.syncStatus() })
})

wsRouter.post('/:id/sync', access('editor'), async (req, res) => {
  if (req.ws.type !== 'github') throw new HttpError(400, 'Not a GitHub workspace')
  const rt = await getRuntime(req.ws.id)
  const status = await rt.requestSync()
  res.json({ sync: status })
})

// ---------------- members (online workspaces) ----------------
wsRouter.get('/:id/members', access('viewer'), (req, res) => {
  const rows = all(
    `SELECT u.id, u.username, u.display_name, u.color, m.role, m.added_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.added_at`,
    req.ws.id,
  )
  res.json({ members: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, color: r.color, role: r.role, addedAt: r.added_at })) })
})

function requireOnline(w) {
  if (w.type !== 'online') throw new HttpError(400, 'Sharing is available for online workspaces. GitHub workspaces stay private to their owner.')
}

wsRouter.post('/:id/members', access('owner'), (req, res) => {
  requireOnline(req.ws)
  const { username, role } = req.body || {}
  if (!['editor', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role')
  const u = one('SELECT * FROM users WHERE username = ? AND disabled = 0', String(username || '').trim())
  if (!u) throw new HttpError(404, 'No user with that username')
  const existing = workspaceRole(u.id, req.ws.id)
  if (existing === 'owner') throw new HttpError(400, 'That user owns this workspace')
  if (existing) run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, req.ws.id, u.id)
  else run('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?,?,?,?)', req.ws.id, u.id, role, now())
  notifyUser(u.id, { t: 'workspaces', invitedTo: { id: req.ws.id, name: req.ws.name, by: req.user.display_name } })
  res.json({ ok: true })
})

wsRouter.patch('/:id/members/:userId', access('owner'), (req, res) => {
  const { role } = req.body || {}
  if (!['editor', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role')
  if (workspaceRole(req.params.userId, req.ws.id) === 'owner') throw new HttpError(400, 'Cannot change the owner role')
  run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, req.ws.id, req.params.userId)
  const rt = peekRuntime(req.ws.id)
  if (rt) for (const doc of rt.docs.values()) for (const sock of doc.conns.keys()) if (sock.user.id === req.params.userId) doc.setRole(sock, role)
  notifyUser(req.params.userId, { t: 'workspaces', roleChanged: req.ws.id })
  res.json({ ok: true })
})

wsRouter.delete('/:id/members/:userId', access('owner'), (req, res) => {
  if (workspaceRole(req.params.userId, req.ws.id) === 'owner') throw new HttpError(400, 'Cannot remove the owner')
  run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', req.ws.id, req.params.userId)
  kickUser(req.ws.id, req.params.userId)
  notifyUser(req.params.userId, { t: 'workspaces', removedFrom: req.ws.id })
  res.json({ ok: true })
})

function kickUser(wsId, userId, onlyPath) {
  const rt = peekRuntime(wsId)
  if (!rt) return
  for (const sock of [...rt.subscribers]) if (sock.user.id === userId && !onlyPath) rt.subscribers.delete(sock)
  for (const doc of rt.docs.values()) {
    if (onlyPath && doc.path !== onlyPath) continue
    for (const sock of [...doc.conns.keys()]) {
      if (sock.user.id !== userId) continue
      if (noteRole(userId, wsId, doc.path)) continue
      sock.sendJSON({ t: 'evicted', doc: doc.key, reason: 'access' })
      sock.docs.delete(doc.key)
      doc.removeConn(sock)
    }
  }
}

// ---------------- note shares ----------------
wsRouter.get('/:id/shares', access('viewer'), (req, res) => {
  const p = safePath(req.query.path)
  const rows = all(
    `SELECT u.id, u.username, u.display_name, u.color, s.role, s.created_at FROM note_shares s JOIN users u ON u.id = s.user_id WHERE s.workspace_id = ? AND s.path = ?`,
    req.ws.id, p,
  )
  const pub = one('SELECT slug FROM published WHERE workspace_id = ? AND path = ?', req.ws.id, p)
  res.json({
    shares: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, color: r.color, role: r.role, createdAt: r.created_at })),
    published: pub ? { slug: pub.slug } : null,
  })
})

wsRouter.post('/:id/shares', access('editor'), async (req, res) => {
  requireOnline(req.ws)
  const p = safePath(req.body?.path)
  const role = req.body?.role
  if (!['editor', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role')
  const u = one('SELECT * FROM users WHERE username = ? AND disabled = 0', String(req.body?.username || '').trim())
  if (!u) throw new HttpError(404, 'No user with that username')
  if (u.id === req.user.id) throw new HttpError(400, 'You already have access')
  const rt = await getRuntime(req.ws.id)
  if (!rt.hasFile(p) || !isNote(p)) throw new HttpError(404, 'Note not found')
  run(
    'INSERT INTO note_shares (workspace_id, path, user_id, role, shared_by, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id, path, user_id) DO UPDATE SET role = excluded.role',
    req.ws.id, p, u.id, role, req.user.id, now(),
  )
  const rtDoc = rt.docs.get(p)
  if (rtDoc) for (const sock of rtDoc.conns.keys()) if (sock.user.id === u.id && !workspaceRole(u.id, req.ws.id)) rtDoc.setRole(sock, role)
  notifyUser(u.id, { t: 'shared', note: { ws: req.ws.id, path: p, by: req.user.display_name } })
  res.json({ ok: true })
})

wsRouter.delete('/:id/shares', access('editor'), (req, res) => {
  const p = safePath(req.query.path)
  const userId = String(req.query.userId || '')
  run('DELETE FROM note_shares WHERE workspace_id = ? AND path = ? AND user_id = ?', req.ws.id, p, userId)
  kickUser(req.ws.id, userId, p)
  notifyUser(userId, { t: 'shared' })
  res.json({ ok: true })
})

// ---------------- publish ----------------
wsRouter.post('/:id/publish', access('editor'), async (req, res) => {
  const p = safePath(req.body?.path)
  const rt = await getRuntime(req.ws.id)
  if (!rt.hasFile(p) || !isNote(p)) throw new HttpError(404, 'Note not found')
  let row = one('SELECT slug FROM published WHERE workspace_id = ? AND path = ?', req.ws.id, p)
  if (!row) {
    const slug = randomToken(9)
    run('INSERT INTO published (slug, workspace_id, path, created_by, created_at) VALUES (?,?,?,?,?)', slug, req.ws.id, p, req.user.id, now())
    row = { slug }
  }
  res.json({ slug: row.slug })
})

wsRouter.delete('/:id/publish', access('editor'), (req, res) => {
  const p = safePath(req.query.path)
  run('DELETE FROM published WHERE workspace_id = ? AND path = ?', req.ws.id, p)
  res.json({ ok: true })
})

// ---------------- trash ----------------
wsRouter.get('/:id/trash', access('editor'), (req, res) => {
  const rows = all(
    `SELECT t.*, u.display_name FROM trash t LEFT JOIN users u ON u.id = t.deleted_by WHERE t.workspace_id = ? ORDER BY t.deleted_at DESC`,
    req.ws.id,
  )
  res.json({ items: rows.map((r) => ({ id: r.id, path: r.original_path, kind: r.kind, deletedAt: r.deleted_at, deletedBy: r.display_name })) })
})

wsRouter.post('/:id/trash/:trashId/restore', access('editor'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  const p = await rt.restoreTrash(req.params.trashId)
  res.json({ path: p })
})

wsRouter.delete('/:id/trash/:trashId', access('owner'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  await rt.purgeTrash(req.params.trashId === 'all' ? null : req.params.trashId)
  res.json({ ok: true })
})

// ---------------- export / import ----------------
wsRouter.get('/:id/export', access('viewer'), async (req, res) => {
  const rt = await getRuntime(req.ws.id)
  await rt.lock.run(() => rt.flushDocs())
  const files = rt.getTree().filter((e) => e.type === 'file')
  // canvas layers live in .obi/ — include them so an export round-trips
  const layerFiles = (await scanDir(path.join(rt.dir, '.obi'))).filter((e) => e.type === 'file').map((e) => ({ ...e, path: `.obi/${e.path}` }))
  files.push(...layerFiles.filter((e) => isLayerPath(e.path)))
  const name = (req.ws.name || 'workspace').replace(/[^\w.-]+/g, '-')
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`)
  const zip = new Zip((err, chunk, final) => {
    if (err) return res.destroy(err)
    res.write(Buffer.from(chunk))
    if (final) res.end()
  })
  for (const f of files) {
    let buf
    try {
      buf = await fs.readFile(absPath(rt.dir, f.path))
    } catch {
      continue
    }
    const text = ['md', 'txt', 'json', 'csv', 'canvas', 'svg', 'board'].includes(extname(f.path))
    const entry = text ? new ZipDeflate(f.path, { level: 6 }) : new ZipPassThrough(f.path)
    entry.mtime = new Date(f.mtime)
    zip.add(entry)
    entry.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), true)
  }
  zip.end()
})

wsRouter.post('/:id/import', access('editor'), express.raw({ type: () => true, limit: '300mb' }), async (req, res) => {
  const folder = req.query.folder ? safePath(req.query.folder) : ''
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Empty upload')
  let entries
  try {
    entries = unzipSync(new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.byteLength))
  } catch {
    throw new HttpError(400, 'That does not look like a valid .zip file')
  }
  const allNames = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX'))
  let names = allNames.filter((n) => !n.split('/').some((s) => s.startsWith('.')))
  const layerNames = allNames.filter((n) => isLayerPath(n) || isLayerPath(n.slice(n.indexOf('/') + 1)))
  // strip a single shared top-level folder
  const tops = new Set(names.map((n) => n.split('/')[0]))
  const strip = tops.size === 1 && names.every((n) => n.includes('/'))
  const rt = await getRuntime(req.ws.id)
  let count = 0
  for (const n of names) {
    const rel = strip ? n.slice(n.indexOf('/') + 1) : n
    let p
    try {
      p = safePath(joinPath(folder, rel))
    } catch {
      continue
    }
    if (rt.tree.has(p)) p = rt.uniquePath(p)
    await rt.writeFile(p, Buffer.from(entries[n]))
    count++
  }
  // canvas layers for notes that came in with the import
  for (const n of layerNames) {
    const rel = isLayerPath(n) ? n : n.slice(n.indexOf('/') + 1)
    const note = notePathForLayer(rel)
    let target
    try {
      target = safePath(joinPath(folder, note))
    } catch {
      continue
    }
    if (!rt.hasFile(target)) continue
    const text = Buffer.from(entries[n]).toString('utf8')
    try {
      parseBoard(text)
    } catch {
      continue
    }
    await rt.importLayer(target, text)
  }
  res.json({ imported: count })
})

// ---------------- misc: shared-with-me, users ----------------
miscRouter.get('/shared', (req, res) => {
  const rows = all(
    `SELECT s.workspace_id, s.path, s.role, s.created_at, w.name AS ws_name, w.icon AS ws_icon, u.display_name AS by_name
     FROM note_shares s JOIN workspaces w ON w.id = s.workspace_id LEFT JOIN users u ON u.id = s.shared_by
     WHERE s.user_id = ? ORDER BY s.created_at DESC`,
    req.user.id,
  )
  res.json({
    notes: rows.map((r) => ({ ws: r.workspace_id, path: r.path, role: r.role, sharedAt: r.created_at, workspaceName: r.ws_name, workspaceIcon: r.ws_icon, sharedBy: r.by_name })),
  })
})

miscRouter.get('/users', (req, res) => {
  const rows = all('SELECT id, username, display_name, color FROM users WHERE disabled = 0 ORDER BY display_name COLLATE NOCASE')
  res.json({ users: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, color: r.color })) })
})

export { safeName, dirname }
