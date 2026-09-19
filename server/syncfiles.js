// Which files of a workspace are synced between the desktop app and the cloud,
// and how they are read and written. Shared by both ends: the cloud's sync API
// and the desktop app's sync engine write through the same runtime methods, so
// open editors, the index, versions and the trash all stay in step.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { absPath } from './fsutil.js'
import { isNote } from '../shared/paths.js'
import { LAYER_DIR, notePathForLayer } from '../shared/board.js'

const JUNK = new Set(['Thumbs.db', 'desktop.ini'])

/** Notes, attachments and canvas layers — not .git, .trash or other dot-files */
export function isSyncPath(p) {
  if (!p || p.length > 1024) return false
  if (p.startsWith(LAYER_DIR + '/')) return p.endsWith('.json') && !p.slice(LAYER_DIR.length + 1).split('/').some((s) => s.startsWith('.') || !s)
  const parts = p.split('/')
  return !parts.some((s) => !s || s.startsWith('.')) && !JUNK.has(parts.at(-1))
}

export const hashBytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** Every synced file under `dir`: [{ path, size, mtime }] */
export async function listSyncFiles(dir) {
  const out = []
  async function walk(abs, rel) {
    let items
    try {
      items = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const childRel = rel ? `${rel}/${it.name}` : it.name
      const childAbs = path.join(abs, it.name)
      if (it.isDirectory()) {
        // hidden folders are skipped, except the path down to the canvas layers
        if (it.name.startsWith('.') && !(LAYER_DIR + '/').startsWith(childRel + '/')) continue
        await walk(childAbs, childRel)
      } else if (it.isFile() && isSyncPath(childRel)) {
        try {
          const st = await fs.stat(childAbs)
          out.push({ path: childRel, size: st.size, mtime: st.mtimeMs })
        } catch {}
      }
    }
  }
  await walk(dir, '')
  return out
}

/** Hashes files, reusing earlier results while size and mtime are unchanged */
export class HashCache {
  constructor() {
    this.map = new Map()
  }
  async hash(dir, e) {
    const c = this.map.get(e.path)
    if (c && c.size === e.size && c.mtime === e.mtime) return c.hash
    const hash = hashBytes(await fs.readFile(absPath(dir, e.path)))
    this.map.set(e.path, { size: e.size, mtime: e.mtime, hash })
    return hash
  }
  /** { path: hash } for the whole folder */
  async manifest(dir) {
    const files = await listSyncFiles(dir)
    const out = {}
    for (const e of files) {
      try {
        out[e.path] = await this.hash(dir, e)
      } catch {}
    }
    for (const p of this.map.keys()) if (!(p in out)) this.map.delete(p)
    return out
  }
}

/** Current bytes of a synced file (after open editors are saved), or null */
export async function readSynced(rt, p) {
  await rt.lock.run(() => rt.flushDocs())
  try {
    return await fs.readFile(absPath(rt.dir, p))
  } catch {
    return null
  }
}

/** Writes a synced file through the runtime, so open documents update live */
export async function writeSynced(rt, p, buf, { userId = null } = {}) {
  const layerOf = notePathForLayer(p)
  if (layerOf != null) return rt.importLayer(layerOf, buf.toString('utf8'))
  // a note replaced from another device keeps its previous text as a version
  // (at most one a minute, so a burst of saves doesn't flood the history)
  if (isNote(p)) return rt.writeNote(p, buf.toString('utf8'), { userId, snapshotEvery: 60 * 1000 })
  return rt.writeFile(p, buf)
}

/** Removes a synced file: notes and attachments go to the trash, not away */
export async function deleteSynced(rt, p, { userId = null } = {}) {
  const layerOf = notePathForLayer(p)
  if (layerOf != null) {
    return rt.lock.run(async () => {
      rt.layers.get(layerOf)?.applyExternal('')
      await rt._writeLayer(layerOf, null)
    })
  }
  if (!rt.tree.has(p)) return
  return rt.remove(p, { userId })
}
