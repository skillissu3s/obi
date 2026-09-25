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

// ---- app tokens: the desktop app signs in once per device and keeps a token
const TOKEN_PREFIX = 'obi_'

export function issueApiToken(req, userId, name) {
  const token = TOKEN_PREFIX + randomToken()
  const t = now()
  run('INSERT INTO api_tokens (id, user_id, name, created_at, last_used_at, ip) VALUES (?,?,?,?,?,?)', sha256(token), userId, String(name || 'App').slice(0, 80), t, t, req.ip)
  run('UPDATE users SET last_login_at = ? WHERE id = ?', t, userId)
  return token
}

function bearerToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')
  return m && m[1].startsWith(TOKEN_PREFIX) ? m[1] : null
}

export function userFromToken(token) {
  const id = sha256(token)
  const row = one('SELECT * FROM api_tokens WHERE id = ?', id)
  if (!row) return null
  const user = one('SELECT * FROM users WHERE id = ?', row.user_id)
  if (!user || user.disabled) return null
  const t = now()
  if (t - row.last_used_at > 5 * 60 * 1000) run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', t, id)
  user.tokenId = id
  return user
}

export function userFromRequest(req) {
  const token = bearerToken(req)
  return token ? userFromToken(token) : userFromCookieHeader(req.headers.cookie)
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req)
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
  // a bearer token is never sent by a browser on its own, so it can't be forged cross-site
  if (bearerToken(req)) return next()
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
  // a forgotten password can be reset by email wherever email works, even if
  // signing in with a code is switched off
  canReset: mailEnabled,
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
  // an administrator signs in with email, password and a code, so the address
  // is part of creating the account, not an afterthought
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'An email address is required — it is how you will sign in')
  const user = await createUser({ username, password, displayName, email, emailVerified: true, isAdmin: true })
  await startSession(req, res, user.id)
  res.json({ user: publicUser(user) })
})

/**
 * The account with this email address. Signing in is by email only: a username
 * is a handle other people see, not a way in.
 */
export function findUser(identifier) {
  const email = normEmail(identifier)
  if (!email || !email.includes('@')) return null
  return one('SELECT * FROM users WHERE email = ?', email)
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
  if (!ok) throw new HttpError(401, 'Incorrect email or password')
  if (user.disabled) throw new HttpError(403, 'This account is disabled')
  resetRateLimit(key)
  // An administrator always finishes with a code: the password alone opens the
  // admin console. (Their address is on file even if never confirmed —
  // receiving the code is what confirms it.)
  const mustCode = user.is_admin || authOptions().loginCode === 'always'
  if (mustCode && user.email) {
    if (!mailEnabled) throw new HttpError(503, 'This server cannot send the sign-in code it needs. Configure email and try again.')
    const ticket = await issueCode({ purpose: 'login2', subject: user.id, email: user.email })
    return { user, ticket }
  }
  if (user.is_admin) throw new HttpError(403, 'This administrator account has no email address, so it cannot sign in. Set ADMIN_EMAIL and restart.')
  return { user }
}

/**
 * Every sign-in ends here. A browser gets a session cookie; an app that says
 * which device it is (body.device) gets a token to keep instead.
 */
async function signedIn(req, res, userId) {
  const user = publicUser(one('SELECT * FROM users WHERE id = ?', userId))
  const device = typeof req.body?.device === 'string' && req.body.device.trim()
  if (device) return res.json({ user, token: issueApiToken(req, userId, device) })
  await startSession(req, res, userId)
  res.json({ user })
}

authRouter.post('/login', async (req, res) => {
  const { identifier, username, password } = req.body || {}
  const r = await passwordStep(req, identifier ?? username, password)
  if (r.ticket) return res.json({ needsCode: true, ticket: r.ticket, sentTo: maskEmail(r.user.email) })
  await signedIn(req, res, r.user.id)
})

// Signing in with a code instead of a password. The answer is the same whether
// or not the account exists, so it can't be used to find out who has one.
export async function sendLoginCode(req, identifier) {
  if (authOptions().loginCode !== 'either') throw new HttpError(400, 'Sign-in codes are not enabled on this server')
  loginLimit(req, `code:${identifier}`)
  const user = findUser(identifier)
  // administrators need their password too, so no code is sent for them
  if (user && !user.disabled && user.email_verified_at && !user.is_admin) {
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
  // reading the code proves the address works
  if (!user.email_verified_at && row.email && row.email === user.email) run('UPDATE users SET email_verified_at = ? WHERE id = ?', now(), user.id)
  return user
}

authRouter.post('/login/code/verify', async (req, res) => {
  const user = codeStep(req, req.body?.ticket, req.body?.code)
  await signedIn(req, res, user.id)
})

// ---- a forgotten password. The answer never says whether the account
// exists; the code goes to the address on file.

authRouter.post('/password/reset', async (req, res) => {
  if (!mailEnabled) throw new HttpError(400, 'This server cannot send email — ask an administrator to reset your password')
  const identifier = req.body?.identifier
  loginLimit(req, `reset:${identifier}`)
  const user = findUser(identifier)
  const ticket =
    user && !user.disabled && user.email_verified_at
      ? await issueCode({ purpose: 'reset', subject: user.id, email: user.email, background: true })
      : newId(24)
  res.json({ ticket })
})

authRouter.post('/password/reset/verify', async (req, res) => {
  if (!rateLimit(`code-ip:${req.ip}`, 30, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.')
  const password = req.body?.password
  validatePassword(password)
  const row = checkCode(req.body?.ticket, req.body?.code, ['reset'])
  const user = one('SELECT * FROM users WHERE id = ?', row.subject)
  if (!user) throw new HttpError(400, 'That code is wrong or has expired')
  if (user.disabled) throw new HttpError(403, 'This account is disabled')
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashPassword(password), user.id)
  // whoever knew the old password (or was signed in with it) is signed out
  revokeUserSessions(user.id)
  await signedIn(req, res, user.id)
})

// ---- Open registration: email + username + password, then an emailed code.
// Until the code comes back the sign-up waits in pending_signups.

const PENDING_TTL = 60 * 60 * 1000

/** Checks a new account over, parks it, and emails the code that confirms it */
export async function startRegistration(req, { email: rawEmail, username: rawUsername, password, displayName, inviteHash = null }) {
  const email = normEmail(rawEmail)
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address doesn’t look right')
  const username = checkUsername(rawUsername)
  validatePassword(password)
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with that email already exists — sign in instead')
  const t = now()
  run('DELETE FROM pending_signups WHERE expires_at < ? OR email = ?', t, email)
  if (one('SELECT id FROM pending_signups WHERE username = ?', username)) throw new HttpError(409, 'That username is taken')
  const id = newId(24)
  run(
    'INSERT INTO pending_signups (id, email, username, display_name, password_hash, created_at, expires_at, invite_hash) VALUES (?,?,?,?,?,?,?,?)',
    id, email, username, String(displayName || username).trim().slice(0, 64) || username, await hashPassword(password), t, t + PENDING_TTL, inviteHash,
  )
  try {
    return { ticket: await issueCode({ purpose: 'signup', subject: id, email }), sentTo: maskEmail(email) }
  } catch (e) {
    run('DELETE FROM pending_signups WHERE id = ?', id)
    throw e
  }
}

authRouter.post('/register', async (req, res) => {
  if (authOptions().registration !== 'open') throw new HttpError(403, 'Registration is closed on this server')
  if (!rateLimit(`register:${req.ip}`, 10, 60 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait a while.')
  res.json(await startRegistration(req, req.body || {}))
})

/** Turns a confirmed sign-up into an account */
export async function registerStep(req, ticket, code) {
  if (!rateLimit(`code-ip:${req.ip}`, 30, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.')
  const row = checkCode(ticket, code, ['signup'])
  const p = one('SELECT * FROM pending_signups WHERE id = ?', row.subject)
  if (!p || p.expires_at < now()) throw new HttpError(400, 'This sign-up has expired. Please start again.')
  run('DELETE FROM pending_signups WHERE id = ?', p.id)
  const invite = p.invite_hash && one('SELECT * FROM invites WHERE token_hash = ?', p.invite_hash)
  if (p.invite_hash && (!invite || invite.used_by || invite.expires_at < now())) throw new HttpError(403, 'This invite link is invalid or has expired')
  const user = await createUser({ username: p.username, displayName: p.display_name, passwordHash: p.password_hash, email: p.email, emailVerified: true })
  if (invite) run('UPDATE invites SET used_by = ?, used_at = ? WHERE token_hash = ?', user.id, now(), invite.token_hash)
  return user
}

authRouter.post('/register/verify', async (req, res) => {
  const user = await registerStep(req, req.body?.ticket, req.body?.code)
  await signedIn(req, res, user.id)
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

// An invite is a pre-approved registration: same email, password and code as
// everyone else, with the invite spent once the code comes back.
authRouter.post('/signup', async (req, res) => {
  const { invite, password, displayName } = req.body || {}
  if (!rateLimit(`signup:${req.ip}`, 10, 60 * 60 * 1000)) throw new HttpError(429, 'Too many attempts')
  if (!mailEnabled) throw new HttpError(503, 'This server cannot send the confirmation email it needs')
  const hash = sha256(String(invite || ''))
  const inv = one('SELECT * FROM invites WHERE token_hash = ?', hash)
  if (!inv || inv.used_by || inv.expires_at < now()) throw new HttpError(403, 'This invite link is invalid or has expired')
  const { ticket, sentTo } = await startRegistration(req, { ...(req.body || {}), inviteHash: hash })
  res.json({ ticket, sentTo })
})

authRouter.post('/logout', (req, res) => {
  const user = userFromRequest(req)
  if (user?.tokenId) {
    run('DELETE FROM api_tokens WHERE id = ?', user.tokenId)
    return res.json({ ok: true })
  }
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
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.sessionId || '')
  run('DELETE FROM api_tokens WHERE user_id = ? AND id != ?', req.user.id, req.user.tokenId || '')
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
  const apps = all('SELECT id, name, created_at, last_used_at, ip FROM api_tokens WHERE user_id = ? ORDER BY last_used_at DESC', req.user.id)
  res.json({
    sessions: [
      ...rows.map((r) => ({ ...r, id: r.id.slice(0, 12), current: r.id === req.user.sessionId })),
      ...apps.map((a) => ({ id: a.id.slice(0, 12), app: a.name, created_at: a.created_at, last_seen_at: a.last_used_at, ip: a.ip, current: a.id === req.user.tokenId })),
    ],
  })
})

authRouter.post('/sessions/revoke-others', requireAuth, (req, res) => {
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.user.sessionId || '')
  run('DELETE FROM api_tokens WHERE user_id = ? AND id != ?', req.user.id, req.user.tokenId || '')
  res.json({ ok: true })
})

export function revokeUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId)
  run('DELETE FROM api_tokens WHERE user_id = ?', userId)
  disconnectUser(userId)
}
