import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { normalizePath } from '../shared/paths.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function safePath(p, { allowRoot = false, allowHidden = false } = {}) {
  const n = normalizePath(p)
  if (n == null) throw new HttpError(400, 'Invalid path')
  if (!allowRoot && n === '') throw new HttpError(400, 'Path is required')
  if (!allowHidden && n.split('/').some((s) => s.startsWith('.'))) throw new HttpError(400, 'Hidden paths are not allowed')
  if (n.length > 1024) throw new HttpError(400, 'Path too long')
  return n
}

export function absPath(root, rel) {
  const abs = path.resolve(root, rel)
  const r = path.resolve(root)
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new HttpError(400, 'Invalid path')
  return abs
}

export async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(4).toString('hex')}.tmp`)
  await fs.writeFile(tmp, data)
  try {
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

export async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

// Walk the workspace directory, skipping hidden entries.
export async function scanDir(root) {
  const entries = []
  async function walk(dir, rel) {
    let items
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      items.map(async (it) => {
        if (it.name.startsWith('.')) return
        const childRel = rel ? `${rel}/${it.name}` : it.name
        const abs = path.join(dir, it.name)
        if (it.isDirectory()) {
          let st
          try {
            st = await fs.stat(abs)
          } catch {
            return
          }
          entries.push({ path: childRel, type: 'folder', size: 0, mtime: Math.round(st.mtimeMs) })
          await walk(abs, childRel)
        } else if (it.isFile()) {
          try {
            const st = await fs.stat(abs)
            entries.push({ path: childRel, type: 'file', size: st.size, mtime: Math.round(st.mtimeMs) })
          } catch {}
        }
      }),
    )
  }
  await walk(root, '')
  return entries
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

export class Mutex {
  constructor() {
    this.p = Promise.resolve()
  }
  run(fn) {
    const r = this.p.then(fn)
    this.p = r.catch(() => {})
    return r
  }
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime',
  ogv: 'video/ogg', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json',
  csv: 'text/csv; charset=utf-8', canvas: 'application/json',
}
export const mimeFor = (ext) => MIME[ext] || 'application/octet-stream'
export const INLINE_SAFE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'pdf', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm', 'mp4', 'mov', 'ogv', 'txt', 'md'])
