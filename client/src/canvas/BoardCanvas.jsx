import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Maximize, Undo2, Redo2, Grid3x3, Eye, Copy, Trash2, ClipboardPaste, BringToFront, SendToBack, Group, Lock, Download, Image as ImageIcon, MousePointerSquareDashed, PencilRuler } from 'lucide-react'
import { unionBounds } from '@shared/boardgeom.js'
import { boardToSvg } from '@shared/boardsvg.js'
import { IMAGE_EXT, extname, isNote, basename, stripExt } from '@shared/paths.js'
import { isBoardPath } from '@shared/board.js'
import { createBoardStore } from './store.js'
import { CanvasController } from './controller.js'
import { CanvasLayer, useController } from './CanvasLayer.jsx'
import { Toolbar, StyleBar } from './Toolbar.jsx'
import { visualBounds } from './layout.js'
import { api } from '../lib/api.js'
import * as A from '../lib/actions.js'
import { renderMarkdown } from '../lib/render.js'
import { usePrefs } from '../store/prefs.js'
import { fetchNote } from '../lib/render.js'
import { useApp } from '../store/app.js'
import { useUI, toast } from '../store/ui.js'
import { downloadBlob } from '../lib/util.js'

export function useBoardStore(handle) {
  const ready = handle?.status === 'ready'
  const store = useMemo(() => (ready ? createBoardStore(handle) : null), [handle, ready])
  useEffect(() => () => store?.destroy(), [store])
  return store
}

export function noteExcerpt(content) {
  return String(content || '')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^#\s+.*\n?/, '')
    .replace(/^[ \t]*\|?[ \t:|-]+\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\||\|[ \t]*$/gm, '')
    .replace(/[ \t]*\|[ \t]*/g, ' · ')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/[#>*_`~=]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 280)
}

// Links on a canvas come from files anyone with access may have edited — only open web/mail links.
export function openExternal(url) {
  let u
  try {
    u = new URL(String(url))
  } catch {
    return
  }
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return
  window.open(u.href, '_blank', 'noopener,noreferrer')
}

// Element callbacks shared by boards and note layers.
export function useCanvasCtx(ws, fromPath, ctlRef, focusCanvas) {
  return useMemo(
    () => ({
      get controller() {
        return ctlRef.current
      },
      focusCanvas: () => focusCanvas?.(),
      imageUrl: (el) => (el.src ? api.fileUrl(ws, el.src) : ctlRef.current?.localImages.get(el.id) || null),
      noteExists: (p) => ws !== useApp.getState().wsId || useApp.getState().treeMap.has(p),
      noteExcerpt: (p) => fetchNote(ws, p).then(noteExcerpt),
      openNote: (p, e) => A.openPath(ws, p, { newTab: !!(e?.metaKey || e?.ctrlKey) }),
      openUrl: (u) => openExternal(u),
      openFile: (p) => window.open(api.fileUrl(ws, p), '_blank', 'noopener'),
      openLink: (link, e) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return openExternal(link)
        if (useApp.getState().treeMap.has(link)) return A.openPath(ws, link, { newTab: !!(e?.metaKey || e?.ctrlKey) })
        return A.openLink(ws, fromPath, link, { newTab: !!(e?.metaKey || e?.ctrlKey) })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, fromPath],
  )
}

export function pickImageFiles() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => resolve([...input.files])
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

const MIN_Z = 0.1
const MAX_Z = 5
const COMPACT_CONTROLS_WIDTH = 1285

/**
 * A full whiteboard surface.
 * embedded = rendered inside a note (smaller HUD, no view persistence).
 */
export function BoardCanvas({ handle, ws, path, embedded = false, onDone }) {
  const store = useBoardStore(handle)
  const vpRef = useRef(null)
  const viewRef = useRef({ x: 0, y: 0, z: 1 })
  const [view, setViewState] = useState(viewRef.current)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [compactControls, setCompactControls] = useState(false)
  const pointerRef = useRef(null)
  const ctlRef = useRef(null)
  const viewKey = `obi:boardView:${ws}:${path}`

  const setView = useCallback((next) => {
    const v = typeof next === 'function' ? next(viewRef.current) : next
    viewRef.current = v
    setViewState(v)
  }, [])

  const toWorld = useCallback((cx, cy) => {
    const r = vpRef.current?.getBoundingClientRect() || { left: 0, top: 0 }
    const v = viewRef.current
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }
  }, [])

  const zoomAt = useCallback(
    (factor, cx, cy) => {
      const r = vpRef.current.getBoundingClientRect()
      const v = viewRef.current
      const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * factor))
      const lx = (cx ?? r.left + r.width / 2) - r.left
      const ly = (cy ?? r.top + r.height / 2) - r.top
      setView({ z, x: lx - ((lx - v.x) * z) / v.z, y: ly - ((ly - v.y) * z) / v.z })
    },
    [setView],
  )

  const focusCanvas = useCallback(() => vpRef.current?.focus({ preventScroll: true }), [])
  const ctx = useCanvasCtx(ws, path, ctlRef, focusCanvas)

  const ctl = useMemo(() => {
    if (!store) return null
    let presenceTimer = 0
    let pendingPresence = null
    const host = {
      toWorld,
      zoom: () => viewRef.current.z,
      panBy: (dx, dy) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })),
      visibleRect: () => {
        const r = vpRef.current.getBoundingClientRect()
        const a = toWorld(r.left, r.top)
        const b = toWorld(r.right, r.bottom)
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
      },
      visibleCenter: () => {
        const r = vpRef.current.getBoundingClientRect()
        return toWorld(r.left + r.width / 2, r.top + r.height / 2)
      },
      pointerWorld: () => pointerRef.current,
      focusCanvas,
      userId: () => useApp.getState().user?.id,
      // what a double-click on empty canvas creates, and how a markdown block
      // is measured before it is drawn
      textKind: () => usePrefs.getState().canvasTextKind,
      renderMarkdown: (text) => renderMarkdown(text || '', { ws: ctx?.ws, path: ctx?.path }).html,
      pickImages: pickImageFiles,
      uploadFiles: (files) => A.uploadFiles(files),
      pickLink: (opts) => A.pickLink(opts),
      openNote: (p) => ctx.openNote(p),
      openUrl: (u) => ctx.openUrl(u),
      openFile: (p) => ctx.openFile(p),
      onPresence: (p) => {
        pendingPresence = p
        if (presenceTimer) return
        presenceTimer = setTimeout(() => {
          presenceTimer = 0
          if (pendingPresence) store.setPresence({ x: Math.round(pendingPresence.x), y: Math.round(pendingPresence.y) })
        }, 45)
      },
      onLaser: (pts) => store.setPresence({ laser: pts.slice(-24).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) }),
    }
    const c = new CanvasController(store, host, { mode: 'board' })
    ctlRef.current = c
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => () => ctl?.destroy(), [ctl])

  const state = useControllerSafe(ctl)

  useLayoutEffect(() => {
    const el = vpRef.current
    if (!ctl || !el) return
    let wasCompact = null
    const update = (width) => {
      const compact = width <= COMPACT_CONTROLS_WIDTH
      if (compact === wasCompact) return
      wasCompact = compact
      if (compact) setToolsOpen(false)
      setCompactControls(compact)
    }
    update(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ctl])

  // share selection & clear trails with collaborators
  useEffect(() => {
    if (!ctl) return
    let lastSel = ''
    let lastLaser = 0
    return ctl.subscribe(() => {
      const s = ctl.getState()
      const sel = s.selection.join(',')
      if (sel !== lastSel) {
        lastSel = sel
        store.setPresence({ selection: s.selection.slice(0, 50) })
      }
      if (!s.laser.length && lastLaser) store.setPresence({ laser: null })
      lastLaser = s.laser.length
    })
  }, [ctl, store])

  const fit = useCallback(
    (maxZoom = 1) => {
      if (!ctl || !vpRef.current) return
      const r = vpRef.current.getBoundingClientRect()
      const layout = ctl.layout()
      const b = unionBounds(layout.list.map(visualBounds))
      if (!b) return setView({ x: r.width / 2, y: r.height / 2, z: 1 })
      const pad = embedded ? 30 : 70
      const z = Math.min(maxZoom, Math.max(MIN_Z, Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2 - 60) / Math.max(b.h, 1))))
      setView({ z, x: r.width / 2 - (b.x + b.w / 2) * z, y: (r.height - 50) / 2 - (b.y + b.h / 2) * z })
    },
    [ctl, embedded, setView],
  )

  // initial view: restore, or fit the content
  const didInit = useRef(false)
  useLayoutEffect(() => {
    if (!ctl || didInit.current) return
    didInit.current = true
    let saved = null
    if (!embedded) {
      try {
        saved = JSON.parse(sessionStorage.getItem(viewKey) || 'null')
      } catch {}
    }
    if (saved) setView(saved)
    else fit()
    // tool shortcuts work straight away
    if (!ctl.readOnly) requestAnimationFrame(() => vpRef.current?.focus({ preventScroll: true }))
  }, [ctl, embedded, fit, setView, viewKey])

  useEffect(() => {
    if (embedded) return
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(viewKey, JSON.stringify(view))
      } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [view, viewKey, embedded])

  // wheel: scroll pans, ctrl/⌘ + wheel (and pinch) zooms
  useEffect(() => {
    const el = vpRef.current
    if (!el || !ctl) return
    const onWheel = (e) => {
      if (e.target.closest?.('.cv-dock, .cv-hud, .cv-edit')) return
      setToolsOpen(false)
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX, e.clientY)
      } else {
        let dx = e.deltaX
        let dy = e.deltaY
        if (e.deltaMode === 1) {
          dx *= 16
          dy *= 16
        }
        if (e.shiftKey && !dx) {
          dx = dy
          dy = 0
        }
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ctl, zoomAt, setView])

  // two-finger pinch on touch screens
  const touches = useRef(new Map())
  const pinch = useRef(null)
  const onPointerDown = (e) => {
    if (!ctl) return
    if (e.target.closest('.cv-dock, .cv-hud, .board-embed-bar')) return
    setToolsOpen(false)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        ctl.endGesture()
        ctl.set({ draft: null, marquee: null })
        const [a, b] = [...touches.current.values()]
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
        return
      }
    }
    vpRef.current.focus({ preventScroll: true })
    if (ctl.onPointerDown(e.nativeEvent)) e.preventDefault()
  }
  const onPointerMove = (e) => {
    pointerRef.current = toWorld(e.clientX, e.clientY)
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        setView((v) => ({ ...v, x: v.x + cx - pinch.current.cx, y: v.y + cy - pinch.current.cy }))
        zoomAt(dist / pinch.current.dist, cx, cy)
        pinch.current = { dist, cx, cy }
        return
      }
    }
    ctl?.hoverAt(e.nativeEvent)
  }
  const onPointerEnd = (e) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
  }

  const onKeyDown = (e) => {
    if (!ctl) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      return zoomAt(1.2)
    }
    if (mod && e.key === '-') {
      e.preventDefault()
      return zoomAt(1 / 1.2)
    }
    if (mod && e.key === '0') {
      e.preventDefault()
      return zoomAt(1 / viewRef.current.z)
    }
    if (e.shiftKey && !mod && (e.key === '!' || e.key === '1' || e.code === 'Digit1')) {
      e.preventDefault()
      return fit(2)
    }
    if (ctl.onKeyDown(e.nativeEvent)) e.stopPropagation()
    else if (e.key === 'Escape' && onDone) onDone()
  }

  const onPaste = (e) => {
    if (e.target.closest?.('.cv-edit, .cv-edit-frame')) return
    setToolsOpen(false)
    ctl?.paste(e.nativeEvent)
  }

  const onDrop = async (e) => {
    if (!ctl) return
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    const dragged = e.dataTransfer?.getData('text/obi-path')
    if (!files.length && !dragged) return
    setToolsOpen(false)
    e.preventDefault()
    e.stopPropagation()
    if (ctl.readOnly) return
    const p = toWorld(e.clientX, e.clientY)
    if (files.length) return ctl.insertImages(files, p)
    if (IMAGE_EXT.has(extname(dragged))) {
      ctl.addElement(ctl.base('image', { x: p.x - 150, y: p.y - 100, w: 300, h: 200, src: dragged }))
    } else if (isNote(dragged) || isBoardPath(dragged)) {
      ctl.addElement(ctl.base('note', { x: p.x - 130, y: p.y - 70, w: 260, h: 140, path: dragged }))
    }
    ctl.set({ tool: 'select' })
  }

  const contextMenu = (e) => {
    if (!ctl) return
    e.preventDefault()
    const p = toWorld(e.clientX, e.clientY)
    pointerRef.current = p
    const layout = ctl.layout()
    const hit = layout.list.slice().reverse().find((el) => {
      const b = visualBounds(el)
      return p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h
    })
    if (hit && !ctl.getState().selection.includes(hit.id)) ctl.set({ selection: [hit.id] })
    const has = ctl.getState().selection.length > 0
    const ro = ctl.readOnly
    useUI.getState().showContextMenu(e, [
      has && { label: 'Copy', icon: Copy, hint: 'Ctrl C', run: () => ctl.copy() },
      has && !ro && { label: 'Duplicate', icon: Copy, hint: 'Ctrl D', run: () => ctl.duplicate() },
      !ro && { label: 'Paste', icon: ClipboardPaste, hint: 'Ctrl V', run: () => ctl.paste({ preventDefault() {} }) },
      has && !ro && 'divider',
      has && !ro && { label: 'Bring to front', icon: BringToFront, run: () => ctl.order('front') },
      has && !ro && { label: 'Send to back', icon: SendToBack, run: () => ctl.order('back') },
      has && !ro && ctl.getState().selection.length > 1 && { label: 'Group', icon: Group, hint: 'Ctrl G', run: () => ctl.group() },
      has && !ro && { label: 'Lock / unlock', icon: Lock, run: () => ctl.toggleLock() },
      has && !ro && { label: 'Delete', icon: Trash2, danger: true, run: () => ctl.deleteSelection() },
      'divider',
      { label: 'Select all', icon: MousePointerSquareDashed, hint: 'Ctrl A', run: () => ctl.selectAll() },
      { label: 'Zoom to fit', icon: Maximize, hint: 'Shift 1', run: () => fit(2) },
      { label: ctl.getState().grid ? 'Hide grid' : 'Show grid', icon: Grid3x3, hint: 'G', run: () => ctl.toggleGrid() },
      'divider',
      { label: 'Export as SVG', icon: Download, run: () => exportBoard(ctl, ws, path, 'svg') },
      { label: 'Export as PNG', icon: ImageIcon, run: () => exportBoard(ctl, ws, path, 'png') },
    ])
  }

  if (!store || !ctl) return null

  const tool = state.tool
  const cursor = state.panning
    ? 'grabbing'
    : state.spaceDown || tool === 'hand'
      ? 'grab'
      : tool === 'select'
        ? state.hover
          ? 'move'
          : 'default'
        : tool === 'text'
          ? 'text'
          : tool === 'eraser'
            ? 'cell'
            : 'crosshair'
  const empty = ctl.layout().list.length === 0

  return (
    <div
      ref={vpRef}
      className={`cv-viewport ${state.grid ? 'grid' : ''}`}
      tabIndex={0}
      style={{
        cursor,
        '--zoom': view.z,
        backgroundSize: state.grid ? `${20 * view.z}px ${20 * view.z}px` : undefined,
        backgroundPosition: state.grid ? `${view.x}px ${view.y}px` : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={() => store.setPresence({ x: null, y: null })}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => ctl.onKeyUp(e.nativeEvent)}
      onBlur={() => ctl.set({ spaceDown: false })}
      onPaste={onPaste}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('text/obi-path')) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={onDrop}
      onContextMenu={contextMenu}
    >
      <div className="cv-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <CanvasLayer ctl={ctl} ctx={ctx} zoom={view.z} />
      </div>
      {empty && !ctl.readOnly && (
        <div className="cv-empty">
          <div>
            <h3>{embedded ? 'Sketch something' : 'A blank canvas'}</h3>
            <p>Pick a tool below, double-click to write, or paste an image.</p>
          </div>
        </div>
      )}
      {ctl.readOnly && (
        <span className="badge cv-readonly">
          <Eye size={12} /> View only
        </span>
      )}
      <div className={`board-controls ${toolsOpen ? 'tools-open' : ''}`}>
        {(!compactControls || toolsOpen) && (
          <div className="cv-dock">
            <StyleBar ctl={ctl} mode="board" />
            <Toolbar ctl={ctl} mode="board" />
          </div>
        )}
        <div className="cv-hud" onPointerDown={(e) => e.stopPropagation()}>
          <div className="cv-hud-group">
            <button
              className={`cv-tool board-tools-toggle ${toolsOpen ? 'active' : ''}`}
              title={toolsOpen ? 'Hide canvas tools' : 'Show canvas tools'}
              aria-label={toolsOpen ? 'Hide canvas tools' : 'Show canvas tools'}
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
            >
              <PencilRuler />
              <span>Canvas</span>
            </button>
            <div className="cv-sep board-tools-sep" />
            <button className="cv-tool" title="Zoom out (Ctrl −)" onClick={() => zoomAt(1 / 1.2)}>
              <Minus />
            </button>
            <button className="cv-zoom-label" title="Reset zoom (Ctrl 0)" onClick={() => zoomAt(1 / viewRef.current.z)}>
              {Math.round(view.z * 100)}%
            </button>
            <button className="cv-tool" title="Zoom in (Ctrl +)" onClick={() => zoomAt(1.2)}>
              <Plus />
            </button>
            <button className="cv-tool" title="Zoom to fit (Shift 1)" onClick={() => fit(2)}>
              <Maximize />
            </button>
          </div>
          {!ctl.readOnly && (
            <div className="cv-hud-group">
              <button className="cv-tool" title="Undo (Ctrl Z)" onClick={() => ctl.undo()}>
                <Undo2 />
              </button>
              <button className="cv-tool" title="Redo (Ctrl Shift Z)" onClick={() => ctl.redo()}>
                <Redo2 />
              </button>
              {!embedded && (
                <button className={`cv-tool ${state.grid ? 'active' : ''}`} title="Grid & snapping (G)" onClick={() => ctl.toggleGrid()}>
                  <Grid3x3 />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function useControllerSafe(ctl) {
  const dummy = useMemo(() => ({ subscribe: () => () => {}, getState: () => EMPTY_STATE }), [])
  return useController(ctl || dummy)
}
const EMPTY_STATE = { tool: 'select', selection: [], erasing: [], laser: [], snapLines: [] }

// ---------- export ----------

function resolveCssVars(svg) {
  const cs = getComputedStyle(document.documentElement)
  return svg.replace(/var\((--[\w-]+)\)/g, (_, name) => cs.getPropertyValue(name).trim() || '#888')
}

async function inlineImages(svg) {
  const urls = [...new Set([...svg.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))]
  for (const url of urls) {
    try {
      const blob = await fetch(url, { credentials: 'same-origin' }).then((r) => r.blob())
      const data = await new Promise((resolve) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.readAsDataURL(blob)
      })
      svg = svg.split(`href="${url.replace(/&/g, '&amp;')}"`).join(`href="${data}"`)
    } catch {}
  }
  return svg
}

export async function exportBoard(ctl, ws, path, format) {
  const elements = ctl.store.getSnapshot().list
  if (!elements.length) return toast.info('Nothing to export yet')
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff'
  let { svg, width, height } = boardToSvg(elements, { fileUrl: (p) => api.fileUrl(ws, p), padding: 32, renderMarkdown: (t) => renderMarkdown(t || '', { ws, path }).html })
  svg = resolveCssVars(svg).replace('<svg ', `<svg style="background:${bg}" `)
  svg = svg.replace(/(<svg[^>]*>)/, `$1<rect x="-100000" y="-100000" width="200000" height="200000" fill="${bg}"/>`)
  svg = await inlineImages(svg)
  const name = stripExt(basename(path)) || 'board'
  if (format === 'svg') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)
    return
  }
  const scale = Math.min(3, 4096 / Math.max(width, height)) || 2
  const img = new Image()
  img.decoding = 'async'
  const url = URL.createObjectURL(new Blob([svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${width}" height="${height}"`)], { type: 'image/svg+xml' }))
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    const g = canvas.getContext('2d')
    g.scale(scale, scale)
    g.drawImage(img, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('empty')
    downloadBlob(blob, `${name}.png`)
  } catch {
    toast.error('This browser could not render the PNG — exported SVG instead')
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)
  } finally {
    URL.revokeObjectURL(url)
  }
}
