import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { one, all, run, now } from './db.js'
import { hashPassword, randomToken, sha256 } from './security.js'
import { publicUser, createUser, validatePassword } from './users.js'
import { requireAdmin, revokeUserSessions } from './auth.js'
import { HttpError } from './fsutil.js'
import { disposeRuntime, peekRuntime, workspaceDir } from './runtime.js'
import { onlineUserIds } from './hub.js'
import { repoLabel } from './git.js'
import { storageReport } from './storage.js'
import { EMAIL_RE } from './otp.js'
import { DATA_DIR } from './config.js'

export const adminRouter = express.Router()
adminRouter.use(requireAdmin)

adminRouter.get('/overview', (req, res) => {
  const online = onlineUserIds()
  const users = all('SELECT * FROM users ORDER BY created_at ASC').map((u) => ({
    ...publicUser(u),
    settings: undefined,
    online: online.has(u.id),
    workspaceCount: one('SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?', u.id).n,
    // how they are reachable, and what is signed in as them
    sessionCount: one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', u.id, now()).n,
    devices: all('SELECT name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY last_used_at DESC', u.id).map((d) => ({
      name: d.name,
      createdAt: d.created_at,
      lastUsedAt: d.last_used_at,
    })),
  }))
  const workspaces = all(
    `SELECT w.*, u.username AS owner_username, u.display_name AS owner_name,
      (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS member_count
     FROM workspaces w JOIN users u ON u.id = w.owner_id ORDER BY w.created_at DESC`,
  ).map((w) => {
    const rt = peekRuntime(w.id)
    return {
      id: w.id,
      name: w.name,
      icon: w.icon,
      type: w.type,
      owner: { id: w.owner_id, username: w.owner_username, name: w.owner_name },
      repo: w.github_repo ? repoLabel(w.github_repo) : null,
      branch: w.github_branch,
      memberCount: w.member_count,
      createdAt: w.created_at,
      lastSync: w.last_sync_at,
      syncError: w.sync_error,
      loaded: !!rt,
      noteCount: rt ? rt.meta.size : null,
      liveDocs: rt ? rt.docs.size : 0,
      dir: w.dir || null,
      bytes: workspaceBytes(w.id),
    }
  })
  const invites = all(
    `SELECT i.*, u.username AS used_by_username FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 50`,
  ).map((i) => ({ id: i.token_hash.slice(0, 16), note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, usedBy: i.used_by_username, usedAt: i.used_at }))
  res.json({
    users,
    workspaces,
    invites,
    stats: {
      users: users.length,
      online: online.size,
      workspaces: workspaces.length,
      github: workspaces.filter((w) => w.type === 'github').length,
      sessions: one('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', now()).n,
      publishedNotes: one('SELECT COUNT(*) AS n FROM published').n,
      // who is actually using it, not just who signed up once
      newUsers7: since('users', 'created_at', 7),
      newUsers30: since('users', 'created_at', 30),
      active7: since('users', 'last_login_at', 7),
      active30: since('users', 'last_login_at', 30),
      unconfirmed: one('SELECT COUNT(*) AS n FROM users WHERE email IS NULL OR email_verified_at IS NULL').n,
      pendingSignups: one('SELECT COUNT(*) AS n FROM pending_signups WHERE expires_at > ?', now()).n,
      devices: one('SELECT COUNT(*) AS n FROM api_tokens').n,
      notes: workspaces.reduce((n, w) => n + (w.noteCount || 0), 0),
      uptime: process.uptime(),
      memory: process.memoryUsage().rss,
    },
    trend: trend(30),
    storage: storageReport(DATA_DIR),
  })
})

/** How many accounts have this timestamp inside the last `days` */
function since(table, column, days) {
  return one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} > ?`, now() - days * 86400000).n
}

/** Sign-ups and sign-ins per day, oldest first — enough for a sparkline */
function trend(days) {
  const day = 86400000
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const from = start.getTime() - i * day
    const to = from + day
    out.push({
      day: new Date(from).toISOString().slice(0, 10),
      signups: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?', from, to).n,
      active: one('SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ? AND last_login_at < ?', from, to).n,
    })
  }
  return out
}

// Folder sizes are the slow part of this page, so they are measured at most
// once a minute and reused in between.
const sizeCache = new Map()
function workspaceBytes(id) {
  const hit = sizeCache.get(id)
  if (hit && now() - hit.at < 60 * 1000) return hit.bytes
  let bytes = 0
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        try {
          bytes += fs.statSync(full).size
        } catch {}
      }
    }
  }
  walk(workspaceDir(id))
  sizeCache.set(id, { at: now(), bytes })
  return bytes
}

// lightweight check the app shell uses to warn admins about non-persistent storage
adminRouter.get('/storage', (req, res) => {
  res.json({ storage: storageReport(DATA_DIR) })
})

adminRouter.post('/users', async (req, res) => {
  const { username, displayName, password, isAdmin, mustChangePassword } = req.body || {}
  // people sign in with an email address, so an account without one is a dead
  // end. An admin setting it is taken as vouching for it.
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'An email address is required — it is how they will sign in')
  const user = await createUser({ username, displayName, password, email, emailVerified: true, isAdmin: !!isAdmin, mustChangePassword: !!mustChangePassword })
  res.json({ user: publicUser(user) })
})

adminRouter.patch('/users/:id', async (req, res) => {
  const target = one('SELECT * FROM users WHERE id = ?', req.params.id)
  if (!target) throw new HttpError(404, 'User not found')
  const { displayName, isAdmin, disabled, password, mustChangePassword } = req.body || {}
  const self = target.id === req.user.id
  if (displayName != null) run('UPDATE users SET display_name = ? WHERE id = ?', String(displayName).trim().slice(0, 64) || target.username, target.id)
  if (isAdmin != null) {
    if (self && !isAdmin) throw new HttpError(400, 'You cannot remove your own admin access')
    run('UPDATE users SET is_admin = ? WHERE id = ?', isAdmin ? 1 : 0, target.id)
  }
  if (disabled != null) {
    if (self && disabled) throw new HttpError(400, 'You cannot disable your own account')
    run('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, target.id)
    if (disabled) revokeUserSessions(target.id)
  }
  if (password) {
    validatePassword(password)
    run('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', await hashPassword(password), mustChangePassword ? 1 : 0, target.id)
    if (!self) revokeUserSessions(target.id)
  } else if (mustChangePassword != null) {
    run('UPDATE users SET must_change_password = ? WHERE id = ?', mustChangePassword ? 1 : 0, target.id)
  }
  res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', target.id)) })
})

adminRouter.delete('/users/:id', async (req, res) => {
  const target = one('SELECT * FROM users WHERE id = ?', req.params.id)
  if (!target) throw new HttpError(404, 'User not found')
  if (target.id === req.user.id) throw new HttpError(400, 'You cannot delete your own account')
  revokeUserSessions(target.id)
  const owned = all('SELECT id FROM workspaces WHERE owner_id = ?', target.id)
  for (const w of owned) await disposeRuntime(w.id, { removeFiles: true })
  run('DELETE FROM users WHERE id = ?', target.id)
  res.json({ ok: true })
})

adminRouter.post('/invites', (req, res) => {
  const { note, days } = req.body || {}
  const token = randomToken(24)
  const d = Math.min(Math.max(Number(days) || 7, 1), 90)
  run('INSERT INTO invites (token_hash, created_by, note, created_at, expires_at) VALUES (?,?,?,?,?)', sha256(token), req.user.id, String(note || '').slice(0, 120), now(), now() + d * 86400000)
  res.json({ token, expiresAt: now() + d * 86400000 })
})

adminRouter.delete('/invites/:id', (req, res) => {
  run("DELETE FROM invites WHERE substr(token_hash, 1, 16) = ?", req.params.id)
  res.json({ ok: true })
})

adminRouter.delete('/workspaces/:id', async (req, res) => {
  const w = one('SELECT * FROM workspaces WHERE id = ?', req.params.id)
  if (!w) throw new HttpError(404, 'Workspace not found')
  await disposeRuntime(w.id, { removeFiles: true })
  run('DELETE FROM workspaces WHERE id = ?', w.id)
  res.json({ ok: true })
})
