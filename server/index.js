import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import compression from 'compression'
import { PORT, HOST, DATA_DIR, IS_PROD, APP_NAME, DESKTOP } from './config.js'
import { one, all, run, now } from './db.js'
import { authRouter, csrfGuard, userFromCookieHeader } from './auth.js'
import { adminRouter } from './admin.js'
import { wsRouter, miscRouter } from './workspaces.js'
import { publicRouter } from './public.js'
import { syncRouter } from './syncapi.js'
import { downloadRouter } from './download.js'
import { desktopRouter, startDesktop, DESKTOP_WEB, desktopWebRouter } from './desktop.js'
import { attachWebSocket } from './wsserver.js'
import { shutdownAll, workspaceDir, trashCompanions } from './runtime.js'
import { createUser } from './users.js'
import { hashPassword } from './security.js'
import { warnIfEphemeral, dataCreatedAt } from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')

const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})

app.use(
  compression({
    filter: (req, res) => !/\/export$/.test(req.path) && compression.filter(req, res),
  }),
)

app.get('/healthz', (req, res) => res.json({ ok: true }))

app.use('/api', express.json({ limit: '20mb' }), csrfGuard)
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/workspaces', wsRouter)
app.use('/api/sync', syncRouter)
if (DESKTOP) app.use('/api/desktop', desktopRouter)
if (DESKTOP && DESKTOP_WEB) app.use(desktopWebRouter)
app.use('/api', miscRouter)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))
app.use('/p', publicRouter)
app.use('/download', downloadRouter)

if (fs.existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        else res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  const indexHtml = path.join(DIST, 'index.html')
  // Someone who is not signed in meets the intro page rather than a bare login
  // box. /welcome always shows it; /login and /register go straight to the app.
  const landingHtml = path.join(DIST, 'landing', 'index.html')
  const hasLanding = fs.existsSync(landingHtml)
  const sendLanding = (res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Vary', 'Cookie')
    res.sendFile(landingHtml)
  }
  app.get('/welcome', (req, res, next) => (hasLanding ? sendLanding(res) : next()))
  app.get('/', (req, res, next) => {
    if (DESKTOP || !hasLanding) return next()
    if (userFromCookieHeader(req.headers.cookie)) {
      res.setHeader('Vary', 'Cookie')
      return next()
    }
    sendLanding(res)
  })
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.setHeader('Cache-Control', 'no-cache')
    if (DESKTOP && DESKTOP_WEB) {
      return res.type('html').send(fs.readFileSync(indexHtml, 'utf8').replace('<head>', '<head><script src="/desktop-web.js"></script>'))
    }
    res.sendFile(indexHtml)
  })
} else {
  app.get('/', (req, res) => res.type('text').send(`${APP_NAME} API is running. Build the client with "npm run build" or use the Vite dev server.`))
}

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err)
  if (res.headersSent) return res.end()
  const message = err.type === 'entity.too.large' ? 'That file is too large' : status >= 500 && IS_PROD ? 'Something went wrong' : err.message
  res.status(status).json({ error: message, ...(err.body || {}) })
})

async function bootstrapAdmin() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_RESET_PASSWORD } = process.env
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    if (!one('SELECT id FROM users LIMIT 1')) console.log('[setup] No users yet — open the app and visit /admin to create the admin account.')
    return
  }
  // Signing in is by email address, and an admin also needs a code, so the
  // address is what makes the account usable at all.
  if (!adminEmail) console.warn('[setup] ADMIN_EMAIL is not set. Signing in needs an email address, so this admin cannot sign in until it is.')
  const existing = one('SELECT * FROM users WHERE username = ?', ADMIN_USERNAME)
  if (!existing) {
    await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: ADMIN_USERNAME, email: adminEmail || null, emailVerified: !!adminEmail, isAdmin: true })
    console.log(`[setup] Created admin "${ADMIN_USERNAME}"${adminEmail ? ` <${adminEmail}>` : ''}`)
  } else {
    if (!existing.is_admin) run('UPDATE users SET is_admin = 1 WHERE id = ?', existing.id)
    if (adminEmail && existing.email !== adminEmail) {
      const clash = one('SELECT id FROM users WHERE email = ? AND id != ?', adminEmail, existing.id)
      if (clash) console.error(`[setup] ADMIN_EMAIL ${adminEmail} already belongs to another account; leaving "${ADMIN_USERNAME}" as it was.`)
      else {
        run('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?', adminEmail, now(), existing.id)
        console.log(`[setup] Admin "${ADMIN_USERNAME}" now signs in as ${adminEmail}`)
      }
    }
    if (ADMIN_RESET_PASSWORD === '1') {
      run('UPDATE users SET password_hash = ?, disabled = 0 WHERE id = ?', await hashPassword(ADMIN_PASSWORD), existing.id)
      console.log(`[setup] Reset password for admin "${ADMIN_USERNAME}"`)
    }
  }
}

function housekeeping() {
  run('DELETE FROM sessions WHERE expires_at < ?', now())
  run('DELETE FROM invites WHERE expires_at < ? AND used_by IS NULL', now() - 30 * 86400000)
  const old = all('SELECT * FROM trash WHERE deleted_at < ?', now() - 30 * 86400000)
  for (const row of old) {
    for (const n of [row.trash_name, ...trashCompanions(row.trash_name)]) fs.rmSync(path.join(workspaceDir(row.workspace_id), '.trash', n), { recursive: true, force: true })
    run('DELETE FROM trash WHERE id = ?', row.id)
  }
}

if (DESKTOP) await startDesktop()
else {
  await bootstrapAdmin()
  dataCreatedAt()
  warnIfEphemeral(DATA_DIR)
}
housekeeping()
setInterval(housekeeping, 6 * 3600 * 1000).unref()

const server = http.createServer(app)
server.keepAliveTimeout = 65000
attachWebSocket(server)
/** Resolves to the port once listening (the desktop app asks for any free one) */
export const listening = new Promise((resolve) => {
  server.listen(PORT, HOST, () => {
    const port = server.address().port
    console.log(`[${APP_NAME}] listening on http://${HOST}:${port} (data: ${DATA_DIR})`)
    resolve(port)
  })
})

/** Saves everything and stops; the desktop app calls this before quitting */
export async function stopServer() {
  server.close()
  await shutdownAll()
}

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[${APP_NAME}] ${signal} received, saving and shutting down…`)
  const force = setTimeout(() => process.exit(0), 15000)
  try {
    await stopServer()
  } catch (e) {
    console.error(e)
  }
  clearTimeout(force)
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))
