// The cloud end of desktop sync. The desktop app keeps each workspace as a
// folder and reconciles it file by file:
//
//   GET    /api/sync/workspaces              workspaces this account can sync
//   POST   /api/sync/workspaces              a new, empty cloud workspace
//   GET    /api/sync/:id/state               { rev } — cheap "anything new?"
//   GET    /api/sync/:id/manifest            { rev, files: { path: sha256 } }
//   GET    /api/sync/:id/file?path=          the bytes (ETag: sha256)
//   PUT    /api/sync/:id/file?path=          write, If-Match: <sha256> | If-None-Match: *
//   DELETE /api/sync/:id/file?path=          delete, If-Match: <sha256>
//
// Writes are conditional, so a device can never overwrite a change it hasn't
// seen: on 412 it fetches the current file, merges and tries again. Every write
// goes through the workspace runtime, which keeps version history and moves
// deleted notes to the trash — nothing a device sends can lose data for good.
import express from 'express'
import { one, all } from './db.js'
import { requireAuth } from './auth.js'
import { workspaceRole, hasRank } from './access.js'
import { getRuntime } from './runtime.js'
import { createOnlineWorkspace } from './users.js'
import { HttpError, safePath } from './fsutil.js'
import { MAX_UPLOAD_MB } from './config.js'
import { isSyncPath, hashBytes, HashCache, readSynced, writeSynced, deleteSynced } from './syncfiles.js'

export const syncRouter = express.Router()
syncRouter.use(requireAuth)

const caches = new Map() // workspace id -> HashCache
const cacheFor = (id) => caches.get(id) || caches.set(id, new HashCache()).get(id)

async function load(req, min) {
  const role = workspaceRole(req.user.id, req.params.id)
  if (!hasRank(role, min)) throw new HttpError(role ? 403 : 404, role ? 'You do not have permission to do that' : 'Workspace not found')
  return getRuntime(req.params.id)
}

function syncPath(q) {
  const p = safePath(q, { allowHidden: true })
  if (!isSyncPath(p)) throw new HttpError(400, 'This path is not synced')
  return p
}

const serialize = (w) => ({ id: w.id, name: w.name, icon: w.icon, type: w.type, role: w.role, updatedAt: w.updated_at })

syncRouter.get('/workspaces', (req, res) => {
  const rows = all(
    'SELECT w.*, m.role FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.is_default DESC, w.created_at ASC',
    req.user.id,
  )
  res.json({ workspaces: rows.map(serialize) })
})

syncRouter.post('/workspaces', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80)
  if (!name) throw new HttpError(400, 'Name is required')
  const id = await createOnlineWorkspace({ ownerId: req.user.id, name, icon: String(req.body?.icon || '').slice(0, 16) })
  res.json({ workspace: serialize({ ...one('SELECT * FROM workspaces WHERE id = ?', id), role: 'owner' }) })
})

syncRouter.get('/:id/state', async (req, res) => {
  const rt = await load(req, 'viewer')
  res.json({ rev: `${rt.bootId}:${rt.rev}` })
})

syncRouter.get('/:id/manifest', async (req, res) => {
  const rt = await load(req, 'viewer')
  await rt.lock.run(() => rt.flushDocs())
  const rev = `${rt.bootId}:${rt.rev}`
  res.json({ rev, files: await cacheFor(rt.id).manifest(rt.dir) })
})

syncRouter.get('/:id/file', async (req, res) => {
  const rt = await load(req, 'viewer')
  const buf = await readSynced(rt, syncPath(req.query.path))
  if (!buf) throw new HttpError(404, 'Not found')
  res.setHeader('ETag', `"${hashBytes(buf)}"`)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-store')
  res.end(buf)
})

const unquote = (h) => String(h || '').trim().replace(/^W\//, '').replace(/^"|"$/g, '')

// the file must still be what the device last saw
async function precondition(req, rt, p) {
  const cur = await readSynced(rt, p)
  const hash = cur ? hashBytes(cur) : null
  const ifMatch = unquote(req.headers['if-match'])
  const ifNone = unquote(req.headers['if-none-match'])
  const ok = ifNone === '*' ? !hash : ifMatch ? ifMatch === hash : false
  if (!ok) {
    const e = new HttpError(412, hash ? 'The file changed on the server' : 'The file no longer exists on the server')
    e.body = { hash }
    throw e
  }
  return hash
}

const raw = express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` })

syncRouter.put('/:id/file', raw, async (req, res) => {
  const rt = await load(req, 'editor')
  const p = syncPath(req.query.path)
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  await precondition(req, rt, p)
  await writeSynced(rt, p, buf, { userId: req.user.id })
  res.json({ hash: hashBytes(buf), rev: `${rt.bootId}:${rt.rev}` })
})

syncRouter.delete('/:id/file', async (req, res) => {
  const rt = await load(req, 'editor')
  const p = syncPath(req.query.path)
  if (await precondition(req, rt, p)) await deleteSynced(rt, p, { userId: req.user.id })
  res.json({ ok: true, rev: `${rt.bootId}:${rt.rev}` })
})
