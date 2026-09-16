import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/app.js'
import { renderMarkdown, fetchNote, enhanceRendered } from '../lib/render.js'
import { stripExt, basename } from '@shared/paths.js'

export function HoverPreview() {
  const [state, setState] = useState(null)
  const wsId = useApp((s) => s.wsId)
  const resolver = useApp((s) => s.resolver)
  const ref = useRef(null)
  const timer = useRef(null)
  const hovering = useRef(false)

  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return
    const onOver = (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest('[data-wikilink], a.internal-link') : null
      if (!el) return
      const raw = el.dataset.wikilink || el.dataset.href || ''
      const target = raw.split('|')[0].split('#')[0].trim()
      if (!target) return
      const path = resolver.resolve(decodeURIComponent(target), '', 'wiki')
      if (!path) return
      clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        try {
          const content = await fetchNote(wsId, path)
          const rect = el.getBoundingClientRect()
          setState({ path, content, rect })
        } catch {}
      }, 420)
    }
    const onOut = (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest('[data-wikilink], a.internal-link') : null
      if (!el) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (!hovering.current) setState(null)
      }, 180)
    }
    const onScroll = () => setState(null)
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onScroll)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onScroll)
      clearTimeout(timer.current)
    }
  }, [wsId, resolver])

  useEffect(() => {
    if (state && ref.current) enhanceRendered(ref.current)
  }, [state])

  if (!state) return null
  const { html } = renderMarkdown(state.content.slice(0, 4000), { ws: wsId, path: state.path })
  const width = 420
  const left = Math.min(Math.max(8, state.rect.left), window.innerWidth - width - 12)
  const above = state.rect.top > window.innerHeight / 2
  const style = above ? { left, bottom: window.innerHeight - state.rect.top + 8 } : { left, top: state.rect.bottom + 8 }

  return createPortal(
    <div
      className="hover-preview markdown"
      ref={ref}
      style={style}
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => {
        hovering.current = false
        setState(null)
      }}
    >
      <div className="hp-title">{stripExt(basename(state.path))}</div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>,
    document.body,
  )
}
