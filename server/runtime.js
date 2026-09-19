import fs from 'node:fs/promises'
import path from 'node:path'
import { WORKSPACES_DIR } from './config.js'
import { one, run, all, now, parseJSON } from './db.js'
import { decrypt, newId } from './security.js'
import { LiveDoc } from './livedocs.js'
import { atomicWrite, absPath, scanDir, mapLimit, Mutex, HttpError, exists } from './fsutil.js'
import * as git from './git.js'
import { parseNote, LinkResolver, relativePath, parseQuery } from '../shared/parse.js'
import { basename, dirname, extname, isNote, noteTitle, stripExt, joinPath } from '../shared/paths.js'
import { isBoardPath, layerPathFor, notePathForLayer, BoardParseError, LAYER_DIR } from '../shared/board.js'

const MAX_INDEX_BYTES = 2 * 1024 * 1024
const VERSION_INTERVAL = 10 * 60 * 1000
const runtimes = new Map()

export const workspaceDir = (id) => one('SELECT dir FROM workspaces WHERE id = ?', id)?.dir || path.join(WORKSPACES_DIR, id)
// a folder the user picked (desktop vault) is theirs: never deleted by us
const isOwnFolder = (id) => !!one('SELECT dir FROM workspaces WHERE id = ?', id)?.dir

// canvas layers of trashed notes travel with them
export const trashCompanions = (trashName) => [`${trashName}.layer.json`, `${trashName}.layers`]

export async function getRuntime(id) {
  let rt = runtimes.get(id)
  if (!rt) {
    const row = one('SELECT * FROM workspaces WHERE id = ?', id)
    if (!row) throw new HttpError(404, 'Workspace not found')
    rt = new WorkspaceRuntime(row)
    runtimes.set(id, rt)
    rt.ready = rt.init()
  }
  await rt.ready
  rt.touch()
  return rt
}

export function peekRuntime(id) {
  return runtimes.get(id) || null
}

export async function disposeRuntime(id, { removeFiles = false } = {}) {
  const rt = runtimes.get(id)
  if (rt) {
    runtimes.delete(id)
    await rt.shutdown({ save: !removeFiles })
  }
  if (removeFiles && !isOwnFolder(id)) await fs.rm(workspaceDir(id), { recursive: true, force: true })
}

export async function shutdownAll() {
  await Promise.all([...runtimes.values()].map((rt) => rt.shutdown({ save: true, finalSync: true }).catch(() => {})))
}

// Unload idle runtimes
setInterval(() => {
  const t = Date.now()
  for (const [id, rt] of runtimes) {
    if (rt.subscribers.size === 0 && rt.docs.size === 0 && t - rt.lastUsed > 30 * 60 * 1000 && !rt.syncState.dirty) {
      runtimes.delete(id)
      rt.shutdown({ save: true }).catch(() => {})
    }
  }
}, 5 * 60 * 1000).unref()

class WorkspaceRuntime {
  constructor(row) {
    this.id = row.id
    this.row = row
    this.type = row.type
    this.dir = workspaceDir(row.id)
    this.tree = new Map()
    this.contents = new Map()
    this.lower = new Map()
    this.meta = new Map()
    this.resolver = new LinkResolver()
    this.docs = new Map()
    this.layers = new Map() // note path -> LiveDoc holding that note's canvas layer
    this.subscribers = new Set()
    this.lock = new Mutex()
    this.lastUsed = Date.now()
    this.initError = null
    this.syncState = { state: 'idle', dirty: false, lastSync: row.last_sync_at, error: row.sync_error, syncing: false }
    this.dirtyPaths = new Set()
    // bumps on every change to the files; sync clients compare it to skip work
    this.rev = 0
    this.bootId = newId(6) // revs restart with the process; this tells them apart
    this.changeListeners = new Set()
    this.syncTimer = null
    this.pullTimer = null
    this.presenceTimer = null
    this.closed = false
  }

  touch() {
    this.lastUsed = Date.now()
  }

  get settings() {
    return parseJSON(this.row.settings)
  }

  reloadRow() {
    const row = one('SELECT * FROM workspaces WHERE id = ?', this.id)
    if (row) this.row = row
    return row
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true })
    if (this.type === 'github') {
      try {
        if (!(await git.isRepo(this.dir))) {
          this.setSync({ state: 'cloning' })
          await git.initRepo(this.dir, this.gitOpts())
          await this.doSync({ initial: true })
        }
      } catch (e) {
        this.initError = e.message
        this.setSync({ state: 'error', error: e.message })
      }
    }
    await this.scan()
    if (this.type === 'github' && !this.initError) {
      this.startPullLoop()
      // background refresh on open
      setTimeout(() => this.requestSync(), 1500)
    }
  }

  gitOpts() {
    const s = this.settings
    const owner = one('SELECT username, display_name FROM users WHERE id = ?', this.row.owner_id)
    return {
      url: this.row.github_repo,
      branch: this.row.github_branch || 'main',
      token: decrypt(this.row.github_token),
      username: s.gitUsername || undefined,
      authorName: s.authorName || owner?.display_name || 'Obi',
      authorEmail: s.authorEmail || `${owner?.username || 'obi'}@users.noreply.obi`,
    }
  }

  async scan() {
    const entries = await scanDir(this.dir)
    this.tree = new Map(entries.map((e) => [e.path, e]))
    this.resolver.setPaths(entries.filter((e) => e.type === 'file').map((e) => e.path))
    const notes = entries.filter((e) => e.type === 'file' && isNote(e.path) && e.size <= MAX_INDEX_BYTES)
    this.contents.clear()
    this.lower.clear()
    this.meta.clear()
    await mapLimit(notes, 32, async (e) => {
      try {
        const text = await fs.readFile(absPath(this.dir, e.path), 'utf8')
        this.setContent(e.path, text)
      } catch {}
    })
  }

  setContent(p, text) {
    this.contents.set(p, text)
    this.lower.delete(p)
    this.meta.set(p, parseNote(text))
  }

  dropContent(p) {
    this.contents.delete(p)
    this.lower.delete(p)
    this.meta.delete(p)
  }

  // ---------- events ----------
  emit(msg, except) {
    for (const s of this.subscribers) if (s !== except) s.sendJSON(msg)
  }

  emitTree() {
    clearTimeout(this.treeTimer)
    this.treeTimer = setTimeout(() => this.emit({ t: 'tree', ws: this.id }), 120)
  }

  emitIndex(p) {
    this.emit({ t: 'index', ws: this.id, path: p, meta: this.meta.has(p) ? this.noteIndex(p) : null })
  }

  presenceChanged() {
    clearTimeout(this.presenceTimer)
    this.presenceTimer = setTimeout(() => this.emit({ t: 'presence', ws: this.id, docs: this.presence() }), 250)
  }

  presence() {
    const out = {}
    for (const [p, doc] of this.docs) {
      const users = new Map()
      for (const sock of doc.conns.keys()) users.set(sock.user.id, { id: sock.user.id, name: sock.user.display_name, color: sock.user.color })
      if (users.size) out[p] = [...users.values()]
    }
    return out
  }

  setSync(patch) {
    Object.assign(this.syncState, patch)
    this.emit({ t: 'sync', ws: this.id, status: this.syncStatus() })
  }

  syncStatus() {
    const s = this.syncState
    return { state: s.state, dirty: s.dirty, lastSync: s.lastSync, error: s.error, pending: this.dirtyPaths.size }
  }

  // ---------- read ----------
  getTree() {
    return [...this.tree.values()]
  }

  noteIndex(p) {
    const e = this.tree.get(p)
    const m = this.meta.get(p)
    return {
      path: p,
      mtime: e?.mtime || 0,
      size: e?.size || 0,
      links: m.links.map((l) => ({ t: l.target, s: l.subpath || undefined, e: l.embed ? 1 : undefined, k: l.kind === 'md' ? 'md' : undefined, l: l.line })),
      tags: m.tags,
      headings: m.headings,
      tasks: m.tasks,
      fm: m.frontmatter,
      aliases: m.aliases.length ? m.aliases : undefined,
      words: m.words,
    }
  }

  getIndex() {
    return [...this.meta.keys()].map((p) => this.noteIndex(p))
  }

  async readNote(p) {
    const doc = this.docs.get(p)
    if (doc) return doc.text
    if (this.contents.has(p)) return this.contents.get(p)
    const entry = this.tree.get(p)
    if (!entry || entry.type !== 'file') return null
    return fs.readFile(absPath(this.dir, p), 'utf8')
  }

  hasFile(p) {
    return this.tree.get(p)?.type === 'file'
  }

  // ---------- live docs ----------
  // kind: 'text' (a note or, for .board paths, a whiteboard) or 'layer' (the canvas layer of note `p`)
  async openDoc(p, kind = 'text') {
    const layer = kind === 'layer'
    const registry = layer ? this.layers : this.docs
    let doc = registry.get(p)
    if (doc && !doc.destroyed) return doc
    if (!this._opening) this._opening = new Map()
    const openKey = `${kind}:${p}`
    if (this._opening.has(openKey)) return this._opening.get(openKey)
    const promise = (async () => {
      let text
      if (layer) {
        if (!isNote(p) || !this.hasFile(p)) throw new HttpError(404, 'Note not found')
        text = await this.readLayer(p)
      } else {
        text = await this.readNote(p)
        if (text == null) throw new HttpError(404, isBoardPath(p) ? 'Whiteboard not found' : 'Note not found')
      }
      let d = registry.get(p)
      if (d && !d.destroyed) return d
      try {
        d = new LiveDoc(this, p, text, {
          kind: layer || isBoardPath(p) ? 'board' : 'text',
          layer,
          registry,
          key: layer ? layerDocKey(this.id, p) : undefined,
        })
      } catch (e) {
        if (e instanceof BoardParseError) throw new HttpError(422, layer ? `The canvas layer of this note is damaged (${e.message})` : e.message)
        throw e
      }
      registry.set(p, d)
      return d
    })()
    this._opening.set(openKey, promise)
    try {
      return await promise
    } finally {
      this._opening.delete(openKey)
    }
  }

  async readLayer(notePath) {
    const doc = this.layers.get(notePath)
    if (doc && !doc.destroyed) return doc.text
    try {
      return await fs.readFile(absPath(this.dir, layerPathFor(notePath)), 'utf8')
    } catch {
      return ''
    }
  }

  async _writeLayer(notePath, text) {
    const rel = layerPathFor(notePath)
    const abs = absPath(this.dir, rel)
    if (text == null) {
      if (!(await exists(abs))) return
      await fs.rm(abs, { force: true })
    } else {
      await atomicWrite(abs, text)
    }
    this.markDirty(rel)
  }

  // bring a note's layer file along when the note moves
  async _moveLayer(from, to) {
    const src = absPath(this.dir, layerPathFor(from))
    if (!(await exists(src))) return
    const dst = absPath(this.dir, layerPathFor(to))
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(src, dst)
    this.markDirty(layerPathFor(from))
    this.markDirty(layerPathFor(to))
  }

  // write a layer file coming from an import
  importLayer(notePath, text) {
    return this.lock.run(async () => {
      const doc = this.layers.get(notePath)
      if (doc) doc.applyExternal(text)
      await this._writeLayer(notePath, text)
    })
  }

  saveFromDoc(doc) {
    return this.lock.run(() => this._saveDoc(doc))
  }

  async _saveDoc(doc) {
    if (doc.destroyed && doc.registry.get(doc.path) !== doc) return
    const text = doc.takePending()
    if (text == null) return
    if (doc.layer) {
      // an empty layer leaves no file behind
      if (!this.hasFile(doc.path)) return
      await this._writeLayer(doc.path, doc.isEmpty ? null : text)
      return
    }
    await this._writeNote(doc.path, text, { userId: doc.lastEditor, fromDoc: true })
  }

  async flushDocs() {
    for (const doc of this.docs.values()) await this._saveDoc(doc)
    for (const doc of this.layers.values()) await this._saveDoc(doc)
  }

  // ---------- write ----------
  // snapshotEvery: how close together versions may be (sync writes keep more)
  async _writeNote(p, text, { userId = null, fromDoc = false, isNew = false, snapshotEvery = VERSION_INTERVAL } = {}) {
    const abs = absPath(this.dir, p)
    const prev = this.contents.get(p)
    if (!fromDoc) {
      const doc = this.docs.get(p)
      if (doc) doc.applyExternal(text)
    }
    if (prev === text && !isNew) return
    await atomicWrite(abs, text)
    const st = await fs.stat(abs)
    const existed = this.tree.has(p)
    await this._ensureParents(p)
    this.tree.set(p, { path: p, type: 'file', size: st.size, mtime: Math.round(st.mtimeMs) })
    if (!existed) {
      this.resolver.add(p)
      this.emitTree()
    }
    if (isNote(p)) {
      if (this.type === 'online' && prev != null && prev !== text) this._maybeSnapshot(p, prev, userId, false, snapshotEvery)
      this.setContent(p, text)
      this.emitIndex(p)
    }
    this.markDirty(p)
  }

  async _ensureParents(p) {
    let d = dirname(p)
    const added = []
    while (d && !this.tree.has(d)) {
      const st = await fs.stat(absPath(this.dir, d)).catch(() => null)
      this.tree.set(d, { path: d, type: 'folder', size: 0, mtime: st ? Math.round(st.mtimeMs) : Date.now() })
      added.push(d)
      d = dirname(d)
    }
    if (added.length) this.emitTree()
  }

  _maybeSnapshot(p, prevContent, userId, force = false, every = VERSION_INTERVAL) {
    const last = one('SELECT created_at FROM versions WHERE workspace_id = ? AND path = ? ORDER BY created_at DESC LIMIT 1', this.id, p)
    if (!force && last && Date.now() - last.created_at < every) return
    run('INSERT INTO versions (workspace_id, path, content, user_id, created_at) VALUES (?,?,?,?,?)', this.id, p, prevContent, userId, now())
    run(
      `DELETE FROM versions WHERE workspace_id = ? AND path = ? AND id NOT IN (
        SELECT id FROM versions WHERE workspace_id = ? AND path = ? ORDER BY created_at DESC LIMIT 200)`,
      this.id, p, this.id, p,
    )
  }

  writeNote(p, text, opts = {}) {
    return this.lock.run(async () => {
      if (opts.ifMissing && this.tree.has(p)) return { created: false }
      if (opts.mustNotExist && this.tree.has(p)) throw new HttpError(409, 'A file with that name already exists')
      const isNew = !this.tree.has(p)
      await this._writeNote(p, text, { ...opts, isNew })
      return { created: isNew }
    })
  }

  // Modify note text through a function (applies to live doc if open)
  updateNote(p, fn, opts = {}) {
    return this.lock.run(async () => {
      const doc = this.docs.get(p)
      if (doc) await this._saveDoc(doc)
      const current = doc ? doc.text : await this.readNote(p)
      if (current == null) throw new HttpError(404, 'Note not found')
      const next = fn(current)
      if (next == null || next === current) return false
      await this._writeNote(p, next, opts)
      return true
    })
  }

  writeFile(p, buffer) {
    return this.lock.run(async () => {
      const abs = absPath(this.dir, p)
      await atomicWrite(abs, buffer)
      const st = await fs.stat(abs)
      await this._ensureParents(p)
      const existed = this.tree.has(p)
      this.tree.set(p, { path: p, type: 'file', size: st.size, mtime: Math.round(st.mtimeMs) })
      if (!existed) this.resolver.add(p)
      if (isNote(p)) {
        this.setContent(p, buffer.toString('utf8'))
        this.docs.get(p)?.applyExternal(buffer.toString('utf8'))
        this.emitIndex(p)
      } else if (isBoardPath(p)) {
        this.docs.get(p)?.applyExternal(buffer.toString('utf8'))
      }
      this.emitTree()
      this.markDirty(p)
    })
  }

  createFolder(p) {
    return this.lock.run(async () => {
      if (this.tree.has(p)) throw new HttpError(409, 'Already exists')
      await fs.mkdir(absPath(this.dir, p), { recursive: true })
      await this._ensureParents(p + '/x')
      if (this.type === 'github') {
        // git does not track empty folders
        await atomicWrite(absPath(this.dir, p + '/.gitkeep'), '')
        this.markDirty(p)
      }
      this.emitTree()
    })
  }

  uniquePath(p) {
    if (!this.tree.has(p)) return p
    const ext = extname(p)
    const base = ext ? stripExt(p) : p
    for (let i = 1; i < 10000; i++) {
      const cand = ext ? `${base} ${i}.${ext}` : `${base} ${i}`
      if (!this.tree.has(cand)) return cand
    }
    return `${base} ${Date.now()}${ext ? '.' + ext : ''}`
  }

  move(from, to, { updateLinks = true, userId } = {}) {
    return this.lock.run(async () => {
      const entry = this.tree.get(from)
      if (!entry) throw new HttpError(404, 'Not found')
      if (from === to) return { moved: [] }
      if (to.startsWith(from + '/')) throw new HttpError(400, 'Cannot move a folder into itself')
      if (this.tree.has(to) && to.toLowerCase() !== from.toLowerCase()) throw new HttpError(409, 'Destination already exists')

      // collect affected files
      const moves = []
      if (entry.type === 'folder') {
        for (const e of this.tree.values()) if (e.path.startsWith(from + '/')) moves.push({ from: e.path, to: to + e.path.slice(from.length), type: e.type })
      }
      moves.push({ from, to, type: entry.type })
      const fileMoves = new Map(moves.filter((m) => m.type === 'file').map((m) => [m.from, m.to]))

      // flush live docs (and canvas layers) that will move
      for (const m of fileMoves.keys()) {
        const doc = this.docs.get(m)
        if (doc) await this._saveDoc(doc)
        const layer = this.layers.get(m)
        if (layer) await this._saveDoc(layer)
      }

      // pre-compute link resolutions with the old layout
      const pending = []
      if (updateLinks) {
        for (const [notePath, meta] of this.meta) {
          const newNotePath = fileMoves.get(notePath) || notePath
          for (const link of meta.links) {
            const resolved = this.resolver.resolve(link.target, notePath, link.kind)
            if (!resolved) continue
            const newTarget = fileMoves.get(resolved)
            if (newTarget || (newNotePath !== notePath && link.kind === 'md')) {
              pending.push({ notePath: newNotePath, link, newTarget: newTarget || resolved })
            }
          }
        }
      }

      // perform the move on disk
      const absFrom = absPath(this.dir, from)
      const absTo = absPath(this.dir, to)
      await fs.mkdir(path.dirname(absTo), { recursive: true })
      await fs.rename(absFrom, absTo)

      // update in-memory state
      for (const m of moves) {
        const e = this.tree.get(m.from)
        this.tree.delete(m.from)
        this.tree.set(m.to, { ...e, path: m.to })
        if (m.type === 'file') {
          this.resolver.remove(m.from)
          this.resolver.add(m.to)
          if (this.contents.has(m.from)) {
            const c = this.contents.get(m.from)
            const meta = this.meta.get(m.from)
            this.dropContent(m.from)
            this.contents.set(m.to, c)
            this.meta.set(m.to, meta)
          }
          const doc = this.docs.get(m.from)
          if (doc) doc.evict('moved', { from: m.from, to: m.to })
          if (isNote(m.from)) {
            this.layers.get(m.from)?.evict('moved', { from: m.from, to: m.to })
            if (isNote(m.to)) await this._moveLayer(m.from, m.to).catch((e) => console.error('[layer move]', e.message))
          }
        }
      }
      await this._ensureParents(to)
      if (this.type === 'online') {
        for (const [f, t] of fileMoves) {
          run('UPDATE versions SET path = ? WHERE workspace_id = ? AND path = ?', t, this.id, f)
          run('UPDATE note_shares SET path = ? WHERE workspace_id = ? AND path = ?', t, this.id, f)
          run('UPDATE published SET path = ? WHERE workspace_id = ? AND path = ?', t, this.id, f)
        }
      }

      // rewrite links
      const byNote = new Map()
      for (const item of pending) {
        const after = this.resolver.resolve(item.link.target, item.notePath, item.link.kind)
        if (after === item.newTarget) continue
        if (!byNote.has(item.notePath)) byNote.set(item.notePath, [])
        byNote.get(item.notePath).push(item)
      }
      const updated = []
      for (const [notePath, items] of byNote) {
        const text = this.docs.get(notePath)?.text ?? this.contents.get(notePath)
        if (text == null) continue
        const next = rewriteLinks(text, notePath, items, this.resolver)
        if (next !== text) {
          await this._writeNote(notePath, next, { userId })
          updated.push(notePath)
        }
      }

      for (const m of moves) {
        this.emitIndex(m.from)
        if (this.meta.has(m.to)) this.emitIndex(m.to)
        this.markDirty(m.to)
      }
      this.emit({ t: 'moved', ws: this.id, from, to })
      this.emitTree()
      return { moved: moves.map((m) => ({ from: m.from, to: m.to })), updatedLinks: updated }
    })
  }

  remove(p, { userId } = {}) {
    return this.lock.run(async () => {
      const entry = this.tree.get(p)
      if (!entry) throw new HttpError(404, 'Not found')
      const affected = [...this.tree.values()].filter((e) => e.path === p || e.path.startsWith(p + '/'))
      for (const e of affected) {
        const doc = this.docs.get(e.path)
        if (doc) {
          await this._saveDoc(doc)
          doc.evict('deleted')
        }
        const layer = this.layers.get(e.path)
        if (layer) {
          await this._saveDoc(layer)
          layer.evict('deleted')
        }
      }
      const abs = absPath(this.dir, p)
      // the note's canvas layer: a file for a note, a directory for a folder
      const layerRel = entry.type === 'folder' ? `${LAYER_DIR}/${p}` : isNote(p) ? layerPathFor(p) : null
      const layerAbs = layerRel ? absPath(this.dir, layerRel) : null
      const hasLayer = layerAbs ? await exists(layerAbs) : false
      if (this.type === 'online') {
        const trashDir = path.join(this.dir, '.trash')
        await fs.mkdir(trashDir, { recursive: true })
        const id = newId(16)
        await fs.rename(abs, path.join(trashDir, id))
        if (hasLayer) {
          const [fileName, dirName] = trashCompanions(id)
          await fs.rename(layerAbs, path.join(trashDir, entry.type === 'folder' ? dirName : fileName)).catch(() => {})
        }
        run('INSERT INTO trash (id, workspace_id, original_path, trash_name, kind, deleted_by, deleted_at) VALUES (?,?,?,?,?,?,?)', id, this.id, p, id, entry.type, userId, now())
      } else {
        await fs.rm(abs, { recursive: true, force: true })
        if (hasLayer) {
          await fs.rm(layerAbs, { recursive: true, force: true })
          this.markDirty(layerRel)
        }
      }
      for (const e of affected) {
        this.tree.delete(e.path)
        if (e.type === 'file') {
          this.resolver.remove(e.path)
          if (this.meta.has(e.path)) {
            this.dropContent(e.path)
            this.emitIndex(e.path)
          }
          this.markDirty(e.path)
        }
      }
      if (entry.type === 'folder') this.markDirty(p)
      this.emit({ t: 'deleted', ws: this.id, path: p })
      this.emitTree()
    })
  }

  restoreTrash(trashId) {
    return this.lock.run(async () => {
      const row = one('SELECT * FROM trash WHERE id = ? AND workspace_id = ?', trashId, this.id)
      if (!row) throw new HttpError(404, 'Not found')
      let target = row.original_path
      if (this.tree.has(target)) target = this.uniquePath(target)
      const abs = absPath(this.dir, target)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.rename(path.join(this.dir, '.trash', row.trash_name), abs)
      const [layerFile, layerDir] = trashCompanions(row.trash_name).map((n) => path.join(this.dir, '.trash', n))
      const layerSrc = row.kind === 'folder' ? layerDir : layerFile
      if (await exists(layerSrc)) {
        const dst = absPath(this.dir, row.kind === 'folder' ? `${LAYER_DIR}/${target}` : layerPathFor(target))
        await fs.mkdir(path.dirname(dst), { recursive: true })
        await fs.rename(layerSrc, dst).catch(() => {})
      }
      run('DELETE FROM trash WHERE id = ?', trashId)
      // re-scan restored subtree
      const added = row.kind === 'folder' ? (await scanDir(abs)).map((e) => ({ ...e, path: `${target}/${e.path}` })) : []
      const st = await fs.stat(abs)
      added.push({ path: target, type: row.kind === 'folder' ? 'folder' : 'file', size: st.size, mtime: Math.round(st.mtimeMs) })
      await this._ensureParents(target)
      for (const e of added) {
        this.tree.set(e.path, e)
        if (e.type === 'file') {
          this.resolver.add(e.path)
          if (isNote(e.path) && e.size <= MAX_INDEX_BYTES) {
            this.setContent(e.path, await fs.readFile(absPath(this.dir, e.path), 'utf8'))
            this.emitIndex(e.path)
          }
        }
      }
      this.emitTree()
      return target
    })
  }

  async purgeTrash(trashId) {
    const rows = trashId ? all('SELECT * FROM trash WHERE id = ? AND workspace_id = ?', trashId, this.id) : all('SELECT * FROM trash WHERE workspace_id = ?', this.id)
    for (const row of rows) {
      for (const n of [row.trash_name, ...trashCompanions(row.trash_name)]) await fs.rm(path.join(this.dir, '.trash', n), { recursive: true, force: true })
      run('DELETE FROM trash WHERE id = ?', row.id)
    }
  }

  // ---------- search ----------
  search(query, { limit = 60, paths = null } = {}) {
    const terms = parseQuery(query || '')
    if (!terms.length) return []
    const plain = terms.filter((t) => !t.op && !t.neg)
    const results = []
    for (const [p, content] of this.contents) {
      if (paths && !paths.has(p)) continue
      const meta = this.meta.get(p)
      const title = noteTitle(p).toLowerCase()
      let lower = this.lower.get(p)
      if (!lower) {
        lower = content.toLowerCase()
        this.lower.set(p, lower)
      }
      let ok = true
      let score = 0
      for (const t of terms) {
        let has
        switch (t.op) {
          case 'tag': {
            const v = t.value.replace(/^#/, '')
            has = meta.tags.some((tag) => {
              const l = tag.toLowerCase()
              return l === v || l.startsWith(v + '/')
            })
            break
          }
          case 'path':
          case 'folder':
            has = p.toLowerCase().includes(t.value)
            break
          case 'file':
          case 'title':
            has = title.includes(t.value)
            break
          case 'task':
            has = meta.tasks.some((k) => k.text.toLowerCase().includes(t.value))
            break
          default: {
            const inTitle = title.includes(t.value)
            let count = 0
            let i = lower.indexOf(t.value)
            while (i >= 0 && count < 25) {
              count++
              i = lower.indexOf(t.value, i + t.value.length)
            }
            has = inTitle || count > 0
            score += (inTitle ? (title === t.value ? 40 : 15) : 0) + Math.min(count, 25)
          }
        }
        if (t.neg ? has : !has) {
          ok = false
          break
        }
      }
      if (!ok) continue
      const matches = []
      if (plain.length) {
        const seen = new Set()
        for (const t of plain) {
          let i = lower.indexOf(t.value)
          while (i >= 0 && matches.length < 6) {
            const ls = lower.lastIndexOf('\n', i - 1) + 1
            let le = lower.indexOf('\n', i)
            if (le < 0) le = lower.length
            if (!seen.has(ls)) {
              seen.add(ls)
              const line = content.slice(0, ls).split('\n').length - 1
              const raw = content.slice(ls, le)
              const col = i - ls
              const start = Math.max(0, col - 60)
              const snippet = (start > 0 ? '…' : '') + raw.slice(start, start + 180) + (raw.length > start + 180 ? '…' : '')
              const offset = (start > 0 ? 1 : 0) - start
              const ranges = []
              const sl = snippet.toLowerCase()
              for (const tt of plain) {
                let j = sl.indexOf(tt.value)
                while (j >= 0 && ranges.length < 10) {
                  ranges.push([j, j + tt.value.length])
                  j = sl.indexOf(tt.value, j + tt.value.length)
                }
              }
              void offset
              matches.push({ line, text: snippet, ranges })
            }
            i = lower.indexOf(t.value, le)
          }
        }
      }
      results.push({ path: p, score, mtime: this.tree.get(p)?.mtime || 0, matches })
    }
    results.sort((a, b) => b.score - a.score || b.mtime - a.mtime)
    return results.slice(0, limit)
  }

  backlinks(target) {
    const linked = []
    const unlinked = []
    const title = noteTitle(target)
    const titleLower = title.toLowerCase()
    const aliases = (this.meta.get(target)?.aliases || []).map((a) => a.toLowerCase())
    const needles = [titleLower, ...aliases].filter((n) => n.length >= 3)
    for (const [p, meta] of this.meta) {
      if (p === target) continue
      const content = this.contents.get(p)
      const lines = content.split('\n')
      const hits = []
      for (const link of meta.links) {
        if (this.resolver.resolve(link.target, p, link.kind) === target) {
          if (!hits.some((h) => h.line === link.line)) hits.push({ line: link.line, text: (lines[link.line] || '').trim().slice(0, 300) })
        }
      }
      if (hits.length) {
        linked.push({ path: p, hits })
        continue
      }
      if (!needles.length) continue
      let lower = this.lower.get(p)
      if (!lower) {
        lower = content.toLowerCase()
        this.lower.set(p, lower)
      }
      if (!needles.some((n) => lower.includes(n))) continue
      const uh = []
      for (let i = 0; i < lines.length && uh.length < 5; i++) {
        const l = lines[i].toLowerCase()
        for (const n of needles) {
          const idx = l.indexOf(n)
          if (idx < 0) continue
          const before = idx === 0 || !/[\p{L}\p{N}]/u.test(l[idx - 1])
          const after = idx + n.length >= l.length || !/[\p{L}\p{N}]/u.test(l[idx + n.length])
          if (before && after && !/\[\[[^\]]*$/.test(l.slice(0, idx))) {
            uh.push({ line: i, text: lines[i].trim().slice(0, 300) })
            break
          }
        }
      }
      if (uh.length) unlinked.push({ path: p, hits: uh })
    }
    return { linked, unlinked }
  }

  // ---------- git sync ----------
  markDirty(p) {
    this.rev++
    for (const fn of this.changeListeners) fn(p)
    if (this.type !== 'github') return
    if (p) this.dirtyPaths.add(p)
    this.syncState.dirty = true
    this.setSync({ state: this.syncState.syncing ? 'syncing' : 'dirty' })
    const delay = Math.max(5, Number(this.settings.autoSyncSeconds ?? 30)) * 1000
    clearTimeout(this.syncTimer)
    if (this.settings.autoSync !== false) this.syncTimer = setTimeout(() => this.requestSync(), delay)
  }

  startPullLoop() {
    clearInterval(this.pullTimer)
    const every = Math.max(30, Number(this.settings.pullIntervalSeconds ?? 120)) * 1000
    this.pullTimer = setInterval(() => {
      if (this.closed) return
      if ((this.subscribers.size || this.docs.size) && this.settings.autoSync !== false) this.requestSync()
    }, every)
    this.pullTimer.unref?.()
  }

  requestSync() {
    if (this.type !== 'github' || this.closed) return Promise.resolve(this.syncStatus())
    if (this.syncPromise) {
      this.syncAgain = true
      return this.syncPromise
    }
    this.syncPromise = (async () => {
      try {
        do {
          this.syncAgain = false
          await this.lock.run(() => this.doSync())
        } while (this.syncAgain && !this.closed)
      } finally {
        this.syncPromise = null
      }
      return this.syncStatus()
    })()
    return this.syncPromise
  }

  async doSync({ initial = false } = {}) {
    if (this.initError && !initial) {
      // try again from scratch
      try {
        await git.initRepo(this.dir, this.gitOpts())
        this.initError = null
      } catch (e) {
        this.setSync({ state: 'error', error: e.message })
        return
      }
    }
    clearTimeout(this.syncTimer)
    this.syncState.syncing = true
    this.setSync({ state: initial ? 'cloning' : 'syncing' })
    try {
      await this.flushDocs()
      const opts = this.gitOpts()
      const files = [...this.dirtyPaths]
      const message = files.length
        ? `${files.length === 1 ? 'Update' : `Update ${files.length} files:`} ${files.slice(0, 3).map(commitLabel).join(', ')}${files.length > 3 ? ` +${files.length - 3} more` : ''}`
        : 'Update notes'
      const dirtyBefore = new Set(this.dirtyPaths)
      let result = await git.syncRepo(this.dir, { ...opts, message })
      if (result.retry) result = await git.syncRepo(this.dir, { ...opts, message })
      if (result.retry) throw new Error('Push was rejected, will retry shortly')
      for (const f of dirtyBefore) this.dirtyPaths.delete(f)
      if (!initial) await this.applyRemoteChanges(result.changed)
      const t = now()
      run('UPDATE workspaces SET last_sync_at = ?, sync_error = NULL WHERE id = ?', t, this.id)
      this.syncState.dirty = this.dirtyPaths.size > 0
      this.syncState.syncing = false
      this.setSync({ state: this.syncState.dirty ? 'dirty' : 'idle', lastSync: t, error: null })
      if (result.conflicts.length) this.emit({ t: 'conflicts', ws: this.id, conflicts: result.conflicts })
    } catch (e) {
      console.error(`[sync ${this.id}]`, e.message, e.details || '')
      run('UPDATE workspaces SET sync_error = ? WHERE id = ?', e.message, this.id)
      this.syncState.syncing = false
      this.setSync({ state: 'error', error: e.message })
      if (initial) throw e
      // back-off retry
      clearTimeout(this.syncTimer)
      if (this.syncState.dirty) this.syncTimer = setTimeout(() => this.requestSync(), 120000)
    }
  }

  async applyRemoteChanges(changed) {
    if (changed && changed.length === 0) return
    this.rev++
    if (changed === null) {
      await this.scan()
      for (const doc of this.docs.values()) {
        const t = doc.kind === 'board' ? await fs.readFile(absPath(this.dir, doc.path), 'utf8').catch(() => null) : this.contents.get(doc.path)
        if (t != null && t !== doc.text) doc.applyExternal(t)
      }
      for (const doc of this.layers.values()) {
        doc.applyExternal(await fs.readFile(absPath(this.dir, layerPathFor(doc.path)), 'utf8').catch(() => ''))
      }
      this.emit({ t: 'reindex', ws: this.id })
      this.emitTree()
      return
    }
    let treeChanged = false
    for (const rel of changed) {
      const abs = absPath(this.dir, rel)
      const st = await fs.stat(abs).catch(() => null)
      const layerOf = notePathForLayer(rel)
      if (layerOf != null) {
        const doc = this.layers.get(layerOf)
        if (doc) doc.applyExternal(st ? await fs.readFile(abs, 'utf8') : '')
        continue
      }
      if (rel.split('/').some((s) => s.startsWith('.'))) continue
      if (!st) {
        if (this.tree.has(rel)) {
          this.tree.delete(rel)
          this.resolver.remove(rel)
          treeChanged = true
          const doc = this.docs.get(rel)
          if (doc) doc.evict('deleted')
          if (this.meta.has(rel)) {
            this.dropContent(rel)
            this.emitIndex(rel)
          }
        }
        // prune now-empty parent folders
        let d = dirname(rel)
        while (d && this.tree.has(d) && !(await exists(absPath(this.dir, d)))) {
          this.tree.delete(d)
          d = dirname(d)
        }
        continue
      }
      if (!this.tree.has(rel)) {
        this.resolver.add(rel)
        treeChanged = true
      }
      this.tree.set(rel, { path: rel, type: 'file', size: st.size, mtime: Math.round(st.mtimeMs) })
      await this._ensureParents(rel)
      if (isNote(rel) && st.size <= MAX_INDEX_BYTES) {
        const text = await fs.readFile(abs, 'utf8')
        this.setContent(rel, text)
        const doc = this.docs.get(rel)
        if (doc && doc.text !== text) doc.applyExternal(text)
        this.emitIndex(rel)
      } else if (isBoardPath(rel)) {
        const doc = this.docs.get(rel)
        if (doc) doc.applyExternal(await fs.readFile(abs, 'utf8'))
      }
    }
    if (treeChanged) this.emitTree()
  }

  async shutdown({ save = true, finalSync = false } = {}) {
    if (this.closed) return
    clearTimeout(this.syncTimer)
    clearInterval(this.pullTimer)
    if (save) {
      await this.lock.run(() => this.flushDocs()).catch(() => {})
      if (finalSync && this.type === 'github' && this.dirtyPaths.size) {
        await Promise.race([this.requestSync(), new Promise((r) => setTimeout(r, 8000))]).catch(() => {})
      }
    }
    this.closed = true
    for (const doc of [...this.docs.values()]) doc.evict('closed')
    for (const doc of [...this.layers.values()]) doc.evict('closed')
  }
}

export const layerDocKey = (wsId, notePath) => `${wsId}:${notePath}\u0000layer`

function commitLabel(p) {
  const note = notePathForLayer(p)
  return note != null ? `${basename(note)} (canvas)` : basename(p)
}

// ---------- link rewriting ----------
function encodeMdPath(p) {
  return p.split('/').map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/')
}

function rewriteLinks(text, notePath, items, resolver) {
  const lines = text.split('\n')
  const byLine = new Map()
  for (const it of items) {
    if (!byLine.has(it.link.line)) byLine.set(it.link.line, [])
    byLine.get(it.link.line).push(it)
  }
  for (const [lineNo, its] of byLine) {
    let line = lines[lineNo]
    if (line == null) continue
    its.sort((a, b) => b.link.col - a.link.col)
    for (const { link, newTarget } of its) {
      const re = link.kind === 'wiki' ? /(!?)\[\[([^\[\]\n]+?)\]\]/g : /(!?)\[([^\]\n]*)\]\(<?([^)\s>]+)>?((?:\s+"[^"]*")?)\)/g
      let best = null
      let m
      while ((m = re.exec(line))) {
        const d = Math.abs(m.index - link.col)
        if (!best || d < best.d) best = { m, d }
      }
      if (!best) continue
      const m0 = best.m
      let replacement
      if (link.kind === 'wiki') {
        const linkText = resolver.linkTextFor(newTarget)
        replacement = `${m0[1]}[[${linkText}${link.subpath || ''}${link.display != null ? '|' + link.display : ''}]]`
      } else {
        const rel = relativePath(dirname(notePath), newTarget)
        replacement = `${m0[1]}[${m0[2]}](${encodeMdPath(rel)}${link.subpath || ''}${m0[4] || ''})`
      }
      line = line.slice(0, m0.index) + replacement + line.slice(m0.index + m0[0].length)
    }
    lines[lineNo] = line
  }
  return lines.join('\n')
}

export { joinPath }
