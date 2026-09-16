import DOMPurify from 'dompurify'
import { createMarkdown } from '@shared/markdown.js'
import { useApp } from '../store/app.js'
import { api } from './api.js'

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'iframe') {
    const src = node.getAttribute('src') || ''
    let url
    try {
      url = new URL(src, location.href)
    } catch {
      node.remove()
      return
    }
    if (url.origin === location.origin) {
      if (!url.pathname.startsWith('/api/workspaces/')) node.remove()
    } else {
      node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
      node.setAttribute('loading', 'lazy')
    }
  }
})
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer')
})

const PURIFY = { ADD_TAGS: ['iframe'], ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder', 'loading'], FORBID_TAGS: ['style', 'form'] }

function resolveFor(env) {
  return (target, kind) => {
    const s = useApp.getState()
    if (env.ws && env.ws !== s.wsId) return { href: '#', exists: false, path: target.replace(/^\/+/, '') || null }
    const p = s.resolver.resolve(target, env.path || '', kind)
    return { href: '#', exists: !!p, path: p }
  }
}

const md = createMarkdown({
  html: true,
  resolve: (target, kind, env) => resolveFor(env)(target, kind),
  fileUrl: (p, env) => api.fileUrl(env.ws || useApp.getState().wsId, p),
})

export function renderMarkdown(content, env = {}) {
  const { html, frontmatter } = md.render(content, env)
  return { html: DOMPurify.sanitize(html, PURIFY), frontmatter }
}

export function renderInline(text, env = {}) {
  return DOMPurify.sanitize(md.md.renderInline(text, env), PURIFY)
}

// Extract the section under a heading (for [[Note#Heading]] embeds)
export function extractSection(content, subpath) {
  if (!subpath) return content
  const name = subpath.replace(/^#+/, '').split('#').pop().trim().toLowerCase()
  if (subpath.startsWith('^')) {
    const id = subpath.slice(1)
    const line = content.split('\n').find((l) => l.trimEnd().endsWith(`^${id}`))
    return line ? line.replace(new RegExp(`\\s*\\^${id}\\s*$`), '') : content
  }
  const lines = content.split('\n')
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(lines[i])
    if (!m) continue
    if (start < 0 && m[2].trim().toLowerCase() === name) {
      start = i
      level = m[1].length
    } else if (start >= 0 && m[1].length <= level) {
      return lines.slice(start, i).join('\n')
    }
  }
  return start >= 0 ? lines.slice(start).join('\n') : content
}

// Cached note fetch for embeds / hover previews
const noteCache = new Map()
export async function fetchNote(ws, path) {
  const key = `${ws}:${path}`
  const hit = noteCache.get(key)
  if (hit && Date.now() - hit.at < 4000) return hit.promise
  const promise = api.readNote(ws, path).then((r) => r.content)
  noteCache.set(key, { at: Date.now(), promise })
  promise.catch(() => noteCache.delete(key))
  return promise
}

// ---------- lazy renderers (KaTeX, Mermaid, highlight.js) ----------
let katexP
export function loadKatex() {
  if (!katexP) katexP = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k.default)
  return katexP
}

let mermaidP
let mermaidTheme
let mermaidSeq = 0
const mermaidCache = new Map()
export async function renderMermaid(code) {
  const theme = document.documentElement.dataset.theme === 'light' ? 'default' : 'dark'
  const key = theme + '\n' + code
  if (mermaidCache.has(key)) return mermaidCache.get(key)
  if (!mermaidP) mermaidP = import('mermaid').then((m) => m.default)
  const mermaid = await mermaidP
  if (mermaidTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'Inter Variable, sans-serif' })
    mermaidTheme = theme
  }
  try {
    const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, code)
    mermaidCache.set(key, svg)
    if (mermaidCache.size > 50) mermaidCache.delete(mermaidCache.keys().next().value)
    return svg
  } catch (e) {
    document.getElementById(`dmmd-${mermaidSeq}`)?.remove()
    throw e
  }
}

let hljsP
export function loadHljs() {
  if (!hljsP) hljsP = import('highlight.js/lib/common').then((m) => m.default)
  return hljsP
}

// Post-process rendered markdown inside a container
export async function enhanceRendered(el) {
  const math = el.querySelectorAll('.math:not([data-done])')
  if (math.length) {
    const katex = await loadKatex()
    math.forEach((m) => {
      m.dataset.done = '1'
      try {
        katex.render(m.textContent, m, { displayMode: m.classList.contains('math-block'), throwOnError: false })
      } catch {}
    })
  }
  const theme = document.documentElement.dataset.theme || 'dark'
  const mermaids = [...el.querySelectorAll('.mermaid-block')].filter((m) => m.dataset.rendered !== theme)
  for (const m of mermaids) {
    const code = m.dataset.src || m.textContent
    m.dataset.src = code
    m.dataset.rendered = theme
    try {
      m.innerHTML = DOMPurify.sanitize(await renderMermaid(code), { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'] })
    } catch (e) {
      m.textContent = `Mermaid error: ${String(e.message || e).split('\n')[0]}`
    }
  }
  const codes = el.querySelectorAll('pre > code:not([data-done])')
  if (codes.length) {
    const hljs = await loadHljs()
    codes.forEach((c) => {
      c.dataset.done = '1'
      const lang = [...c.classList].find((k) => k.startsWith('language-'))?.slice(9)
      if (lang && hljs.getLanguage(lang)) {
        try {
          c.innerHTML = hljs.highlight(c.textContent, { language: lang, ignoreIllegals: true }).value
          c.classList.add('hljs')
        } catch {}
      }
    })
  }
}
