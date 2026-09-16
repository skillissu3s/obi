import fs from 'node:fs/promises'
import path from 'node:path'
import { one, run, now, parseJSON, tx } from './db.js'
import { hashPassword, newId, randomColor } from './security.js'
import { workspaceDir } from './runtime.js'
import { HttpError } from './fsutil.js'
import { WELCOME_NOTES } from './welcome.js'

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/

export function publicUser(u) {
  if (!u) return null
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    color: u.color,
    isAdmin: !!u.is_admin,
    mustChangePassword: !!u.must_change_password,
    settings: parseJSON(u.settings),
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    disabled: !!u.disabled,
  }
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
  if (pw.length > 256) throw new HttpError(400, 'Password is too long')
}

export async function createUser({ username, displayName, password, isAdmin = false, mustChangePassword = false }) {
  username = String(username || '').trim()
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username must be 2–32 characters: letters, numbers, dot, dash, underscore')
  validatePassword(password)
  if (one('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is taken')
  const id = newId()
  const hash = await hashPassword(password)
  const t = now()
  tx(() => {
    run(
      'INSERT INTO users (id, username, display_name, password_hash, is_admin, must_change_password, color, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, username, String(displayName || username).trim().slice(0, 64) || username, hash, isAdmin ? 1 : 0, mustChangePassword ? 1 : 0, randomColor(), t,
    )
  })
  await createOnlineWorkspace({ ownerId: id, name: 'Personal', icon: '🌱', isDefault: true, welcome: true })
  return one('SELECT * FROM users WHERE id = ?', id)
}

export async function createOnlineWorkspace({ ownerId, name, icon = '', isDefault = false, welcome = false }) {
  const id = newId()
  const t = now()
  tx(() => {
    run('INSERT INTO workspaces (id, name, type, owner_id, icon, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, name, 'online', ownerId, icon, isDefault ? 1 : 0, t, t)
    run('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?,?,?,?)', id, ownerId, 'owner', t)
  })
  const dir = workspaceDir(id)
  await fs.mkdir(dir, { recursive: true })
  if (welcome) {
    for (const [rel, content] of Object.entries(WELCOME_NOTES)) {
      const abs = path.join(dir, ...rel.split('/'))
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content)
    }
  }
  return id
}
