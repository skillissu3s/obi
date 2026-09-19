// Desktop app only: keeps a vault folder and a cloud workspace in step.
//
// For every file we remember the version both sides last agreed on (the base,
// in sync_base). Each round compares local, remote and base:
//   only one side changed      → copy that side over
//   both changed               → three-way merge (text: diff-match-patch,
//                                canvas: mergeBoards); if that can't be done
//                                cleanly the local text is kept as a
//                                "(conflict …)" copy beside the cloud's
//   deleted here, edited there → the edit wins (and the other way round)
// Cloud writes are conditional (If-Match), so a change made elsewhere in the
// meantime is never overwritten — it comes back as 412 and is merged next
// round. Work carries on offline; the round runs when the cloud is reachable.
import os from 'node:os'
import DiffMatchPatch from 'diff-match-patch'
import { one, all, run, now, parseJSON } from './db.js'
import { decrypt } from './security.js'
import { getRuntime } from './runtime.js'
import { conflictName } from './git.js'
import { HashCache, hashBytes, readSynced, writeSynced, deleteSynced } from './syncfiles.js'
import { isNote } from '../shared/paths.js'
import { isBoardPath, isLayerPath, mergeBoards } from '../shared/board.js'
import { notifyUser } from './hub.js'

const POLL = 20 * 1000
const DEBOUNCE = 2500
const BASE_CONTENT_MAX = 1024 * 1024
const engines = new Map() // workspace id -> CloudSync

export const deviceName = () => `${os.hostname()} (Obi desktop)`

export function normalizeCloudUrl(u) {
  let s = String(u || '').trim()
  if (!s) throw Object.assign(new Error('Enter the address of your Obi server'), { status: 400 })
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const url = new URL(s)
    return url.origin + url.pathname.replace(/\/+$/, '')
  } catch {
    throw Object.assign(new Error('That server address doesn’t look right'), { status: 400 })
  }
}

export class CloudError extends Error {
  constructor(message, { status = 0, offline = false, body = null } = {}) {
    super(message)
    this.status = status
    this.offline = offline
    this.body = body
  }
}

/** A request to a cloud server. Network trouble becomes CloudError{offline}. */
export async function cloudFetch(url, pathname, { method = 'GET', token, json, body, headers = {}, raw = false, timeout = 30000 } = {}) {
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  else h['x-obi'] = '1'
  if (json !== undefined) {
    h['content-type'] = 'application/json'
    body = JSON.stringify(json)
  }
  let res
  try {
    res = await fetch(url + pathname, { method, headers: h, body, signal: AbortSignal.timeout(timeout) })
  } catch (e) {
    throw new CloudError(e.name === 'TimeoutError' ? 'The server took too long to answer' : 'Can’t reach the server', { offline: true })
  }
  if (raw && res.ok) return { buf: Buffer.from(await res.arrayBuffer()), etag: res.headers.get('etag') }
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) {
    const msg = data?.error || (res.status === 404 ? 'Not found on the server — is this an Obi server?' : `Server error (${res.status})`)
    throw new CloudError(msg, { status: res.status, body: data })
  }
  if (data == null && text) throw new CloudError('That address doesn’t answer like an Obi server', { status: res.status })
  return data
}

export function accountRow(id) {
  return one('SELECT * FROM cloud_accounts WHERE id = ?', id)
}

// ---- merging

const dmp = new DiffMatchPatch()
dmp.Match_Threshold = 0.3
dmp.Patch_DeleteThreshold = 0.3

/** Three-way text merge; null when the changes overlap in a way we can't settle */
export function mergeText(base, ours, theirs) {
  if (base == null) return null
  if (ours === theirs) return ours
  const patches = dmp.patch_make(base, ours)
  const [merged, results] = dmp.patch_apply(patches, theirs)
  return results.every(Boolean) ? merged : null
}

const mergeable = (p) => isNote(p) || isBoardPath(p) || isLayerPath(p)

// ---- the engine

export class CloudSync {
  constructor(wsId) {
    this.id = wsId
    this.hashes = new HashCache()
    this.status = { state: 'idle', lastSync: null, error: null, offline: false }
    this.timer = null
    this.pollTimer = null
    this.running = null
    this.again = false
    this.lastRev = null
    this.retry = 0
    this.stopped = false
  }

  get row() {
    return one('SELECT * FROM workspaces WHERE id = ?', this.id)
  }
  get link() {
    return parseJSON(this.row?.settings).cloud || null
  }

  async start() {
    const rt = await getRuntime(this.id)
    rt.keepAlive = true
    this.rt = rt
    this.onLocal = () => this.schedule(DEBOUNCE)
    rt.changeListeners.add(this.onLocal)
    this.schedule(300)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    clearTimeout(this.pollTimer)
    if (this.rt) {
      this.rt.changeListeners.delete(this.onLocal)
      this.rt.keepAlive = false
    }
  }

  schedule(ms) {
    if (this.stopped) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.syncNow().catch(() => {}), ms)
  }

  setStatus(patch) {
    Object.assign(this.status, patch)
    const owner = this.row?.owner_id
    if (owner) notifyUser(owner, { t: 'cloud', ws: this.id, status: this.status })
  }

  /** Runs a round now (or right after the one in progress) */
  syncNow() {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.round()
        } while (this.again && !this.stopped)
      } finally {
        this.running = null
      }
      return this.status
    })()
    return this.running
  }

  // the cheap check between rounds: has anything changed on the cloud?
  async poll() {
    if (this.stopped) return
    const link = this.link
    const acct = link && accountRow(link.account)
    if (!acct) return
    try {
      const { rev } = await cloudFetch(acct.url, `/api/sync/${link.remoteId}/state`, { token: decrypt(acct.token), timeout: 15000 })
      if (rev !== this.lastRev || this.status.offline || this.status.state === 'error') await this.syncNow()
      else this.pollTimer = setTimeout(() => this.poll(), POLL)
    } catch (e) {
      this.fail(e)
    }
  }

  fail(e) {
    clearTimeout(this.pollTimer)
    if (e.offline) {
      this.retry = Math.min(this.retry + 1, 6)
      this.setStatus({ state: 'offline', offline: true, error: null })
      this.pollTimer = setTimeout(() => this.poll(), [3, 5, 10, 20, 30, 60][this.retry - 1] * 1000)
      return
    }
    if (e.status === 401) {
      this.setStatus({ state: 'signedout', offline: false, error: 'Signed out of the cloud account — sign in again to keep syncing' })
      return
    }
    this.setStatus({ state: 'error', offline: false, error: e.message })
    this.pollTimer = setTimeout(() => this.poll(), 60 * 1000)
  }

  async round() {
    const link = this.link
    if (!link) return
    const acct = accountRow(link.account)
    if (!acct) return this.setStatus({ state: 'signedout', error: 'Not signed in to the cloud account' })
    const token = decrypt(acct.token)
    const api = (p, opts = {}) => cloudFetch(acct.url, `/api/sync/${link.remoteId}${p}`, { token, ...opts })
    const rt = this.rt || (await getRuntime(this.id))
    clearTimeout(this.pollTimer)
    this.setStatus({ state: 'syncing' })
    try {
      let changed = true
      for (let pass = 0; changed && pass < 4; pass++) {
        changed = await this.pass(rt, api)
      }
      const { rev } = await api('/state')
      this.lastRev = rev
      this.retry = 0
      const t = now()
      run('UPDATE workspaces SET last_sync_at = ?, sync_error = NULL WHERE id = ?', t, this.id)
      this.setStatus({ state: 'idle', offline: false, error: null, lastSync: t })
      this.pollTimer = setTimeout(() => this.poll(), POLL)
    } catch (e) {
      console.error(`[cloud ${this.id}]`, e.message)
      this.fail(e)
    }
  }

  base() {
    const map = new Map()
    for (const r of all('SELECT path, hash, content FROM sync_base WHERE workspace_id = ?', this.id)) map.set(r.path, r)
    return map
  }

  setBase(p, hash, buf) {
    const content = buf && mergeable(p) && buf.length <= BASE_CONTENT_MAX ? buf : null
    run('INSERT OR REPLACE INTO sync_base (workspace_id, path, hash, content) VALUES (?,?,?,?)', this.id, p, hash, content)
  }

  dropBase(p) {
    run('DELETE FROM sync_base WHERE workspace_id = ? AND path = ?', this.id, p)
  }

  /** One comparison of the three sides. Returns whether anything moved. */
  async pass(rt, api) {
    await rt.lock.run(() => rt.flushDocs())
    const local = await this.hashes.manifest(rt.dir)
    const { files: remote } = await api('/manifest')
    const base = this.base()
    const paths = new Set([...Object.keys(local), ...Object.keys(remote), ...base.keys()])
    let moved = false

    const q = (p) => `/file?path=${encodeURIComponent(p)}`
    const pull = async (p, R) => {
      const { buf } = await api(q(p), { raw: true })
      await writeSynced(rt, p, buf)
      this.setBase(p, hashBytes(buf), buf)
      return buf
    }
    const push = async (p, buf, R) => {
      try {
        await api(q(p), { method: 'PUT', body: buf, headers: R ? { 'if-match': `"${R}"` } : { 'if-none-match': '*' }, timeout: 120000 })
        this.setBase(p, hashBytes(buf), buf)
      } catch (e) {
        if (e.status !== 412) throw e
        this.again = true // changed on the cloud meanwhile: merge next round
      }
    }

    for (const p of paths) {
      if (this.stopped) return false
      const L = local[p] ?? null
      const R = remote[p] ?? null
      const b = base.get(p)
      const B = b?.hash ?? null
      if (L === R) {
        if (!L) this.dropBase(p)
        else if (B !== L) this.setBase(p, L, await readSynced(rt, p))
        continue
      }
      moved = true
      try {
        if (L === B) {
          // only the cloud changed
          if (R === null) {
            await deleteSynced(rt, p)
            this.dropBase(p)
          } else await pull(p, R)
        } else if (R === B) {
          // only this device changed
          if (L === null) {
            try {
              await api(q(p), { method: 'DELETE', headers: { 'if-match': `"${R}"` } })
              this.dropBase(p)
            } catch (e) {
              if (e.status !== 412) throw e
              this.again = true
            }
          } else {
            const buf = await readSynced(rt, p)
            if (buf) await push(p, buf, R)
          }
        } else if (L === null) {
          await pull(p, R) // deleted here, edited there: keep the edit
        } else if (R === null) {
          const buf = await readSynced(rt, p) // deleted there, edited here
          if (buf) await push(p, buf, null)
        } else {
          await this.both(rt, api, p, R, b, pull, push)
        }
      } catch (e) {
        if (e instanceof CloudError && (e.offline || e.status === 401)) throw e
        if (e.status === 404) continue // gone meanwhile; the next pass sorts it out
        console.error(`[cloud ${this.id}] ${p}:`, e.message)
        this.setStatus({ error: `${p}: ${e.message}` })
      }
    }
    return moved
  }

  // both sides changed the same file since they last agreed
  async both(rt, api, p, R, b, pull, push) {
    const mine = await readSynced(rt, p)
    const { buf: theirs } = await api(`/file?path=${encodeURIComponent(p)}`, { raw: true })
    if (!mine) return pull(p, R)
    let merged = null
    if (mergeable(p)) {
      const baseText = b?.content ? Buffer.from(b.content).toString('utf8') : null
      if (isNote(p)) merged = mergeText(baseText, mine.toString('utf8'), theirs.toString('utf8'))
      else merged = mergeBoards(baseText || '', mine.toString('utf8'), theirs.toString('utf8'))
    }
    if (merged != null) {
      const buf = Buffer.from(merged, 'utf8')
      await writeSynced(rt, p, buf)
      return push(p, buf, hashBytes(theirs))
    }
    if (isLayerPath(p)) {
      // a canvas layer that can't be read: the cloud's copy wins
      await writeSynced(rt, p, theirs)
      return this.setBase(p, hashBytes(theirs), theirs)
    }
    // keep both: this device's version beside the cloud's
    const copy = rt.uniquePath(conflictName(p))
    await writeSynced(rt, copy, mine)
    await writeSynced(rt, p, theirs)
    this.setBase(p, hashBytes(theirs), theirs)
    rt.emit({ t: 'conflicts', ws: rt.id, conflicts: [{ path: p, copy }] })
  }
}

// ---- lifecycle

export function cloudStatus(wsId) {
  return engines.get(wsId)?.status || null
}

export async function startCloudSync(wsId) {
  stopCloudSync(wsId)
  const e = new CloudSync(wsId)
  engines.set(wsId, e)
  await e.start()
  return e
}

export function stopCloudSync(wsId) {
  engines.get(wsId)?.stop()
  engines.delete(wsId)
}

export function engineFor(wsId) {
  return engines.get(wsId) || null
}

/** At startup: every vault linked to the cloud starts syncing */
export async function startAllCloudSync() {
  for (const w of all('SELECT id, settings FROM workspaces')) {
    if (parseJSON(w.settings).cloud) startCloudSync(w.id).catch((e) => console.error('[cloud]', e.message))
  }
}

/** The network came back (or the user asked): check everything now */
export function nudgeAll() {
  for (const e of engines.values()) e.syncNow().catch(() => {})
}
