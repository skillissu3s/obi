import express from 'express'
import { one, run, all, now, parseJSON } from './db.js'
import { verifyPassword, hashPassword, randomToken, sha256, rateLimit, resetRateLimit } from './security.js'
import { SESSION_DAYS, IS_PROD } from './config.js'
import { publicUser, createUser, validatePassword } from './users.js'
import { HttpError } from './fsutil.js'
import { disconnectUser } from './hub.js'

const COOKIE = 'obi_session'
const DAY = 86400000

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

export function userFromCookieHeader(header) {
  const token = parseCookies(header)[COOKIE]
  if (!token) return null
  const id = sha256(token)
  const s = one('SELECT * FROM sessions WHERE id = ?', id)
  if (!s) return null
  const t = now()
  if (s.expires_at < t) {
    run('DELETE FROM sessions WHERE id = ?', id)
    return null
  }
  const user = one('SELECT * FROM users WHERE id = ?', s.user_id)
  if (!user || user.disabled) return null
  if (t - s.last_seen_at > 5 * 60 * 1000) {
    run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', t, t + SESSION_DAYS * DAY, id)
  }
  user.sessionId = id
  return user
}

function setSessionCookie(req, res, token) {
  const secure = req.secure || (IS_PROD && req.headers['x-forwarded-proto'] === 'https')
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * DAY, path: '/' })
}

export async function startSession(req, res, userId) {
  const token = randomToken()
  const t = now()
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)',
    sha256(token), userId, t, t + SESSION_DAYS * DAY, t, String(req.headers['user-agent'] || '').slice(0, 300), req.ip,
  )
  run('UPDATE users SET last_login_at = ? WHERE id = ?', t, userId)
  setSessionCookie(req, res, token)
}

export function requireAuth(req, res, next) {
  const user = userFromCookieHeader(req.headers.cookie)
  if (!user) return res.status(401).json({ error: 'Not signed in' })
  req.user = user
  next()
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' })
    next()
  })
}

// Mutating API calls must carry a custom header (blocks cross-site form posts)
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (req.headers['x-obi'] !== '1') return res.status(403).json({ error: 'Missing request header' })
  next()
}

export const authRouter = express.Router()

authRouter.get('/setup', (req, res) => {
  const count = one('SELECT COUNT(*) AS n FROM users').n
  res.json({ needsSetup: count === 0 })
})

authRouter.post('/setup', async (req, res) => {
  const count = one('SELECT COUNT(*) AS n FROM users').n
  if (count > 0) throw new HttpError(403, 'Setup already completed')
  const { username, password, displayName } = req.body || {}
  const user = await createUser({ username, password, displayName, isAdmin: true })
  await startSession(req, res, user.id)
  res.json({ user: publicUser(user) })
})

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {}
  const key = `login:${req.ip}:${String(username || '').toLowerCase()}`
  if (!rateLimit(key, 8, 15 * 60 * 1000) || !rateLimit(`login-ip:${req.ip}`, 40, 15 * 60 * 1000)) {
    throw new HttpError(429, 'Too many attempts. Please wait a few minutes.')
  }
  const user = one('SELECT * FROM users WHERE username = ?', String(username || '').trim())
  const ok = user && (await verifyPassword(String(password || ''), user.password_hash))
  if (!ok) throw new HttpError(401, 'Incorrect username or password')
  if (user.disabled) throw new HttpError(403, 'This account is disabled')
  resetRateLimit(key)
  await startSession(req, res, user.id)
  res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', user.id)) })
})

authRouter.get('/invite/:token', (req, res) => {
  const inv = one('SELECT * FROM invites WHERE token_hash = ?', sha256(req.params.token))
  if (!inv || inv.used_by || inv.expires_at < now()) throw new HttpError(404, 'This invite link is invalid or has expired')
  res.json({ ok: true, note: inv.note })
})

authRouter.post('/signup', async (req, res) => {
  const { invite, username, password, displayName } = req.body || {}
  if (!rateLimit(`signup:${req.ip}`, 10, 60 * 60 * 1000)) throw new HttpError(429, 'Too many attempts')
  const hash = sha256(String(invite || ''))
  const inv = one('SELECT * FROM invites WHERE token_hash = ?', hash)
  if (!inv || inv.used_by || inv.expires_at < now()) throw new HttpError(403, 'This invite link is invalid or has expired')
  const user = await createUser({ username, password, displayName })
  run('UPDATE invites SET used_by = ?, used_at = ? WHERE token_hash = ?', user.id, now(), hash)
  await startSession(req, res, user.id)
  res.json({ user: publicUser(user) })
})

authRouter.post('/logout', (req, res) => {
  const user = userFromCookieHeader(req.headers.cookie)
  if (user) run('DELETE FROM sessions WHERE id = ?', user.sessionId)
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

authRouter.patch('/me', requireAuth, (req, res) => {
  const { displayName, color, settings } = req.body || {}
  if (displayName != null) {
    const d = String(displayName).trim().slice(0, 64)
    if (!d) throw new HttpError(400, 'Display name cannot be empty')
    run('UPDATE users SET display_name = ? WHERE id = ?', d, req.user.id)
  }
  if (color != null && /^#[0-9a-f]{6}$/i.test(color)) run('UPDATE users SET color = ? WHERE id = ?', color, req.user.id)
  if (settings && typeof settings === 'object') {
    const merged = { ...parseJSON(req.user.settings), ...settings }
    const json = JSON.stringify(merged)
    if (json.length > 200000) throw new HttpError(400, 'Settings too large')
    run('UPDATE users SET settings = ? WHERE id = ?', json, req.user.id)
  }
  res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', req.user.id)) })
})

authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {}
  if (!(await verifyPassword(String(current || ''), req.user.password_hash))) throw new HttpError(400, 'Current password is incorrect')
  validatePassword(next)
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashPassword(next), req.user.id)
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.sessionId)
  res.json({ ok: true })
})

authRouter.get('/sessions', requireAuth, (req, res) => {
  const rows = all('SELECT id, created_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', req.user.id)
  res.json({ sessions: rows.map((r) => ({ ...r, id: r.id.slice(0, 12), current: r.id === req.user.sessionId })) })
})

authRouter.post('/sessions/revoke-others', requireAuth, (req, res) => {
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.sessionId)
  res.json({ ok: true })
})

export function revokeUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId)
  disconnectUser(userId)
}
