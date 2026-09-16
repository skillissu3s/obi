import MarkdownIt from 'markdown-it'
import { splitFrontmatter } from './parse.js'
import { extname, basename, IMAGE_EXT, AUDIO_EXT, VIDEO_EXT, stripExt } from './paths.js'

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function parseWikiInner(inner) {
  const pipe = inner.indexOf('|')
  const targetFull = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
  const display = pipe >= 0 ? inner.slice(pipe + 1).trim() : null
  const h = targetFull.search(/[#^]/)
  const target = h >= 0 ? targetFull.slice(0, h) : targetFull
  const subpath = h >= 0 ? targetFull.slice(h) : ''
  return { target, subpath, display }
}

const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/m

/**
 * opts:
 *  html: allow raw html (must be sanitised by caller)
 *  resolve(target, kind, env) -> { href, exists, path }
 *  fileUrl(path, env) -> string
 */
export function createMarkdown(opts = {}) {
  const md = new MarkdownIt({ html: opts.html ?? false, linkify: true, breaks: true, typographer: false })
  const resolve = opts.resolve || ((t) => ({ href: '#', exists: false, path: null }))
  const fileUrl = opts.fileUrl || ((p) => p)

  // ---- wikilinks & embeds ----
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src
    let pos = state.pos
    let embed = false
    if (src.charCodeAt(pos) === 0x21 && src.charCodeAt(pos + 1) === 0x5b && src.charCodeAt(pos + 2) === 0x5b) {
      embed = true
      pos++
    } else if (!(src.charCodeAt(pos) === 0x5b && src.charCodeAt(pos + 1) === 0x5b)) return false
    const end = src.indexOf(']]', pos + 2)
    if (end < 0 || end > state.posMax) return false
    const inner = src.slice(pos + 2, end)
    if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return false
    if (!silent) {
      const token = state.push(embed ? 'wiki_embed' : 'wikilink', '', 0)
      token.meta = parseWikiInner(inner)
    }
    state.pos = end + 2
    return true
  })

  md.renderer.rules.wikilink = (tokens, idx, _o, env) => {
    const { target, subpath, display } = tokens[idx].meta
    const r = resolve(target, 'wiki', env)
    const text = display || (target ? stripExt(basename(target)) + (subpath ? ' › ' + subpath.replace(/^[#^]+/, '').replace(/#/g, ' › ') : '') : subpath.replace(/^[#^]+/, ''))
    if (r.href === null) return `<span class="internal-link is-unresolved">${escapeHtml(text)}</span>`
    return `<a class="internal-link${r.exists ? '' : ' is-unresolved'}" data-href="${escapeHtml(target + subpath)}" href="${escapeHtml(r.href || '#')}">${escapeHtml(text)}</a>`
  }

  md.renderer.rules.wiki_embed = (tokens, idx, _o, env) => {
    const { target, subpath, display } = tokens[idx].meta
    const ext = extname(target)
    const r = resolve(target, 'wiki', env)
    const src = r.path ? fileUrl(r.path, env) : null
    let size = ''
    if (display && /^\d+(x\d+)?$/.test(display)) {
      const [w, h] = display.split('x')
      size = ` width="${w}"${h ? ` height="${h}"` : ''}`
    }
    if (IMAGE_EXT.has(ext)) {
      if (!src) return `<span class="embed-missing">${escapeHtml(target)}</span>`
      return `<img class="embed-image" src="${escapeHtml(src)}" alt="${escapeHtml(display && !size ? display : basename(target))}"${size} loading="lazy">`
    }
    if (AUDIO_EXT.has(ext) && src) return `<audio class="embed-audio" controls src="${escapeHtml(src)}"></audio>`
    if (VIDEO_EXT.has(ext) && src) return `<video class="embed-video" controls src="${escapeHtml(src)}"${size}></video>`
    if (ext === 'pdf' && src) return `<iframe class="embed-pdf" src="${escapeHtml(src)}"></iframe>`
    if (opts.noteEmbeds === false || !r.exists) {
      return `<a class="internal-link${r.exists ? '' : ' is-unresolved'}" data-href="${escapeHtml(target + subpath)}" href="${escapeHtml(r.href || '#')}">${escapeHtml(display || stripExt(basename(target)))}</a>`
    }
    return `<div class="embed-note" data-href="${escapeHtml(target + subpath)}" data-path="${escapeHtml(r.path || '')}"><div class="embed-note-title">${escapeHtml(stripExt(basename(target)))}${subpath ? ' › ' + escapeHtml(subpath.replace(/^#/, '')) : ''}</div><div class="embed-note-body">…</div></div>`
  }

  // ---- tags ----
  const TAG = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u
  md.inline.ruler.after('wikilink', 'tag', (state, silent) => {
    const src = state.src
    const pos = state.pos
    if (src.charCodeAt(pos) !== 0x23) return false
    if (pos > 0 && !/[\s(,;]/.test(src[pos - 1])) return false
    const m = TAG.exec(src.slice(pos, state.posMax))
    if (!m) return false
    if (!silent) {
      const t = state.push('tag', '', 0)
      t.content = m[1]
    }
    state.pos += m[0].length
    return true
  })
  md.renderer.rules.tag = (tokens, idx) => `<a class="tag" data-tag="${escapeHtml(tokens[idx].content)}" href="#">#${escapeHtml(tokens[idx].content)}</a>`

  // ---- ==highlight== ----
  md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
    const src = state.src
    const pos = state.pos
    if (src.charCodeAt(pos) !== 0x3d || src.charCodeAt(pos + 1) !== 0x3d) return false
    const end = src.indexOf('==', pos + 2)
    if (end < 0 || end > state.posMax || end === pos + 2) return false
    if (/\s/.test(src[pos + 2]) || /\s/.test(src[end - 1])) return false
    if (!silent) {
      state.push('mark_open', 'mark', 1)
      const oldMax = state.posMax
      state.pos = pos + 2
      state.posMax = end
      state.md.inline.tokenize(state)
      state.posMax = oldMax
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })

  // ---- math ----
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src
    const pos = state.pos
    if (src.charCodeAt(pos) !== 0x24) return false
    if (src.charCodeAt(pos + 1) === 0x24) return false
    if (/\s/.test(src[pos + 1] || ' ')) return false
    let end = pos + 1
    while ((end = src.indexOf('$', end)) >= 0) {
      if (src[end - 1] !== '\\') break
      end++
    }
    if (end < 0 || end > state.posMax || /\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || '')) return false
    const content = src.slice(pos + 1, end)
    if (content.includes('\n\n')) return false
    if (!silent) {
      const t = state.push('math_inline', 'span', 0)
      t.content = content
    }
    state.pos = end + 1
    return true
  })
  md.renderer.rules.math_inline = (tokens, idx) => `<span class="math math-inline">${escapeHtml(tokens[idx].content)}</span>`

  md.block.ruler.before(
    'fence',
    'math_block',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine]
      const max = state.eMarks[startLine]
      if (state.src.slice(start, start + 2) !== '$$') return false
      const first = state.src.slice(start + 2, max)
      let content = ''
      let next = startLine
      if (first.trim().endsWith('$$') && first.trim().length >= 2) {
        content = first.trim().slice(0, -2)
      } else {
        const lines = [first]
        let found = false
        for (next = startLine + 1; next < endLine; next++) {
          const s = state.bMarks[next] + state.tShift[next]
          const line = state.src.slice(s, state.eMarks[next])
          if (line.trim().endsWith('$$')) {
            lines.push(line.trim().slice(0, -2))
            found = true
            break
          }
          lines.push(line)
        }
        if (!found) return false
        content = lines.join('\n')
      }
      if (silent) return true
      const t = state.push('math_block', 'div', 0)
      t.content = content.trim()
      t.map = [startLine, next + 1]
      state.line = next + 1
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )
  md.renderer.rules.math_block = (tokens, idx) => `<div class="math math-block">${escapeHtml(tokens[idx].content)}</div>\n`

  // ---- callouts ----
  md.core.ruler.after('block', 'callouts', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue
      if (tokens[i + 1]?.type !== 'paragraph_open' || tokens[i + 2]?.type !== 'inline') continue
      const inline = tokens[i + 2]
      const m = CALLOUT_RE.exec(inline.content.split('\n')[0])
      if (!m) continue
      const type = m[1].toLowerCase()
      tokens[i].attrJoin('class', `callout`)
      tokens[i].attrSet('data-callout', type)
      if (m[2]) tokens[i].attrSet('data-fold', m[2])
      const title = new state.Token('callout_title', '', 0)
      title.content = m[3] || type.charAt(0).toUpperCase() + type.slice(1)
      title.meta = { type, fold: m[2] }
      const nl = inline.content.indexOf('\n')
      const rest = nl >= 0 ? inline.content.slice(nl + 1) : ''
      if (rest.trim()) {
        inline.content = rest
        tokens.splice(i + 1, 0, title)
      } else {
        tokens.splice(i + 1, 3, title)
      }
    }
  })
  md.renderer.rules.callout_title = (tokens, idx) => {
    const t = tokens[idx]
    return `<div class="callout-title"><span class="callout-icon" aria-hidden="true"></span><span class="callout-title-inner">${md.renderInline(t.content)}</span>${t.meta.fold ? '<span class="callout-fold"></span>' : ''}</div>\n`
  }

  // ---- task lists + heading ids + external links ----
  md.core.ruler.after('inline', 'obi_post', (state) => {
    const tokens = state.tokens
    const lineOffset = state.env?.lineOffset || 0
    const slugs = new Map()
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.type === 'inline' && tokens[i - 1]?.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open') {
        const m = /^\[([ xX/\-])\][ \t]/.exec(tok.content) || /^\[([ xX/\-])\]$/.exec(tok.content)
        if (m && tok.children?.length && tok.children[0].type === 'text') {
          const li = tokens[i - 2]
          const checked = m[1] !== ' '
          li.attrJoin('class', 'task-list-item')
          if (checked) li.attrJoin('class', 'is-checked')
          li.attrSet('data-task', m[1])
          const first = tok.children[0]
          first.content = first.content.slice(m[0].length)
          const cb = new state.Token('html_inline', '', 0)
          const line = (li.map?.[0] ?? 0) + lineOffset
          cb.content = `<input type="checkbox" class="task-checkbox" data-line="${line}"${checked ? ' checked' : ''}>`
          tok.children.unshift(cb)
          // find parent list and mark it
          for (let j = i - 3; j >= 0; j--) {
            if (tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') {
              if (tokens[j].level === li.level - 1) {
                tokens[j].attrJoin('class', 'contains-task-list')
                break
              }
            }
          }
        }
      }
      if (tok.type === 'heading_open' && tokens[i + 1]?.type === 'inline') {
        let slug = slugify(tokens[i + 1].content)
        const n = slugs.get(slug) || 0
        slugs.set(slug, n + 1)
        if (n) slug += '-' + n
        tok.attrSet('id', slug)
        if (tok.map) tok.attrSet('data-line', String(tok.map[0] + lineOffset))
      }
      if (tok.type === 'inline' && tok.children) {
        for (const c of tok.children) {
          if (c.type !== 'link_open') continue
          const href = c.attrGet('href') || ''
          if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            c.attrSet('target', '_blank')
            c.attrSet('rel', 'noopener noreferrer')
            c.attrJoin('class', 'external-link')
          } else if (!href.startsWith('#')) {
            let target = href
            try {
              target = decodeURIComponent(href)
            } catch {}
            const r = resolve(target.replace(/#.*$/, ''), 'md', state.env)
            c.attrSet('data-href', target)
            c.attrJoin('class', 'internal-link' + (r.exists ? '' : ' is-unresolved'))
            c.attrSet('href', r.href || '#')
          }
        }
      }
      if (tok.type === 'inline' && tok.children) {
        for (const c of tok.children) {
          if (c.type === 'image') {
            const src = c.attrGet('src') || ''
            if (!/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//')) {
              let target = src
              try {
                target = decodeURIComponent(src)
              } catch {}
              const r = resolve(target, 'md', state.env)
              if (r.path) c.attrSet('src', fileUrl(r.path, state.env))
            }
            c.attrSet('loading', 'lazy')
          }
        }
      }
    }
  })

  // ---- fences: mermaid ----
  const defaultFence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const t = tokens[idx]
    const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase()
    if (lang === 'mermaid') return `<div class="mermaid-block">${escapeHtml(t.content)}</div>\n`
    return defaultFence(tokens, idx, options, env, self)
  }

  const render = (content, env = {}) => {
    const { frontmatter, body, bodyLine } = splitFrontmatter(content || '')
    // strip %% comments %% (keeps line count stable)
    const cleaned = body.replace(/%%[\s\S]*?%%/g, (s) => s.replace(/[^\n]/g, ''))
    const html = md.render(cleaned, { ...env, lineOffset: bodyLine })
    return { html, frontmatter }
  }

  return { md, render }
}

export { escapeHtml }
