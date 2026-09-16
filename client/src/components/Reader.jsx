import { useEffect, useRef, useState } from 'react'
import { renderMarkdown, enhanceRendered, fetchNote, extractSection } from '../lib/render.js'
import { openLink, openTagSearch } from '../lib/actions.js'
import { copyText } from '../lib/util.js'
import { toast } from '../store/ui.js'
import { useApp } from '../store/app.js'

export function Properties({ frontmatter }) {
  if (!frontmatter) return null
  const entries = Object.entries(frontmatter).filter(([k]) => k !== 'position')
  if (!entries.length) return null
  const fmt = (v) => (Array.isArray(v) ? v.join(', ') : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' && v ? JSON.stringify(v) : String(v))
  return (
    <div className="properties">
      {entries.map(([k, v]) => (
        <div className="prop" key={k}>
          <div className="prop-key">{k}</div>
          <div className="prop-val">{fmt(v)}</div>
        </div>
      ))}
    </div>
  )
}

export function Reader({ handle, onStats, readOnly }) {
  const ref = useRef(null)
  const [html, setHtml] = useState('')
  const [frontmatter, setFrontmatter] = useState(null)
  const version = useApp((s) => s.version)

  useEffect(() => {
    let timer
    const render = () => {
      const content = handle.ytext.toString()
      const r = renderMarkdown(content, { ws: handle.ws, path: handle.path })
      setHtml(r.html)
      setFrontmatter(r.frontmatter)
      onStats?.({ words: (content.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length, chars: content.length })
    }
    render()
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(render, 180)
    }
    const off = handle.on('change', schedule)
    const offReset = handle.on('synced', schedule)
    return () => {
      clearTimeout(timer)
      off()
      offReset()
    }
  }, [handle, version])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    enhanceRendered(el)
    const onTheme = () => enhanceRendered(el)
    window.addEventListener('obi:theme', onTheme)
    // resolve note embeds
    el.querySelectorAll('.embed-note[data-path]:not([data-loaded])').forEach(async (node) => {
      node.dataset.loaded = '1'
      const body = node.querySelector('.embed-note-body')
      const path = node.dataset.path
      const href = node.dataset.href || ''
      const sub = href.includes('#') ? '#' + href.split('#').slice(1).join('#') : ''
      try {
        const content = await fetchNote(handle.ws, path)
        const r = renderMarkdown(extractSection(content, sub), { ws: handle.ws, path })
        body.innerHTML = r.html
        enhanceRendered(body)
      } catch {
        body.textContent = 'Could not load note'
      }
    })
    // code copy buttons
    el.querySelectorAll('pre:not([data-copy])').forEach((pre) => {
      pre.dataset.copy = '1'
      const btn = document.createElement('button')
      btn.className = 'icon-btn sm copy-code'
      btn.title = 'Copy code'
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
      btn.onclick = () => {
        copyText(pre.querySelector('code')?.textContent || '')
        toast.success('Copied')
      }
      pre.appendChild(btn)
    })
    return () => window.removeEventListener('obi:theme', onTheme)
  }, [html, handle])

  const onClick = (e) => {
    const el = e.target
    if (!(el instanceof HTMLElement)) return
    const cb = el.closest('.task-checkbox')
    if (cb) {
      e.preventDefault()
      if (readOnly) return
      const line = Number(cb.dataset.line)
      toggleTaskLine(handle, line)
      return
    }
    const a = el.closest('a')
    if (!a) return
    if (a.classList.contains('internal-link') || a.dataset.href) {
      e.preventDefault()
      openLink(handle.ws, handle.path, a.dataset.href || '', { newTab: e.metaKey || e.ctrlKey })
    } else if (a.classList.contains('tag')) {
      e.preventDefault()
      openTagSearch(a.dataset.tag)
    }
    const title = el.closest('.embed-note-title')
    if (title) {
      const node = title.closest('.embed-note')
      if (node?.dataset.path) openLink(handle.ws, handle.path, node.dataset.href || node.dataset.path, {})
    }
  }

  return (
    <div className="markdown" ref={ref} onClick={onClick}>
      <Properties frontmatter={frontmatter} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export function toggleTaskLine(handle, line) {
  const text = handle.ytext.toString()
  const lines = text.split('\n')
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX/\-])(\])/.exec(lines[line] ?? '')
  if (!m) return
  let offset = 0
  for (let i = 0; i < line; i++) offset += lines[i].length + 1
  const at = offset + m[1].length
  handle.ydoc.transact(() => {
    handle.ytext.delete(at, 1)
    handle.ytext.insert(at, m[2] === ' ' ? 'x' : ' ')
  })
}
