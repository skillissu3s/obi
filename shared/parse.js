// Extract structural metadata (links, tags, headings, tasks, frontmatter) from markdown.
import { parse as parseYaml } from 'yaml'
import { basename, dirname, extname, stripExt, joinPath, normalizePath } from './paths.js'

const WIKI_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu
const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX/\-])\]\s?(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const DUE_RE = /(?:📅|due::?|@due\(?)\s*(\d{4}-\d{2}-\d{2})\)?/u

export function splitFrontmatter(content) {
  if (!content.startsWith('---')) return { frontmatter: null, body: content, bodyLine: 0, raw: '' }
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content)
  if (!m) return { frontmatter: null, body: content, bodyLine: 0, raw: '' }
  let fm = null
  try {
    fm = parseYaml(m[1]) ?? {}
    if (typeof fm !== 'object' || Array.isArray(fm)) fm = { value: fm }
  } catch {
    fm = { _error: 'Invalid YAML' }
  }
  const raw = m[0]
  return { frontmatter: fm, body: content.slice(raw.length), bodyLine: raw.split('\n').length - 1, raw: m[1] }
}

function fmList(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String)
  return String(v).split(/[,\s]+/)
}

export function parseNote(content) {
  const { frontmatter, body, bodyLine } = splitFrontmatter(content || '')
  const links = []
  const tagSet = new Map()
  const headings = []
  const tasks = []
  let words = 0

  if (frontmatter) {
    for (const t of [...fmList(frontmatter.tags), ...fmList(frontmatter.tag)]) {
      const tag = t.replace(/^#/, '').trim()
      if (tag) tagSet.set(tag.toLowerCase(), tag)
    }
  }

  const lines = body.split('\n')
  let inCode = false
  let fence = ''
  let inMath = false
  let inComment = false
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + bodyLine
    let line = lines[i]
    const trimmed = line.trimStart()
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      if (!inCode) {
        inCode = true
        fence = fenceMatch[1][0]
      } else if (fenceMatch[1][0] === fence) {
        inCode = false
      }
      continue
    }
    if (inCode) continue
    if (trimmed.startsWith('$$')) {
      inMath = !inMath
      if (trimmed.length > 2 && trimmed.endsWith('$$') && trimmed.length > 4) inMath = !inMath
      continue
    }
    if (inMath) continue
    if (inComment || line.includes('%%')) {
      // strip Obsidian comments
      let out = ''
      let idx = 0
      while (idx < line.length) {
        const j = line.indexOf('%%', idx)
        if (j < 0) {
          if (!inComment) out += line.slice(idx)
          break
        }
        if (!inComment) out += line.slice(idx, j)
        inComment = !inComment
        idx = j + 2
      }
      line = out
    }

    const h = HEADING_RE.exec(line)
    if (h) headings.push({ level: h[1].length, text: h[2].replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2'), line: lineNo })

    const t = TASK_RE.exec(line)
    if (t) {
      const text = t[3]
      const due = DUE_RE.exec(text)
      tasks.push({
        line: lineNo,
        text,
        status: t[2],
        checked: t[2] === 'x' || t[2] === 'X',
        indent: t[1].length,
        due: due ? due[1] : null,
      })
    }

    // Remove inline code spans before scanning for links/tags
    const scan = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length))
    WIKI_RE.lastIndex = 0
    let m
    while ((m = WIKI_RE.exec(scan))) {
      const raw = m[2]
      const pipe = raw.indexOf('|')
      const targetFull = pipe >= 0 ? raw.slice(0, pipe) : raw
      const display = pipe >= 0 ? raw.slice(pipe + 1) : null
      const hashIdx = targetFull.search(/[#^]/)
      const target = (hashIdx >= 0 ? targetFull.slice(0, hashIdx) : targetFull).trim()
      const subpath = hashIdx >= 0 ? targetFull.slice(hashIdx) : ''
      links.push({ target, subpath, display, embed: m[1] === '!', kind: 'wiki', line: lineNo, col: m.index })
    }
    MDLINK_RE.lastIndex = 0
    while ((m = MDLINK_RE.exec(scan))) {
      let url = m[3]
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) continue
      const hashIdx = url.indexOf('#')
      const subpath = hashIdx >= 0 ? url.slice(hashIdx) : ''
      if (hashIdx >= 0) url = url.slice(0, hashIdx)
      try {
        url = decodeURIComponent(url)
      } catch {}
      links.push({ target: url, subpath, display: m[2], embed: m[1] === '!', kind: 'md', line: lineNo, col: m.index })
    }
    if (!/^\s*#{1,6}\s/.test(scan) || true) {
      TAG_RE.lastIndex = 0
      const tagScan = scan.replace(/\[\[[^\]]*\]\]|\]\([^)]*\)|https?:\/\/\S+/g, (s) => ' '.repeat(s.length))
      while ((m = TAG_RE.exec(tagScan))) {
        const tag = m[2].replace(/\/+$/, '')
        if (tag) tagSet.set(tag.toLowerCase(), tag)
      }
    }
    const w = line.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
    if (w) words += w.length
  }

  const aliases = frontmatter ? fmList(frontmatter.aliases ?? frontmatter.alias).filter(Boolean) : []
  return {
    links,
    tags: [...tagSet.values()],
    headings,
    tasks,
    frontmatter: frontmatter && Object.keys(frontmatter).length ? frontmatter : null,
    aliases,
    words,
  }
}

// ---------- Link resolution ----------

export class LinkResolver {
  constructor(paths = []) {
    this.setPaths(paths)
  }
  setPaths(paths) {
    this.paths = new Map() // lower path -> real path
    this.byName = new Map() // lower basename (no .md for notes; with ext for files) -> [paths]
    for (const p of paths) this.add(p)
  }
  add(p) {
    this.paths.set(p.toLowerCase(), p)
    const key = this._key(p)
    const arr = this.byName.get(key)
    if (arr) {
      if (!arr.includes(p)) arr.push(p)
    } else this.byName.set(key, [p])
  }
  remove(p) {
    this.paths.delete(p.toLowerCase())
    const key = this._key(p)
    const arr = this.byName.get(key)
    if (arr) {
      const i = arr.indexOf(p)
      if (i >= 0) arr.splice(i, 1)
      if (!arr.length) this.byName.delete(key)
    }
  }
  _key(p) {
    const b = basename(p)
    return (extname(p) === 'md' ? stripExt(b) : b).toLowerCase()
  }
  has(p) {
    return this.paths.has(p.toLowerCase())
  }
  resolve(target, fromPath = '', kind = 'wiki') {
    if (!target) return fromPath || null
    let t = target.replace(/\\/g, '/').replace(/^\.\//, '')
    const fromDir = dirname(fromPath || '')
    const tryPath = (p) => {
      const n = normalizePath(p)
      if (n == null) return null
      return this.paths.get(n.toLowerCase()) || this.paths.get((n + '.md').toLowerCase()) || null
    }
    if (kind === 'md' || t.startsWith('../') || t.startsWith('/')) {
      const rel = resolveRelative(fromDir, t)
      const r = rel != null ? tryPath(rel) : null
      if (r) return r
    }
    if (t.includes('/')) {
      const r = tryPath(t.replace(/^\/+/, '')) || tryPath(joinPath(fromDir, t))
      if (r) return r
    }
    const name = basename(t).toLowerCase()
    let cands = this.byName.get(name)
    if (!cands && name.endsWith('.md')) cands = this.byName.get(name.slice(0, -3))
    if (!cands || !cands.length) return null
    if (t.includes('/')) {
      const suffix = t.toLowerCase().replace(/\.md$/, '')
      const filtered = cands.filter((c) => c.toLowerCase().replace(/\.md$/, '').endsWith(suffix))
      if (filtered.length) cands = filtered
      else return null
    }
    if (cands.length === 1) return cands[0]
    const same = cands.find((c) => dirname(c) === fromDir)
    if (same) return same
    return [...cands].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0]
  }
  // Shortest unambiguous wikilink text for a path
  linkTextFor(path) {
    const key = this._key(path)
    const cands = this.byName.get(key) || []
    const base = extname(path) === 'md' ? stripExt(path) : path
    if (cands.length <= 1) return extname(path) === 'md' ? stripExt(basename(path)) : basename(path)
    return base
  }
}

export function resolveRelative(fromDir, rel) {
  const parts = rel.startsWith('/') ? [] : fromDir ? fromDir.split('/') : []
  for (const seg of rel.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

export function relativePath(fromDir, to) {
  const a = fromDir ? fromDir.split('/') : []
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/')
}

// ---------- Search ----------

export function parseQuery(q) {
  const terms = []
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g
  let m
  while ((m = re.exec(q))) {
    const value = (m[3] ?? m[4] ?? '').toLowerCase()
    if (!value) continue
    terms.push({ neg: m[1] === '-', op: m[2]?.toLowerCase() || null, value })
  }
  return terms
}
