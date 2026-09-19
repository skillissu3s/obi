import express from 'express'
import { one, run, all, now, parseJSON } from './db.js'
import { verifyPassword, hashPassword, randomToken, sha256, rateLimit, resetRateLimit, newId } from './security.js'
import { SESSION_DAYS, IS_PROD, REGISTRATION, LOGIN_CODE } from './config.js'
import { publicUser, createUser, validatePassword, checkUsername } from './users.js'
import { mailEnabled } from './mail.js'
import { issueCode, checkCode, maskEmail, normEmail, EMAIL_RE } from './otp.js'
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

// What the sign-in page may offer. Open registration and emailed codes both
// need working email, so without it the server falls back to invites and
// passwords.
export const authOptions = () => ({
  registration: REGISTRATION === 'open' && !mailEnabled ? 'invite' : REGISTRATION,
  loginCode: mailEnabled ? LOGIN_CODE : 'off',
})

authRouter.get('/setup', (req, res) => {
  const count = one('SELECT COUNT(*) AS n FROM users').n
  res.json({ needsSetup: count === 0, ...authOptions() })
})

authRouter.post('/setup', async (req, res) => {
  const count = one('SELECT COUNT(*) AS n FROM users').n
  if (count > 0) throw new HttpError(403, 'Setup already completed')
  const { username, password, displayName } = req.body || {}
  const email = normEmail(req.body?.email)
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'That email address doesn’t look right')
  const user = await createUser({ username, password, displayName, email: email || null, isAdmin: true })
  await startSession(req, res, user.id)
  res.json({ user: publicUser(user) })
})

/** A user by username or email address */
export function findUser(identifier) {
  const id = String(identifier || '').trim()
  if (!id) return null
  return id.includes('@') ? one('SELECT * FROM users WHERE email = ?', normEmail(id)) : one('SELECT * FROM users WHERE username = ?', id)
}

function loginLimit(req, identifier) {
  const key = `login:${req.ip}:${String(identifier || '').toLowerCase()}`
  if (!rateLimit(key, 8, 15 * 60 * 1000) || !rateLimit(`login-ip:${req.ip}`, 40, 15 * 60 * 1000)) {
    throw new HttpError(429, 'Too many attempts. Please wait a few minutes.')
  }
  return key
}

/**
 * The password step, shared by the web sign-in and device sign-in. Returns
 * { user }, plus a ticket when this server also wants an emailed code.
 */
export async function passwordStep(req, identifier, password) {
  const key = loginLimit(req, identifier)
  const user = findUser(identifier)
  const ok = user && (await verifyPassword(String(password || ''), user.password_hash))
  if (!ok) throw new HttpError(401, 'Incorrect username, email or password')
  if (user.disabled) throw new HttpError(403, 'This account is disabled')
  resetRateLimit(key)
  if (authOptions().loginCode === 'always' && user.email_verified_at) {
    const ticket = await issueCode({ purpose: 'login2', subject: user.id, email: user.email })
    return { user, ticket }
  }
  return { user }
}

authRouter.post('/login', async (req, res) => {
  const { identifier, username, password } = req.body || {}
  const r = await passwordStep(req, identifier ?? username, password)
  if (r.ticket) return res.json({ needsCode: true, ticket: r.ticket, sentTo: maskEmail(r.user.email) })
  await startSession(req, res, r.user.id)
  res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', r.user.id)) })
})

// Signing in with a code instead of a password. The answer is the same whether
// or not the account exists, so it can't be used to find out who has one.
export async function sendLoginCode(req, identifier) {
  if (authOptions().loginCode !== 'either') throw new HttpError(400, 'Sign-in codes are not enabled on this server')
  loginLimit(req, `code:${identifier}`)
  const user = findUser(identifier)
  if (user && !user.disabled && user.email_verified_at) {
    return issueCode({ purpose: 'login', subject: user.id, email: user.email, background: true })
  }
  return newId(24)
}

authRouter.post('/login/code', async (req, res) => {
  const ticket = await sendLoginCode(req, req.body?.identifier)
  res.json({ ticket })
})

/** Finishes a code sign-in (either kind) and returns the user */
export function codeStep(req, ticket, code) {
  if (!rateLimit(`code-ip:${req.ip}`, 30, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.')
  const row = checkCode(ticket, code, ['login', 'login2'])
  const user = one('SELECT * FROM users WHERE id = ?', row.subject)
  if (!user) throw new HttpError(400, 'That code is wrong or has expired')
  if (user.disabled) throw new HttpError(403, 'This account is disabled')
  return user
}

authRouter.post('/login/code/verify', async (req, res) => {
  const user = codeStep(req, req.body?.ticket, req.body?.code)
  await startSession(req, res, user.id)
  res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', user.id)) })
})

// ---- Open registration: email + username + password, then an emailed code.
// Until the code comes back the sign-up waits in pending_signups.

const PENDING_TTL = 60 * 60 * 1000

authRouter.post('/register', async (req, res) => {
  if (authOptions().registration !== 'open') throw new HttpError(403, 'Registration is closed on this server')
  if (!rateLimit(`register:${req.ip}`, 10, 60 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait a while.')
  const { password, displayName } = req.body || {}
  const email = normEmail(req.body?.email)
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address doesn’t look right')
  const username = checkUsername(req.body?.username)
  validatePassword(password)
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with that email already exists — sign in instead')
  const t = now()
  run('DELETE FROM pending_signups WHERE expires_at < ? OR email = ?', t, email)
  if (one('SELECT id FROM pending_signups WHERE username = ?', username)) throw new HttpError(409, 'That username is taken')
  const id = newId(24)
  run(
    'INSERT INTO pending_signups (id, email, username, display_name, password_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?)',
    id, email, username, String(displayName || username).trim().slice(0, 64) || username, await hashPassword(password), t, t + PENDING_TTL,
  )
  try {
    const ticket = await issueCode({ purpose: 'signup', subject: id, email })
    res.json({ ticket, sentTo: maskEmail(email) })
  } catch (e) {
    run('DELETE FROM pending_signups WHERE id = ?', id)
    throw e
  }
})

/** Turns a confirmed sign-up into an account */
export async function registerStep(req, ticket, code) {
  if (!rateLimit(`code-ip:${req.ip}`, 30, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.')
  const row = checkCode(ticket, code, ['signup'])
  const p = one('SELECT * FROM pending_signups WHERE id = ?', row.subject)
  if (!p || p.expires_at < now()) throw new HttpError(400, 'This sign-up has expired. Please start again.')
  run('DELETE FROM pending_signups WHERE id = ?', p.id)
  return createUser({ username: p.username, displayName: p.display_name, passwordHash: p.password_hash, email: p.email, emailVerified: true })
}

authRouter.post('/register/verify', async (req, res) => {
  const user = await registerStep(req, req.body?.ticket, req.body?.code)
  await startSession(req, res, user.id)
  res.json({ user: publicUser(user) })
})

// A fresh code for a sign-up, a code sign-in or an email change
authRouter.post('/code/resend', async (req, res) => {
  if (!rateLimit(`resend:${req.ip}`, 6, 15 * 60 * 1000)) throw new HttpError(429, 'Too many emails. Please wait a few minutes.')
  const row = one('SELECT * FROM otp_codes WHERE id = ?', String(req.body?.ticket || ''))
  // an unknown ticket (no such account) gets a new, equally useless one
  if (!row || !row.email) return res.json({ ticket: newId(24) })
  if (row.purpose === 'signup' && !one('SELECT id FROM pending_signups WHERE id = ? AND expires_at > ?', row.subject, now())) {
    throw new HttpError(400, 'This sign-up has expired. Please start again.')
  }
  const ticket = await issueCode({ purpose: row.purpose, subject: row.subject, email: row.email })
  res.json({ ticket })
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

// Adding or changing the account's email, confirmed by a code sent to it
authRouter.post('/email', requireAuth, async (req, res) => {
  if (!mailEnabled) throw new HttpError(400, 'Email is not configured on this server')
  const email = normEmail(req.body?.email)
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address doesn’t look right')
  if (!(await verifyPassword(String(req.body?.password || ''), req.user.password_hash))) throw new HttpError(400, 'Password is incorrect')
  const other = one('SELECT id FROM users WHERE email = ?', email)
  if (other && other.id !== req.user.id) throw new HttpError(409, 'Another account already uses that email')
  if (!rateLimit(`email:${req.user.id}`, 6, 60 * 60 * 1000)) throw new HttpError(429, 'Too many emails. Please wait a while.')
  const ticket = await issueCode({ purpose: 'email', subject: req.user.id, email })
  res.json({ ticket, sentTo: maskEmail(email) })
})

authRouter.post('/email/verify', requireAuth, (req, res) => {
  const row = checkCode(req.body?.ticket, req.body?.code, ['email'])
  if (row.subject !== req.user.id) throw new HttpError(400, 'That code is wrong or has expired')
  const other = one('SELECT id FROM users WHERE email = ?', row.email)
  if (other && other.id !== req.user.id) throw new HttpError(409, 'Another account already uses that email')
  run('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?', row.email, now(), req.user.id)
  res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', req.user.id)) })
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
