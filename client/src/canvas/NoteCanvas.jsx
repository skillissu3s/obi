import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView } from '@codemirror/view'
import { ySyncAnnotation } from 'y-codemirror.next'
import {
  PencilRuler, Highlighter, StickyNote, Link2, MoveUpRight, X, LocateFixed, Copy, Trash2, BringToFront, SendToBack, Lock,
  ClipboardPaste, Bold, Italic, Strikethrough, Code, Link as LinkIcon,
} from 'lucide-react'
import { toggleWrap, insertLink } from '../editor/commands.js'
import { HIGHLIGHT_COLORS, highlightCss } from '@shared/boardsvg.js'
import { IMAGE_EXT, extname, isNote } from '@shared/paths.js'
import { isBoardPath } from '@shared/board.js'
import { conn } from '../lib/socket.js'
import * as A from '../lib/actions.js'
import { usePrefs } from '../store/prefs.js'
import { useUI } from '../store/ui.js'
import { setAnnotations, annotationAt } from '../editor/annotations.js'
import { useBoardStore, useCanvasCtx, pickImageFiles } from './BoardCanvas.jsx'
import { CanvasController } from './controller.js'
import { CanvasLayer, useController } from './CanvasLayer.jsx'
import { Toolbar, StyleBar } from './Toolbar.jsx'
import { AnchorTracker, makeAnchor, makeLineAnchor } from './anchors.js'
import { newElementId, newSeed } from './store.js'
import { visualBounds, source } from './layout.js'

function useLayerHandle(ws, path) {
  const [handle, setHandle] = useState(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (!ws || !path) return
    const h = conn.openDoc(ws, path, 'layer')
    setHandle(h)
    const rerender = () => force((n) => n + 1)
    const offs = ['status', 'role', 'reset', 'synced'].map((t) => h.on(t, rerender))
    return () => {
      offs.forEach((o) => o())
      conn.releaseDoc(h)
    }
  }, [ws, path])
  return handle
}

const DRAW_TOOLS = new Set(['rect', 'ellipse', 'diamond', 'arrow', 'line', 'pen', 'marker', 'text', 'sticky', 'eraser', 'laser', 'frame'])

/**
 * The canvas that floats around a note: drawings, sticky notes, images, links and
 * references anchored to the text. The markdown file itself never changes.
 */
export function NoteCanvas({ tab, view, scrollEl, innerEl, originEl, stageEl, mode }) {
  const handle = useLayerHandle(tab.ws, tab.path)
  const store = useBoardStore(handle)
  const prefs = usePrefs()
  const trackerRef = useRef(new AnchorTracker())
  const ctlRef = useRef(null)
  const panRef = useRef(0)
  const [pan, setPanState] = useState(0)
  const [envVersion, setEnvVersion] = useState(0)
  const geomRef = useRef(null)
  const pointerRef = useRef(null)
  const dom = useRef({})
  dom.current = { originEl, view, innerEl, scrollEl }

  const focusCanvas = useCallback(() => {
    if (view?.hasFocus) view.contentDOM.blur()
    scrollEl?.focus({ preventScroll: true })
  }, [view, scrollEl])
  const ctx = useCanvasCtx(tab.ws, tab.path, ctlRef, focusCanvas)

  const setPan = useCallback(
    (x) => {
      panRef.current = x
      setPanState(x)
      if (innerEl) innerEl.style.transform = x ? `translateX(${Math.round(x)}px)` : ''
    },
    [innerEl],
  )
  useEffect(() => () => innerEl && (innerEl.style.transform = ''), [innerEl])
  useEffect(() => setPan(0), [tab.path, setPan])

  // ----- geometry: world space = offset from where the text column starts (left edge, top of the note) -----
  const measure = useCallback(() => {
    const { originEl, view, innerEl } = dom.current
    if (!originEl || !view) return null
    const o = originEl.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const editor = view.dom.getBoundingClientRect()
    const g = {
      ox: o.left,
      oy: o.top,
      docTop: view.documentTop - o.top,
      colLeft: content.left - o.left,
      colRight: content.right - o.left,
      textTop: innerEl ? innerEl.getBoundingClientRect().top - o.top : 0,
      textBottom: editor.bottom - o.top,
    }
    geomRef.current = g
    return g
  }, [])

  const geom = () => measure() || geomRef.current || { ox: 0, oy: 0, docTop: 0, colLeft: 0, colRight: 740, textTop: 0, textBottom: 0 }

  const syncText = useCallback(() => {
    const t = trackerRef.current
    const { view } = dom.current
    if (view && t.doc !== view.state.doc) {
      t.doc = view.state.doc
      t.text = view.state.doc.toString()
    }
  }, [])

  const toWorld = useCallback(
    (cx, cy) => {
      const g = measure() || geomRef.current || { ox: 0, oy: 0 }
      return { x: cx - g.ox, y: cy - g.oy }
    },
    [measure],
  )

  // env handed to the layout: where anchored lines and text ranges are right now
  const env = useMemo(() => {
    if (!view) return null
    const g = geomRef.current || measure()
    if (!g) return null
    const tracker = trackerRef.current
    syncText()
    const rects = new Map()
    return {
      version: envVersion,
      lineTop: (anchor) => {
        syncText()
        const e = tracker.get(anchor)
        if (!e) return null
        const pos = Math.min(e.from, view.state.doc.length)
        return g.docTop + view.lineBlockAt(view.state.doc.lineAt(pos).from).top
      },
      textRect: (anchor) => {
        syncText()
        const e = tracker.get(anchor)
        if (!e) return null
        if (rects.has(e)) return rects.get(e)
        const len = view.state.doc.length
        const from = Math.min(e.from, len)
        const to = Math.min(Math.max(e.to, from), len)
        let rect = null
        const a = view.coordsAtPos(from, 1)
        const b = view.coordsAtPos(to, -1)
        if (a && b) {
          if (Math.abs(a.top - b.top) < 4) rect = { x: a.left - g.ox, y: a.top - g.oy, w: Math.max(4, b.right - a.left), h: Math.max(4, b.bottom - a.top) }
          else rect = { x: g.colLeft, y: a.top - g.oy, w: g.colRight - g.colLeft, h: b.bottom - a.top }
        } else {
          const top = view.lineBlockAt(from).top
          const bottom = view.lineBlockAt(to).bottom
          rect = { x: g.colLeft, y: g.docTop + top, w: g.colRight - g.colLeft, h: Math.max(8, bottom - top) }
        }
        rects.set(e, rect)
        return rect
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, envVersion, originEl])

  // ----- controller -----
  const ctl = useMemo(() => {
    if (!store || !view) return null
    let presenceTimer = 0
    let pending = null
    const host = {
      toWorld,
      zoom: () => 1,
      panBy: (dx, dy) => {
        setPan(panRef.current + dx)
        if (scrollEl) scrollEl.scrollTop -= dy
      },
      onPanEnd: () => {},
      visibleRect: () => {
        const r = scrollEl.getBoundingClientRect()
        const a = toWorld(r.left, r.top)
        return { x: a.x, y: a.y, w: r.width, h: r.height }
      },
      visibleCenter: () => {
        const r = scrollEl.getBoundingClientRect()
        return toWorld(r.left + r.width / 2, r.top + r.height / 2)
      },
      pointerWorld: () => pointerRef.current,
      focusCanvas,
      userId: () => conn.user?.id,
      pickImages: pickImageFiles,
      uploadFiles: (files) => A.uploadFiles(files),
      pickLink: (opts) => A.pickLink(opts),
      openNote: (p) => ctx.openNote(p),
      openUrl: (u) => ctx.openUrl(u),
      openFile: (p) => ctx.openFile(p),
      isTextArea: (cx, cy) => {
        const g = geom()
        const x = cx - g.ox
        const y = cy - g.oy
        return x >= g.colLeft - 10 && x <= g.colRight + 10 && y >= g.textTop && y <= g.textBottom
      },
      anchorFor: (y) => {
        const g = geom()
        const doc = view.state.doc
        const docY = y - g.docTop
        if (docY < -4 || !doc.length) return null
        const block = view.lineBlockAtHeight(Math.max(0, docY))
        let line = doc.lineAt(block.from)
        // prefer a line with text so blank lines being removed doesn't lose the anchor
        let n = line.number
        while (n > 1 && !doc.line(n).text.trim()) n--
        if (!doc.line(n).text.trim()) {
          n = line.number
          while (n < doc.lines && !doc.line(n).text.trim()) n++
        }
        if (!doc.line(n).text.trim()) return null
        line = doc.line(n)
        return { anchor: makeLineAnchor(doc, n), top: g.docTop + view.lineBlockAt(line.from).top }
      },
      textAnchorAt: (cx, cy) => {
        const g = geom()
        const x = cx - g.ox
        if (x < g.colLeft - 4 || x > g.colRight + 4) return null
        const pos = view.posAtCoords({ x: cx, y: cy }, false)
        if (pos == null) return null
        const c = view.coordsAtPos(pos)
        if (!c || cy < c.top - 6 || cy > c.bottom + 6) return null
        const state = view.state
        const sel = state.selection.main
        let from
        let to
        if (!sel.empty && pos >= sel.from && pos <= sel.to) {
          from = sel.from
          to = sel.to
        } else {
          const word = state.wordAt(pos)
          if (word) {
            from = word.from
            to = word.to
          } else {
            const line = state.doc.lineAt(pos)
            if (!line.text.trim()) return null
            from = line.from + (line.text.length - line.text.trimStart().length)
            to = line.to
          }
        }
        syncText()
        return makeAnchor(trackerRef.current.text, from, to)
      },
      onToolChange: () => {},
      onPresence: (p) => {
        pending = p
        if (presenceTimer) return
        presenceTimer = setTimeout(() => {
          presenceTimer = 0
          const c = ctlRef.current
          const g = geomRef.current
          if (!pending || !c || !g) return
          const inText = pending.x > g.colLeft && pending.x < g.colRight && c.getState().tool === 'select'
          store.setPresence(inText ? { x: null, y: null } : { x: Math.round(pending.x), y: Math.round(pending.y) })
        }, 60)
      },
      onLaser: (pts) => store.setPresence({ laser: pts.slice(-24).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) }),
    }
    const c = new CanvasController(store, host, { mode: 'note' })
    ctlRef.current = c
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, view])

  useEffect(() => () => ctl?.destroy(), [ctl])
  useEffect(() => {
    if (import.meta.env.DEV && ctl) window.__noteCanvas = { ctl, tracker: trackerRef.current, view, measure }
  }, [ctl, view, measure])
  useLayoutEffect(() => {
    if (ctl && env) ctl.setEnv(env)
  }, [ctl, env])

  const state = useController(ctl || DUMMY)

  // ----- editor hooks: follow text edits, re-measure on layout changes -----
  const bumpRef = useRef(0)
  const bump = useCallback(() => {
    if (bumpRef.current) return
    bumpRef.current = requestAnimationFrame(() => {
      bumpRef.current = 0
      measure()
      setEnvVersion((v) => v + 1)
    })
  }, [measure])
  useEffect(() => () => cancelAnimationFrame(bumpRef.current), [])

  const [bubble, setBubble] = useState(null)
  const bubbleRef = useRef(null)
  const mouseDownRef = useRef(false)
  const updateBubble = useCallback(() => {
    cancelAnimationFrame(bubbleRef.current)
    bubbleRef.current = requestAnimationFrame(() => {
      if (!view || !stageEl || !store || store.readOnly || mouseDownRef.current || !view.hasFocus) return setBubble(null)
      const sel = view.state.selection.main
      let range = null
      let anno = null
      if (!sel.empty) range = { from: sel.from, to: sel.to }
      else {
        anno = annotationAt(view.state, sel.head)
        if (anno) range = { from: anno.from, to: anno.to }
      }
      if (!range || range.to - range.from < 1) return setBubble(null)
      const a = view.coordsAtPos(range.from, 1)
      const b = view.coordsAtPos(range.to, -1)
      if (!a || !b) return setBubble(null)
      const s = stageEl.getBoundingClientRect()
      const top = Math.min(a.top, b.top)
      const x = (Math.max(a.left, s.left) + Math.min(a.top === b.top ? b.right : a.left + 120, s.right)) / 2
      const below = top - s.top < 90
      setBubble({ x: x - s.left, y: (below ? Math.max(a.bottom, b.bottom) : top) - s.top, below, range, anno: anno?.id || null })
    })
  }, [view, stageEl, store])

  useEffect(() => {
    if (!view?.obiComps || !store) return
    const tracker = trackerRef.current
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const local = !u.transactions.some((tr) => tr.annotation(ySyncAnnotation))
        tracker.map(u.changes, local)
        if (local) scheduleAnchorSave()
      }
      if (u.docChanged || u.geometryChanged || u.heightChanged || u.viewportChanged) bump()
      if (u.selectionSet || u.focusChanged || u.docChanged || u.geometryChanged) updateBubble()
    })
    view.dispatch({ effects: view.obiComps.canvas.reconfigure(listener) })
    const onDown = () => {
      mouseDownRef.current = true
      setBubble(null)
    }
    const onUp = () => {
      if (!mouseDownRef.current) return
      mouseDownRef.current = false
      updateBubble()
    }
    view.contentDOM.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      view.contentDOM.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      try {
        view.dispatch({ effects: view.obiComps.canvas.reconfigure([]) })
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, store, bump, updateBubble])

  // layout changes outside the editor (window, panels, fonts)
  useEffect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver(bump)
    ro.observe(scrollEl)
    if (innerEl) ro.observe(innerEl)
    document.fonts?.ready?.then(bump)
    const onScroll = () => {
      if (bubble) updateBubble()
    }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      scrollEl.removeEventListener('scroll', onScroll)
    }
  }, [scrollEl, innerEl, bump, bubble, updateBubble])

  // layer content changed → anchors may be new
  useEffect(() => {
    if (!store) return
    return store.subscribe(bump)
  }, [store, bump])

  // ----- persist anchors that moved because of local typing -----
  const saveTimer = useRef(0)
  const scheduleAnchorSave = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(saveAnchors, 1500)
  }
  const saveAnchors = () => {
    const tracker = trackerRef.current
    if (!tracker.dirty || !store || store.readOnly || !view) return
    tracker.dirty = false
    const doc = view.state.doc
    const text = doc.toString()
    const patches = []
    for (const el of store.getSnapshot().list) {
      const patch = {}
      const fix = (a) => {
        const e = tracker.entries.get(a)
        if (!e?.moved || e.lost) return null
        e.moved = false
        if (a.line) {
          const n = doc.lineAt(Math.min(e.from, doc.length)).number
          return doc.line(n).text.trim() ? makeLineAnchor(doc, n) : null
        }
        return e.to > e.from ? makeAnchor(text, e.from, e.to) : null
      }
      if (el.anchor) {
        const a = fix(el.anchor)
        if (a) patch.anchor = a
      }
      for (const k of ['start', 'end']) {
        if (el[k]?.anchor) {
          const a = fix(el[k].anchor)
          if (a) patch[k] = { anchor: a }
        }
      }
      if (Object.keys(patch).length) patches.push([el.id, patch])
    }
    if (patches.length) store.silentUpdate(patches)
  }
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // drop tracker entries for anchors that no longer exist
  useEffect(() => {
    if (!store) return
    const anchors = new Set()
    for (const el of store.getSnapshot().list) {
      if (el.anchor) anchors.add(el.anchor)
      if (el.start?.anchor) anchors.add(el.start.anchor)
      if (el.end?.anchor) anchors.add(el.end.anchor)
    }
    trackerRef.current.retain(anchors)
  })

  // ----- highlights & reference underlines inside the text -----
  const annoSig = useRef('')
  useEffect(() => {
    if (!view || !store || !env) return
    const tracker = trackerRef.current
    const list = []
    for (const el of store.getSnapshot().list) {
      if (el.type === 'highlight') {
        const e = tracker.get(el.anchor)
        if (e && e.to > e.from) list.push({ from: e.from, to: e.to, cls: 'cm-anno-hl', attrs: { style: `background:${highlightCss(el.color)}`, 'data-anno': el.id } })
      }
      for (const k of ['start', 'end']) {
        const a = el[k]?.anchor
        if (!a) continue
        const e = tracker.get(a)
        if (e && e.to > e.from) list.push({ from: e.from, to: e.to, cls: 'cm-anno-ref', attrs: { 'data-ref': el.id } })
      }
    }
    list.sort((a, b) => a.from - b.from || a.to - b.to)
    const sig = list.map((a) => `${a.from}-${a.to}-${a.cls}-${a.attrs.style || ''}`).join('|')
    if (sig === annoSig.current) return
    annoSig.current = sig
    queueMicrotask(() => {
      try {
        view.dispatch({ effects: setAnnotations.of(list) })
      } catch {}
    })
  })
  useEffect(
    () => () => {
      annoSig.current = ''
      try {
        view?.dispatch({ effects: setAnnotations.of([]) })
      } catch {}
    },
    [view],
  )

  // ----- pointer / keyboard plumbing on the scroll area -----
  useEffect(() => {
    if (!scrollEl || !ctl) return
    const onPointerDown = (e) => {
      if (e.target.closest?.('.cv-dock, .nc-bubble, .nc-recenter, .cv-pop, .cm-board-embed, .cv-wikilink, .cv-card-open, .cv-link-mark')) return
      if (e.target.closest?.('.cv-edit, .cv-edit-frame')) return
      measure()
      const handled = ctl.onPointerDown(e)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
        setBubble(null)
      } else if (e.button === 1) {
        e.preventDefault()
      }
    }
    const onMove = (e) => {
      pointerRef.current = toWorld(e.clientX, e.clientY)
      ctl.hoverAt(e)
    }
    const onKeyDown = (e) => {
      const inText = e.target.closest?.('.cm-editor, input, textarea, .cv-edit')
      if (inText) {
        // a quick way back to the canvas: Escape while a canvas tool is active
        if (e.key === 'Escape' && ctl.getState().tool !== 'select' && !e.target.closest('.cv-edit')) {
          ctl.setTool('select')
          e.preventDefault()
        }
        return
      }
      if (ctl.onKeyDown(e)) {
        e.preventDefault()
        e.stopPropagation()
      } else if (e.key === 'Escape' && !ctl.getState().selection.length) {
        view?.focus()
      }
    }
    const onKeyUp = (e) => ctl.onKeyUp(e)
    const onPaste = (e) => {
      if (e.target.closest?.('.cm-editor, input, textarea')) return
      ctl.paste(e)
    }
    const onWheel = (e) => {
      // sideways scrolling pans the canvas around the note
      let dx = e.deltaX
      if (e.shiftKey && !dx) dx = e.deltaY
      if (!dx || Math.abs(dx) < Math.abs(e.deltaY) * (e.shiftKey ? 0 : 1)) return
      if (e.target.closest?.('.cm-lp-table, .cm-lp-codeblock, pre, .cm-board-embed, .cv-dock')) return
      e.preventDefault()
      setPan(panRef.current - dx)
    }
    const onDragOver = (e) => {
      const types = e.dataTransfer?.types || []
      if (!(types.includes('Files') || types.includes('text/obi-path'))) return
      if (ctl.host.isTextArea(e.clientX, e.clientY)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onDrop = (e) => {
      if (ctl.readOnly || ctl.host.isTextArea(e.clientX, e.clientY)) return
      const p = toWorld(e.clientX, e.clientY)
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
      const dragged = e.dataTransfer?.getData('text/obi-path')
      if (!files.length && !dragged) return
      e.preventDefault()
      e.stopPropagation()
      if (files.length) return ctl.insertImages(files, p)
      if (IMAGE_EXT.has(extname(dragged))) ctl.addElement(ctl.base('image', { x: p.x - 140, y: p.y - 90, w: 280, h: 180, src: dragged }))
      else if (isNote(dragged) || isBoardPath(dragged)) ctl.addElement(ctl.base('note', { x: p.x - 120, y: p.y - 60, w: 240, h: 130, path: dragged }))
    }
    const onContext = (e) => {
      const p = toWorld(e.clientX, e.clientY)
      const layout = ctl.layout()
      const hit = layout.list.slice().reverse().find((el) => {
        const b = visualBounds(el)
        return p.x >= b.x - 4 && p.y >= b.y - 4 && p.x <= b.x + b.w + 4 && p.y <= b.y + b.h + 4
      })
      if (!hit && ctl.host.isTextArea(e.clientX, e.clientY)) return
      e.preventDefault()
      if (hit && !ctl.getState().selection.includes(hit.id)) ctl.set({ selection: [hit.id] })
      pointerRef.current = p
      const has = ctl.getState().selection.length > 0
      const ro = ctl.readOnly
      useUI.getState().showContextMenu(e, [
        has && { label: 'Copy', icon: Copy, run: () => ctl.copy() },
        has && !ro && { label: 'Duplicate', icon: Copy, run: () => ctl.duplicate() },
        !ro && { label: 'Paste here', icon: ClipboardPaste, run: () => ctl.paste({ preventDefault() {} }) },
        has && !ro && 'divider',
        has && !ro && { label: 'Bring to front', icon: BringToFront, run: () => ctl.order('front') },
        has && !ro && { label: 'Send to back', icon: SendToBack, run: () => ctl.order('back') },
        has && !ro && { label: 'Lock / unlock', icon: Lock, run: () => ctl.toggleLock() },
        has && !ro && { label: 'Delete', icon: Trash2, danger: true, run: () => ctl.deleteSelection() },
        !has && { label: 'Canvas tools', icon: PencilRuler, run: () => usePrefs.getState().set({ canvasBar: true }) },
      ])
    }
    scrollEl.addEventListener('pointerdown', onPointerDown, true)
    scrollEl.addEventListener('pointermove', onMove)
    scrollEl.addEventListener('keydown', onKeyDown)
    scrollEl.addEventListener('keyup', onKeyUp)
    scrollEl.addEventListener('paste', onPaste)
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    scrollEl.addEventListener('dragover', onDragOver, true)
    scrollEl.addEventListener('drop', onDrop, true)
    scrollEl.addEventListener('contextmenu', onContext)
    const onBlur = () => ctl.set({ spaceDown: false })
    window.addEventListener('blur', onBlur)
    return () => {
      scrollEl.removeEventListener('pointerdown', onPointerDown, true)
      scrollEl.removeEventListener('pointermove', onMove)
      scrollEl.removeEventListener('keydown', onKeyDown)
      scrollEl.removeEventListener('keyup', onKeyUp)
      scrollEl.removeEventListener('paste', onPaste)
      scrollEl.removeEventListener('wheel', onWheel)
      scrollEl.removeEventListener('dragover', onDragOver, true)
      scrollEl.removeEventListener('drop', onDrop, true)
      scrollEl.removeEventListener('contextmenu', onContext)
      window.removeEventListener('blur', onBlur)
    }
  }, [scrollEl, ctl, toWorld, measure, setPan, view])

  // cursor feedback on the scroll area
  useEffect(() => {
    if (!scrollEl) return
    const cls = scrollEl.classList
    const tool = state.tool
    cls.toggle('nc-drawing', DRAW_TOOLS.has(tool) && tool !== 'eraser')
    cls.toggle('nc-erasing', tool === 'eraser')
    cls.toggle('nc-hand', !state.panning && (tool === 'hand' || state.spaceDown))
    cls.toggle('nc-panning', !!state.panning)
    cls.toggle('nc-over-el', tool === 'select' && !!state.hover)
    return () => cls.remove('nc-drawing', 'nc-erasing', 'nc-hand', 'nc-panning', 'nc-over-el')
  }, [scrollEl, state.tool, state.panning, state.spaceDown, state.hover])

  // toggling the toolbar from the command palette
  useEffect(() => {
    const onToggle = () => {
      const open = !usePrefs.getState().canvasBar
      usePrefs.getState().set({ canvasBar: open })
      if (!open) ctl?.setTool('select')
    }
    window.addEventListener('obi:canvas-bar', onToggle)
    return () => window.removeEventListener('obi:canvas-bar', onToggle)
  }, [ctl])

  // ----- selection bubble actions -----
  // markdown formatting straight from the selection bubble
  const format = (cmd) => {
    if (!view) return
    view.focus()
    cmd(view)
    requestAnimationFrame(updateBubble)
  }

  const refRange = (range) => {
    syncText()
    return makeAnchor(trackerRef.current.text, range.from, range.to)
  }

  const highlight = (color) => {
    if (!bubble || !ctl) return
    if (bubble.anno) {
      store.checkpoint()
      store.update([[bubble.anno, { color }]])
    } else {
      store.checkpoint()
      store.add({ id: newElementId(), type: 'highlight', anchor: refRange(bubble.range), color, z: store.minZ() - 1, by: conn.user?.id })
      view.dispatch({ selection: { anchor: bubble.range.to } })
    }
    bump()
  }

  const removeHighlight = () => {
    if (!bubble?.anno) return
    store.checkpoint()
    store.remove([bubble.anno])
    bump()
  }

  // a note (or a linked page) beside the text, joined by a dashed arrow
  const annotate = async (kind) => {
    if (!bubble || !ctl) return
    const range = bubble.range
    const anchor = refRange(range)
    const g = measure()
    const a = view.coordsAtPos(range.from, 1)
    const y = a ? a.top - g.oy - 18 : g.docTop + view.lineBlockAt(range.from).top
    const w = kind === 'sticky' ? 200 : 250
    const h = kind === 'sticky' ? 150 : 130
    const spot = ctl.freeSpot(g.colRight + 56, y, w, h)
    let target
    if (kind === 'sticky') {
      target = ctl.base('sticky', { ...spot, color: ctl.getState().style.color || 'yellow', align: 'left', font: 'hand' })
    } else {
      const pick = await A.pickLink()
      if (!pick) return
      target = pick.url
        ? ctl.base('link', { ...spot, h: 80, url: pick.url })
        : ctl.base('note', { ...spot, path: pick.path })
    }
    const arrow = {
      id: newElementId(),
      type: 'arrow',
      x: spot.x,
      y: spot.y,
      w: 0,
      h: 0,
      z: ctl.store.maxZ() + 2,
      seed: newSeed(),
      points: [[0, 0], [1, 1]],
      start: { anchor },
      end: { id: target.id },
      dash: 'dashed',
      rough: 0,
      sw: 1,
      stroke: 'gray',
      heads: ['dot', 'arrow'],
      curve: true,
    }
    store.checkpoint()
    const placed = ctl.anchorize(target)
    store.add([placed, ctl.anchorize(arrow)])
    ctl.set({ selection: [placed.id], editing: kind === 'sticky' ? { id: placed.id } : null, tool: 'select' })
    setBubble(null)
    revealX(spot.x, spot.x + w)
    bump()
  }

  const connect = () => {
    if (!bubble || !ctl) return
    const range = bubble.range
    const anchor = refRange(range)
    const g = measure()
    const b = view.coordsAtPos(range.to, -1)
    const y = b ? (b.top + b.bottom) / 2 - g.oy : 0
    const arrow = {
      id: newElementId(),
      type: 'arrow',
      x: g.colRight + 20,
      y,
      w: 0,
      h: 0,
      z: ctl.store.maxZ() + 1,
      seed: newSeed(),
      points: [[0, 0], [120, 0]],
      start: { anchor },
      dash: 'dashed',
      rough: 0,
      sw: 1,
      stroke: 'gray',
      heads: ['dot', 'arrow'],
      curve: true,
    }
    store.checkpoint()
    store.add(ctl.anchorize(arrow))
    ctl.set({ selection: [arrow.id], tool: 'select' })
    setBubble(null)
    focusCanvas()
    revealX(arrow.x, arrow.x + 160)
    bump()
  }

  // pan sideways so a margin element is on screen
  const revealX = (x1, x2) => {
    const r = scrollEl.getBoundingClientRect()
    const g = measure()
    const left = r.left - g.ox + 16
    const right = r.right - g.ox - 16
    let shift = 0
    if (x2 > right) shift = right - x2
    else if (x1 < left) shift = left - x1
    if (shift) animatePan(panRef.current + shift)
  }
  const animatePan = (to) => {
    const from = panRef.current
    const start = performance.now()
    const step = (t) => {
      const k = Math.min(1, (t - start) / 260)
      const e = 1 - (1 - k) ** 3
      setPan(from + (to - from) * e)
      if (k < 1) requestAnimationFrame(step)
      else bump()
    }
    requestAnimationFrame(step)
  }

  // The canvas draws into a node of its own rather than straight into the
  // React-rendered origin: when a tab closes, React and the portal would
  // otherwise race to remove the same children and one of them would find
  // them already gone, taking the whole app down with it.
  const [portalHost] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    if (!originEl) return undefined
    portalHost.className = 'nc-portal'
    originEl.appendChild(portalHost)
    return () => portalHost.remove()
  }, [originEl, portalHost])

  if (!ctl || !originEl) return null
  const open = prefs.canvasBar
  const count = ctl.layout().list.length + store.getSnapshot().list.filter((e) => e.type === 'highlight').length
  const readOnly = ctl.readOnly

  return (
    <>
      {portalHost && createPortal(
        <>
          <CanvasLayer ctl={ctl} ctx={ctx} zoom={1} />
          <CanvasExtent ctl={ctl} />
        </>,
        portalHost,
      )}
      {Math.abs(pan) > 2 && (
        <button className="btn btn-sm nc-recenter" onClick={() => animatePan(0)} title="Move the note back to the centre">
          <LocateFixed /> Re-center
        </button>
      )}
      {bubble && (
        <div className={`nc-bubble ${bubble.below ? 'below' : ''}`} style={{ left: bubble.x, top: bubble.y }} onMouseDown={(e) => e.preventDefault()}>
          {!bubble.anno && (
            <>
              <button className="cv-sbtn" title="Bold (Ctrl/⌘ B)" onClick={() => format(toggleWrap('**'))}>
                <Bold />
              </button>
              <button className="cv-sbtn" title="Italic (Ctrl/⌘ I)" onClick={() => format(toggleWrap('*'))}>
                <Italic />
              </button>
              <button className="cv-sbtn" title="Strikethrough (Ctrl/⌘ ⇧ X)" onClick={() => format(toggleWrap('~~'))}>
                <Strikethrough />
              </button>
              <button className="cv-sbtn" title="Code (Ctrl/⌘ E)" onClick={() => format(toggleWrap('`'))}>
                <Code />
              </button>
              <button className="cv-sbtn" title="Link (Ctrl/⌘ K)" onClick={() => format(insertLink)}>
                <LinkIcon />
              </button>
              <div className="cv-sep" />
            </>
          )}
          <div className="nc-swatches">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c} className="cv-sbtn" title={`Highlight ${c} — kept on the canvas, the markdown stays as it is`} onClick={() => highlight(c)}>
                <span className="hl-dot" style={{ background: highlightCss(c) }} />
              </button>
            ))}
          </div>
          {bubble.anno && (
            <button className="cv-sbtn" title="Remove highlight" onClick={removeHighlight}>
              <X />
            </button>
          )}
          <div className="cv-sep" />
          <button className="cv-sbtn" title="Add a sticky note about this, linked with an arrow" onClick={() => annotate('sticky')}>
            <StickyNote />
          </button>
          <button className="cv-sbtn" title="Link a page beside this text" onClick={() => annotate('link')}>
            <Link2 />
          </button>
          <button className="cv-sbtn" title="Draw an arrow from this text — drag its end onto anything" onClick={connect}>
            <MoveUpRight />
          </button>
        </div>
      )}
      <div className={`cv-dock ${open ? '' : 'is-tucked'}`}>
        {(open || state.selection.length > 0) && <StyleBar ctl={ctl} mode="note" />}
        {open ? (
          <Toolbar
            ctl={ctl}
            mode="note"
            onCollapse={() => {
              ctl.setTool('select')
              usePrefs.getState().set({ canvasBar: false })
            }}
          />
        ) : (
          <button className="cv-pill" title="Draw, add sticky notes, images and links around this note (Alt C)" onClick={() => usePrefs.getState().set({ canvasBar: true })}>
            <PencilRuler /> <span className="cv-pill-label">Canvas</span>
            {count > 0 && <span className="cv-count">{count}</span>}
            {readOnly && <span className="cv-count">view only</span>}
          </button>
        )}
      </div>
    </>
  )
}

// Drawings can sit below the end of the text. Without this the page has
// nothing to scroll to down there, so the canvas felt stuck vertically.
function CanvasExtent({ ctl }) {
  const state = useController(ctl)
  void state.version
  let bottom = 0
  for (const el of ctl.layout().list) {
    const b = visualBounds(el)
    if (b.y + b.h > bottom) bottom = b.y + b.h
  }
  if (bottom <= 0) return null
  return <div className="nc-extent" style={{ top: Math.round(bottom) + 120 }} />
}

const DUMMY_STATE = { tool: 'select', selection: [], erasing: [], laser: [], snapLines: [] }
const DUMMY = { subscribe: () => () => {}, getState: () => DUMMY_STATE }

export { source }
