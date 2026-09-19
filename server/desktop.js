// Desktop app only (OBI_DESKTOP=1). The app runs this same server on
// 127.0.0.1 for one person: every workspace is a folder they chose (a vault),
// kept locally and, if they like, synced to an Obi cloud account and/or GitHub.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import express from 'express'
import { one, all, run, now, parseJSON, tx } from './db.js'
import { requireAuth } from './auth.js'
import { encrypt, decrypt, newId, randomToken, sha256 } from './security.js'
import { createUser, publicUser } from './users.js'
import { getRuntime, peekRuntime, disposeRuntime } from './runtime.js'
import { HttpError } from './fsutil.js'
import { notifyUser } from './hub.js'
import { SESSION_DAYS } from './config.js'
import { isSyncPath } from './syncfiles.js'
import * as git from './git.js'
import {
  cloudFetch, normalizeCloudUrl, deviceName, accountRow, startCloudSync, stopCloudSync, engineFor, nudgeAll, startAllCloudSync,
} from './cloudsync.js'

const LOCAL_USERNAME = 'me'

/** The one person using this app */
export async function localUser() {
  let u = one('SELECT * FROM users WHERE username = ?', LOCAL_USERNAME)
  if (!u) {
    const name = process.env.OBI_USER_NAME || os.userInfo().username || 'Me'
    u = await createUser({ username: LOCAL_USERNAME, displayName: name, password: randomToken(24), isAdmin: true, withWorkspace: false })
  }
  return u
}

/** A session for the app window (the Electron main process sets it as a cookie) */
export async function desktopSessionToken({ replace = true } = {}) {
  const u = await localUser()
  if (replace) run("DELETE FROM sessions WHERE user_id = ? AND user_agent = 'Obi desktop'", u.id) // last launch's
  const token = randomToken()
  const t = now()
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)',
    sha256(token), u.id, t, t + SESSION_DAYS * 86400000, t, 'Obi desktop', '127.0.0.1',
  )
  return token
}

export async function startDesktop() {
  await localUser()
  for (const w of all('SELECT id FROM workspaces WHERE dir IS NOT NULL')) watchVault(w.id)
  await startAllCloudSync()
}

// ---- other apps editing the vault (Obsidian, an editor, a file manager)

const watchers = new Map()

export function watchVault(wsId) {
  if (watchers.has(wsId)) return
  const row = one('SELECT dir FROM workspaces WHERE id = ?', wsId)
  if (!row?.dir) return
  let pending = new Set()
  let timer = null
  let w
  try {
    w = fs.watch(row.dir, { recursive: true }, (event, name) => {
      if (!name) return
      const rel = String(name).split(path.sep).join('/')
      if (!isSyncPath(rel)) return
      pending.add(rel)
      clearTimeout(timer)
      timer = setTimeout(flush, 400)
    })
  } catch (e) {
    console.error('[watch]', row.dir, e.message)
    return
  }
  w.on('error', () => {})
  const flush = async () => {
    const paths = [...pending]
    pending = new Set()
    const rt = peekRuntime(wsId)
    if (!rt) return // opened later, it reads the folder fresh anyway
    const changed = []
    for (const rel of paths) {
      let buf = null
      try {
        buf = await fsp.readFile(path.join(rt.dir, ...rel.split('/')))
      } catch {}
      const hash = buf ? sha256(buf) : null
      // our own write coming back, or nothing new
      if (rt.written.has(rel) && rt.written.get(rel) === hash) continue
      if (!buf && !rt.tree.has(rel) && !rel.startsWith('.obi/')) continue
      if (buf && rt.contents.get(rel) === buf.toString('utf8')) continue
      rt.written.set(rel, hash)
      changed.push(rel)
    }
    if (changed.length) await rt.lock.run(() => rt.applyRemoteChanges(changed)).catch((e) => console.error('[watch]', e.message))
    if (changed.length) for (const fn of rt.changeListeners) fn(changed[0])
  }
  watchers.set(wsId, w)
}

function unwatchVault(wsId) {
  watchers.get(wsId)?.close()
  watchers.delete(wsId)
}

// ---- development: the desktop UI in an ordinary browser (OBI_DESKTOP_WEB=1).
// /desktop-web signs the browser in and a stand-in for the app's preload
// answers folder pickers with fresh folders under OBI_DESKTOP_WEB_DIR.

export const DESKTOP_WEB = process.env.OBI_DESKTOP_WEB === '1'
export const desktopWebRouter = express.Router()
if (DESKTOP_WEB) {
  const root = path.resolve(process.env.OBI_DESKTOP_WEB_DIR || path.join(os.tmpdir(), 'obi-desktop-web'))
  let n = 0
  const local = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  desktopWebRouter.get('/desktop-web', async (req, res) => {
    if (!local(req)) return res.status(403).end()
    res.cookie('obi_session', await desktopSessionToken({ replace: false }), { httpOnly: true, sameSite: 'lax', path: '/' })
    res.redirect('/')
  })
  desktopWebRouter.get('/desktop-web.js', (req, res) => {
    res.type('js').send(`window.obiDesktop = {
  platform: 'web',
  pickFolder: () => fetch('/desktop-web/folder').then((r) => r.json()).then((r) => r.dir),
  reveal: (dir) => console.log('reveal', dir),
  documentsFolder: async () => ${JSON.stringify(root)},
  reauth: () => fetch('/desktop-web', { redirect: 'manual' }).then(() => true),
}`)
  })
  desktopWebRouter.get('/desktop-web/folder', (req, res) => {
    if (!local(req)) return res.status(403).end()
    res.json({ dir: path.join(root, `vault-${Date.now().toString(36)}-${++n}`) })
  })
}

// ---- routes

export const desktopRouter = express.Router()
desktopRouter.use(requireAuth)

const refreshClients = (userId) => notifyUser(userId, { t: 'workspaces' })

function vaultPath(dir) {
  const d = String(dir || '').trim()
  if (!d || !path.isAbsolute(d)) throw new HttpError(400, 'Choose a folder')
  return path.resolve(d)
}

function assertFreeFolder(dir) {
  for (const w of all('SELECT name, dir FROM workspaces WHERE dir IS NOT NULL')) {
    const a = path.resolve(w.dir).toLowerCase()
    const b = dir.toLowerCase()
    if (a === b) throw new HttpError(409, `This folder is already the vault “${w.name}”`)
    if (b.startsWith(a + path.sep) || a.startsWith(b + path.sep)) throw new HttpError(409, `This folder overlaps the vault “${w.name}”`)
  }
}

async function createVault(userId, { dir, name, icon = '', settings = {} }) {
  dir = vaultPath(dir)
  assertFreeFolder(dir)
  await fsp.mkdir(dir, { recursive: true })
  const id = newId()
  const t = now()
  const n = String(name || path.basename(dir) || 'Notes').trim().slice(0, 80)
  const first = !one('SELECT id FROM workspaces LIMIT 1')
  tx(() => {
    run(
      'INSERT INTO workspaces (id, name, type, owner_id, icon, is_default, settings, created_at, updated_at, dir) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, n, 'online', userId, icon, first ? 1 : 0, JSON.stringify(settings), t, t, dir,
    )
    run('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?,?,?,?)', id, userId, 'owner', t)
  })
  watchVault(id)
  refreshClients(userId)
  return one('SELECT * FROM workspaces WHERE id = ?', id)
}

const vaultJson = (w) => ({ id: w.id, name: w.name, dir: w.dir, icon: w.icon, cloud: parseJSON(w.settings).cloud || null })

function ownVault(req) {
  const w = one('SELECT * FROM workspaces WHERE id = ? AND owner_id = ?', req.params.id, req.user.id)
  if (!w) throw new HttpError(404, 'Vault not found')
  return w
}

const accountJson = (a) => ({ id: a.id, url: a.url, user: parseJSON(a.user), createdAt: a.created_at })

desktopRouter.get('/info', async (req, res) => {
  const g = await git.gitVersion()
  res.json({
    platform: process.platform,
    device: deviceName(),
    git: g,
    vaults: all('SELECT * FROM workspaces WHERE dir IS NOT NULL ORDER BY created_at').map(vaultJson),
    accounts: all('SELECT * FROM cloud_accounts ORDER BY created_at').map(accountJson),
    defaultCloud: process.env.OBI_CLOUD_URL || '',
  })
})

// a new vault, or an existing folder of notes (an Obsidian vault works as is)
desktopRouter.post('/vaults', async (req, res) => {
  const w = await createVault(req.user.id, req.body || {})
  res.json({ vault: vaultJson(w) })
})

// forget a vault: the folder and its notes stay where they are
desktopRouter.delete('/vaults/:id', async (req, res) => {
  const w = ownVault(req)
  stopCloudSync(w.id)
  unwatchVault(w.id)
  await disposeRuntime(w.id)
  run('DELETE FROM workspaces WHERE id = ?', w.id)
  refreshClients(req.user.id)
  res.json({ ok: true })
})

// ---- cloud accounts. The app talks to the cloud from here (not from the
// page), so the token never reaches the page and no CORS is needed.

async function saveAccount(url, result) {
  if (!result?.token) return result
  const existing = one('SELECT id FROM cloud_accounts WHERE url = ?', url)
  const id = existing?.id || newId()
  run(
    'INSERT OR REPLACE INTO cloud_accounts (id, url, user, token, created_at) VALUES (?,?,?,?,?)',
    id, url, JSON.stringify(result.user || {}), encrypt(result.token), now(),
  )
  // vaults waiting on a sign-in pick up again
  for (const w of all('SELECT id, settings FROM workspaces')) {
    if (parseJSON(w.settings).cloud?.account === id) engineFor(w.id)?.syncNow().catch(() => {})
  }
  return { account: accountJson(accountRow(id)) }
}

const proxied = (pathname, pick) =>
  async (req, res) => {
    const url = normalizeCloudUrl(req.body?.url)
    const body = { ...pick(req.body || {}), device: deviceName() }
    try {
      res.json(await saveAccount(url, await cloudFetch(url, pathname, { method: 'POST', json: body })))
    } catch (e) {
      throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message)
    }
  }

desktopRouter.post('/cloud/options', async (req, res) => {
  const url = normalizeCloudUrl(req.body?.url)
  try {
    const o = await cloudFetch(url, '/api/auth/setup', { timeout: 10000 })
    if (!('registration' in o)) throw new Error('This server is too old for the desktop app')
    res.json({ url, ...o })
  } catch (e) {
    throw new HttpError(e.status && e.status < 500 ? e.status : 502, e.message)
  }
})
desktopRouter.post('/cloud/login', proxied('/api/auth/login', (b) => ({ identifier: b.identifier, password: b.password })))
desktopRouter.post('/cloud/login/code', proxied('/api/auth/login/code', (b) => ({ identifier: b.identifier })))
desktopRouter.post('/cloud/login/verify', proxied('/api/auth/login/code/verify', (b) => ({ ticket: b.ticket, code: b.code })))
desktopRouter.post('/cloud/register', proxied('/api/auth/register', (b) => ({ email: b.email, username: b.username, password: b.password, displayName: b.displayName })))
desktopRouter.post('/cloud/register/verify', proxied('/api/auth/register/verify', (b) => ({ ticket: b.ticket, code: b.code })))
desktopRouter.post('/cloud/resend', proxied('/api/auth/code/resend', (b) => ({ ticket: b.ticket })))

desktopRouter.delete('/cloud/:id', async (req, res) => {
  const a = accountRow(req.params.id)
  if (!a) throw new HttpError(404, 'Not signed in to that account')
  cloudFetch(a.url, '/api/auth/logout', { method: 'POST', token: decrypt(a.token), json: {} }).catch(() => {})
  run('DELETE FROM cloud_accounts WHERE id = ?', a.id)
  for (const w of all('SELECT id, settings FROM workspaces')) {
    if (parseJSON(w.settings).cloud?.account === a.id) engineFor(w.id)?.syncNow().catch(() => {})
  }
  res.json({ ok: true })
})

async function cloudCall(accountId, pathname, opts) {
  const a = accountRow(accountId)
  if (!a) throw new HttpError(404, 'Sign in to the cloud account first')
  try {
    return await cloudFetch(a.url, pathname, { token: decrypt(a.token), ...opts })
  } catch (e) {
    throw new HttpError(e.offline ? 503 : e.status === 401 ? 401 : e.status && e.status < 500 ? e.status : 502, e.status === 401 ? 'Your cloud sign-in has expired — sign in again' : e.message)
  }
}

desktopRouter.get('/cloud/:id/workspaces', async (req, res) => {
  const { workspaces } = await cloudCall(req.params.id, '/api/sync/workspaces')
  const linked = new Map()
  for (const w of all('SELECT id, name, settings FROM workspaces')) {
    const c = parseJSON(w.settings).cloud
    if (c?.account === req.params.id) linked.set(c.remoteId, { id: w.id, name: w.name })
  }
  res.json({ workspaces: workspaces.map((w) => ({ ...w, vault: linked.get(w.id) || null })) })
})

function linkCloud(w, account, remote) {
  const settings = parseJSON(w.settings)
  settings.cloud = { account, remoteId: remote.id, remoteName: remote.name, linkedAt: now() }
  run('UPDATE workspaces SET settings = ?, updated_at = ? WHERE id = ?', JSON.stringify(settings), now(), w.id)
  run('DELETE FROM sync_base WHERE workspace_id = ?', w.id)
  peekRuntime(w.id)?.reloadRow()
}

function alreadyLinked(account, remoteId) {
  for (const w of all('SELECT name, settings FROM workspaces')) {
    const c = parseJSON(w.settings).cloud
    if (c?.account === account && c.remoteId === remoteId) throw new HttpError(409, `That cloud workspace already syncs with the vault “${w.name}”`)
  }
}

// bring a cloud workspace down into a folder, and keep the two in sync
desktopRouter.post('/cloud/:id/import', async (req, res) => {
  const { remoteId, dir } = req.body || {}
  const { workspaces } = await cloudCall(req.params.id, '/api/sync/workspaces')
  const remote = workspaces.find((w) => w.id === remoteId)
  if (!remote) throw new HttpError(404, 'That cloud workspace was not found')
  alreadyLinked(req.params.id, remote.id)
  const w = await createVault(req.user.id, { dir, name: req.body?.name || remote.name, icon: remote.icon || '' })
  linkCloud(w, req.params.id, remote)
  await startCloudSync(w.id)
  refreshClients(req.user.id)
  res.json({ vault: vaultJson(one('SELECT * FROM workspaces WHERE id = ?', w.id)) })
})

// sync an existing vault with the cloud: a new cloud workspace, or one that exists
desktopRouter.post('/vaults/:id/cloud', async (req, res) => {
  const w = ownVault(req)
  const { account, remoteId, create } = req.body || {}
  let remote
  if (create) {
    remote = (await cloudCall(account, '/api/sync/workspaces', { method: 'POST', json: { name: req.body?.name || w.name, icon: w.icon } })).workspace
  } else {
    const { workspaces } = await cloudCall(account, '/api/sync/workspaces')
    remote = workspaces.find((x) => x.id === remoteId)
    if (!remote) throw new HttpError(404, 'That cloud workspace was not found')
    alreadyLinked(account, remote.id)
  }
  linkCloud(w, account, remote)
  await startCloudSync(w.id)
  refreshClients(req.user.id)
  res.json({ vault: vaultJson(one('SELECT * FROM workspaces WHERE id = ?', w.id)) })
})

// stop syncing: both copies stay as they are
desktopRouter.delete('/vaults/:id/cloud', async (req, res) => {
  const w = ownVault(req)
  stopCloudSync(w.id)
  const settings = parseJSON(w.settings)
  delete settings.cloud
  run('UPDATE workspaces SET settings = ? WHERE id = ?', JSON.stringify(settings), w.id)
  run('DELETE FROM sync_base WHERE workspace_id = ?', w.id)
  peekRuntime(w.id)?.reloadRow()
  refreshClients(req.user.id)
  res.json({ ok: true })
})

desktopRouter.post('/vaults/:id/cloud/sync', async (req, res) => {
  const w = ownVault(req)
  const e = engineFor(w.id) || (parseJSON(w.settings).cloud ? await startCloudSync(w.id) : null)
  if (!e) throw new HttpError(400, 'This vault is not synced with the cloud')
  res.json({ status: await e.syncNow() })
})

// the network is back (the page saw it first)
desktopRouter.post('/online', (req, res) => {
  nudgeAll()
  res.json({ ok: true })
})

// ---- GitHub for a vault: the vault folder itself becomes the git working copy

desktopRouter.post('/vaults/:id/github', async (req, res) => {
  const w = ownVault(req)
  const { repoUrl, token, branch: wanted } = req.body || {}
  if (!(await git.gitVersion())) throw new HttpError(400, 'Git is not installed. Install it from git-scm.com, then try again.')
  const url = git.normalizeRepoUrl(repoUrl)
  const tok = String(token || '').trim() || (w.github_token ? decrypt(w.github_token) : '')
  const info = await git.lsRemote(url, tok)
  const branch = String(wanted || '').trim() || info.defaultBranch || 'main'
  if (!info.empty && !info.branches.includes(branch)) throw new HttpError(400, `Branch "${branch}" was not found. Available: ${info.branches.slice(0, 10).join(', ')}`)
  const settings = { syncMode: 'save', autoSync: true, autoSyncSeconds: 30, pullIntervalSeconds: 300, ...parseJSON(w.settings) }
  await disposeRuntime(w.id)
  run(
    "UPDATE workspaces SET type = 'github', github_repo = ?, github_branch = ?, github_token = ?, settings = ?, last_sync_at = NULL, sync_error = NULL, updated_at = ? WHERE id = ?",
    url, branch, encrypt(tok), JSON.stringify(settings), now(), w.id,
  )
  const rt = await getRuntime(w.id)
  if (rt.initError) throw new HttpError(400, rt.initError)
  refreshClients(req.user.id)
  res.json({ ok: true, label: git.repoLabel(url), branch })
})

// stop syncing with GitHub (the .git folder and its history stay)
desktopRouter.delete('/vaults/:id/github', async (req, res) => {
  const w = ownVault(req)
  await disposeRuntime(w.id)
  run("UPDATE workspaces SET type = 'online', github_repo = NULL, github_branch = NULL, github_token = NULL, sync_error = NULL WHERE id = ?", w.id)
  refreshClients(req.user.id)
  res.json({ ok: true })
})

// pull without pushing
desktopRouter.post('/vaults/:id/github/pull', async (req, res) => {
  const w = ownVault(req)
  if (w.type !== 'github') throw new HttpError(400, 'This vault is not connected to GitHub')
  const rt = await getRuntime(w.id)
  res.json({ status: await rt.requestSync({ push: false }) })
})
