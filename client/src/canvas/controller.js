// Interaction engine shared by standalone whiteboards and the canvas layer on notes.
import { elementBounds, unionBounds, isLinear, normalizeLinear, simplify, absPoints, midPoint } from '@shared/boardgeom.js'
import { DEFAULTS, val } from '@shared/boardsvg.js'
import { newElementId, newSeed } from './store.js'
import { resolveLayout, hitTest, inMarquee, erasedBy, bindTargetAt, visualBounds, source, measureText, measureMarkdown, visiblePoints } from './layout.js'

export const TOOL_KEYS = {
  v: 'select', h: 'hand', r: 'rect', o: 'ellipse', d: 'diamond', a: 'arrow', l: 'line', p: 'pen', m: 'marker',
  t: 'text', n: 'sticky', i: 'image', k: 'note', f: 'frame', e: 'eraser', x: 'laser',
}
const CREATE_BOX = new Set(['rect', 'ellipse', 'diamond', 'frame'])
const STYLE_KEYS = ['stroke', 'fill', 'fillStyle', 'sw', 'dash', 'rough', 'round', 'opacity', 'font', 'fs', 'align', 'color', 'heads', 'curve', 'markerStroke']
const DBL_MS = 350
const STYLE_STORE = 'obi:canvasStyle'

// Which style bucket an element type or tool draws from.
const TOOL_ELEMENT = { shape: 'rect', linear: 'arrow', pen: 'pen', marker: 'pen', text: 'text', sticky: 'sticky' }
export function styleGroup(typeOrTool) {
  switch (typeOrTool) {
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'frame':
      return 'shape'
    case 'line':
    case 'arrow':
      return 'linear'
    case 'pen':
      return 'pen'
    case 'marker':
      return 'marker'
    case 'text':
      return 'text'
    case 'sticky':
      return 'sticky'
    default:
      return null
  }
}

function loadStyle() {
  const base = { ...DEFAULTS, heads: ['none', 'arrow'], curve: false }
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_STORE) || '{}')
    // older versions stored one flat style for every tool
    if (saved.base || saved.byTool) return { style: { ...base, ...saved.base }, byTool: saved.byTool || {} }
    return { style: { ...base, ...saved }, byTool: {} }
  } catch {
    return { style: base, byTool: {} }
  }
}

export class CanvasController {
  constructor(store, host, { mode = 'board' } = {}) {
    this.store = store
    this.host = host
    this.mode = mode
    this.listeners = new Set()
    this.gesture = null
    this.lastDown = null
    this.clip = null
    this.env = null
    this.localImages = new Map() // element id -> blob url shown until the upload lands
    this._layout = null
    this._layoutKey = null
    this.state = {
      tool: 'select',
      lockTool: false,
      selection: [],
      editing: null,
      marquee: null,
      bindHint: null,
      snapLines: [],
      erasing: [],
      laser: [],
      draft: null,
      rawPoints: null, // unsimplified pen points; the draft shows the simplified ones
      panning: false,
      spaceDown: false,
      hover: null,
      grid: mode === 'board' && localStorage.getItem('obi:canvasGrid') !== '0',
      style: loadStyle().style,
      styleByTool: loadStyle().byTool,
      version: 0,
    }
    this.unsub = store.subscribe(() => {
      // prune selection of elements that disappeared remotely
      const snap = store.getSnapshot()
      const sel = this.state.selection.filter((id) => snap.byId.has(id))
      const editing = this.state.editing && !snap.byId.has(this.state.editing.id) ? null : this.state.editing
      if (sel.length !== this.state.selection.length || editing !== this.state.editing) this.set({ selection: sel, editing })
      else this.emit()
    })
  }

  destroy() {
    this.unsub()
    this.endGesture()
    this.listeners.clear()
    cancelAnimationFrame(this.laserRaf)
  }

  // ---------- state plumbing ----------
  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getState() {
    return this.state
  }
  set(patch) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 }
    for (const fn of [...this.listeners]) fn()
  }
  emit() {
    this.state = { ...this.state, version: this.state.version + 1 }
    for (const fn of [...this.listeners]) fn()
  }

  get readOnly() {
    return this.store.readOnly
  }

  setEnv(env) {
    this.env = env
    this.emit()
  }

  layout() {
    const snap = this.store.getSnapshot()
    const key = `${snap.version}|${this.env?.version ?? ''}`
    if (this._layoutKey !== key) {
      this._layout = resolveLayout(snap, this.env)
      this._layoutKey = key
    }
    return this._layout
  }

  selected() {
    const layout = this.layout()
    return this.state.selection.map((id) => layout.byId.get(id)).filter(Boolean)
  }

  // ---------- tools & style ----------
  setTool(tool) {
    if (this.readOnly && !['select', 'hand', 'laser'].includes(tool)) return
    this.commitEditing()
    if (tool === 'image') return this.insertImages()
    if (tool === 'note') return this.insertNoteCard()
    this.set({ tool, selection: tool === 'select' ? this.state.selection : [], marquee: null })
    this.host.onToolChange?.(tool)
  }

  toggleToolLock() {
    this.set({ lockTool: !this.state.lockTool })
  }

  toggleGrid() {
    const grid = !this.state.grid
    localStorage.setItem('obi:canvasGrid', grid ? '1' : '0')
    this.set({ grid })
  }

  // A shape, a line and a pen stroke each keep their own look: setting the
  // thickness of a line used to become the thickness of the next box too.
  styleFor(group) {
    return { ...this.state.style, ...(this.state.styleByTool[group] || {}) }
  }

  // Apply a style to the tools it belongs to, and to the selection.
  setStyle(patch) {
    const sel = this.selected().filter((el) => !el.locked)
    const groups = sel.length ? [...new Set(sel.map((el) => styleGroup(el.tool === 'marker' ? 'marker' : el.type)))] : [styleGroup(this.state.tool)]
    const styleByTool = { ...this.state.styleByTool }
    for (const g of groups) {
      if (!g) continue
      const next = { ...(styleByTool[g] || {}) }
      for (const [k, v] of Object.entries(patch)) if (appliesTo(k, { type: TOOL_ELEMENT[g] || 'rect' }) || k === 'markerStroke' || k === 'heads' || k === 'curve') next[k] = v
      styleByTool[g] = next
    }
    // the shared base stays at the defaults; each tool remembers its own
    try {
      localStorage.setItem(STYLE_STORE, JSON.stringify({ base: Object.fromEntries(STYLE_KEYS.map((k) => [k, this.state.style[k]])), byTool: styleByTool }))
    } catch {}
    this.set({ styleByTool })
    if (!sel.length || this.readOnly) return
    this.store.checkpoint()
    this.store.update(
      sel.map((el) => {
        const p = {}
        for (const [k, v] of Object.entries(patch)) if (appliesTo(k, el)) p[k] = v
        if ((patch.fs || patch.font) && el.type === 'text') Object.assign(p, this.textSize({ ...source(el), ...p }))
        return [el.id, p]
      }),
    )
  }

  // ---------- creation helpers ----------
  base(type, extra = {}) {
    const s = this.styleFor(styleGroup(extra.tool === 'marker' ? 'marker' : type))
    const el = { id: newElementId(), type, z: this.store.maxZ() + 1, seed: newSeed(), by: this.host.userId?.() || undefined }
    for (const k of STYLE_KEYS) if (k !== 'heads' && appliesTo(k, { type }) && s[k] !== undefined && s[k] !== DEFAULTS[k]) el[k] = s[k]
    return { ...el, ...extra }
  }

  anchorize(el) {
    if (this.mode !== 'note' || !this.host.anchorFor) return el
    const top = isLinear(el) ? el.y : el.y
    const a = this.host.anchorFor(top)
    if (!a) {
      const { anchor, dy, ...rest } = el
      void anchor
      void dy
      return rest
    }
    return { ...el, anchor: a.anchor, dy: Math.round((top - a.top) * 100) / 100 }
  }

  textSize(el) {
    if (el.md) {
      const html = this.host.renderMarkdown?.(el.text || '') ?? ''
      const m = measureMarkdown(html, { font: val(el, 'font'), fs: val(el, 'fs'), width: el.w || 320 })
      return { h: m.h }
    }
    const m = measureText(el.text || '', { font: val(el, 'font'), fs: val(el, 'fs'), width: el.wrap ? el.w : null })
    return el.wrap ? { h: m.h } : { w: Math.max(m.w, 8), h: m.h }
  }

  addElement(el, { select = true, edit = false } = {}) {
    const final = this.anchorize(el)
    this.store.checkpoint()
    this.store.add(final)
    if (select) this.set({ selection: [final.id], editing: edit ? { id: final.id } : null })
    return final
  }

  visibleCenter() {
    return this.host.visibleCenter()
  }

  // Place a new element near a point, nudging it down past anything already there.
  freeSpot(x, y, w, h) {
    const layout = this.layout()
    let box = { x, y, w, h }
    for (let i = 0; i < 40; i++) {
      const hit = layout.list.find((el) => {
        const b = visualBounds(el)
        return b.x < box.x + box.w + 8 && b.x + b.w > box.x - 8 && b.y < box.y + box.h + 8 && b.y + b.h > box.y - 8
      })
      if (!hit) break
      const b = visualBounds(hit)
      box = { ...box, y: b.y + b.h + 16 }
    }
    return box
  }

  async insertImages(files, at) {
    if (this.readOnly) return
    if (!files) files = await this.host.pickImages()
    if (!files?.length) return
    const c = at || this.visibleCenter()
    const placed = []
    let offset = 0
    for (const file of files) {
      const size = await imageSize(file).catch(() => ({ w: 320, h: 220 }))
      const scale = Math.min(1, 420 / size.w, 360 / size.h)
      const w = Math.round(size.w * scale)
      const h = Math.round(size.h * scale)
      const el = this.base('image', { x: c.x - w / 2 + offset, y: c.y - h / 2 + offset, w, h, src: '' })
      offset += 24
      const local = URL.createObjectURL(file)
      this.localImages.set(el.id, local)
      placed.push({ el: this.addElement(el), file, local })
    }
    this.set({ tool: 'select', selection: placed.map((p) => p.el.id) })
    for (const { el, file, local } of placed) {
      try {
        const [path] = await this.host.uploadFiles([file])
        if (path) this.store.update([[el.id, { src: path }]])
        else this.store.remove([el.id])
      } catch {
        this.store.remove([el.id])
      } finally {
        setTimeout(() => {
          this.localImages.delete(el.id)
          URL.revokeObjectURL(local)
          this.emit()
        }, 4000)
      }
    }
  }

  async insertNoteCard(at, extra = {}) {
    if (this.readOnly) return
    const pick = await this.host.pickLink?.()
    if (!pick) return null
    const c = at || this.visibleCenter()
    let el
    if (pick.url) el = this.base('link', { x: c.x - 130, y: c.y - 40, w: 260, h: 80, url: pick.url, name: pick.name || undefined, ...extra })
    else el = this.base('note', { x: c.x - 130, y: c.y - 70, w: 260, h: 140, path: pick.path, ...extra })
    if (extra.x == null && at?.free) Object.assign(el, this.freeSpot(el.x, el.y, el.w, el.h))
    this.set({ tool: 'select' })
    return this.addElement(el)
  }

  // ---------- pointer input ----------
  onPointerDown(e) {
    const p = this.host.toWorld(e.clientX, e.clientY)
    const now = performance.now()
    const dbl = this.lastDown && now - this.lastDown.t < DBL_MS && Math.hypot(e.clientX - this.lastDown.cx, e.clientY - this.lastDown.cy) < 6
    this.lastDown = dbl ? null : { t: now, cx: e.clientX, cy: e.clientY }

    if (e.button === 1 || (e.button === 0 && (this.state.spaceDown || this.state.tool === 'hand'))) {
      this.commitEditing()
      this.startGesture({ type: 'pan', lx: e.clientX, ly: e.clientY }, e)
      this.set({ panning: true })
      return true
    }
    if (e.button !== 0) return false
    const target = e.target
    if (target?.closest?.('.cv-edit, .cv-edit-frame')) return false
    if (target?.closest?.('.cv-card-open, .cv-link-mark')) return false
    if (this.state.editing) this.commitEditing()

    const tool = this.state.tool
    const layout = this.layout()
    const zoom = this.host.zoom()
    const tol = 6 / zoom

    if (tool === 'laser') {
      this.startGesture({ type: 'laser' }, e)
      this.addLaser(p)
      return true
    }
    if (this.readOnly && tool !== 'select') return false

    if (tool === 'select') {
      // the little buds around a shape start an arrow that is already bound to it
      const budEl = target?.closest?.('[data-arrowbud]')
      if (budEl && !this.readOnly) {
        this.startArrowFrom(budEl.dataset.arrowbud, budEl.dataset.owner, p, e)
        return true
      }
      const handleEl = target?.closest?.('[data-handle]')
      if (handleEl && !this.readOnly) {
        this.startHandle(handleEl.dataset, p, e)
        return true
      }
      // on notes, the inside of an empty shape belongs to the text underneath
      const hit = hitTest(layout, p.x, p.y, { tol, hollowInside: this.mode === 'board' })
      if (hit) {
        if (dbl) {
          this.doubleClick(hit, p)
          return true
        }
        const ids = this.expandGroup(hit, e)
        let selection = this.state.selection
        if (e.shiftKey) {
          const has = ids.every((id) => selection.includes(id))
          selection = has ? selection.filter((id) => !ids.includes(id)) : [...new Set([...selection, ...ids])]
        } else if (!ids.every((id) => selection.includes(id))) {
          selection = ids
        }
        this.host.focusCanvas?.()
        const wasSelected = ids.every((id) => this.state.selection.includes(id))
        this.set({ selection })
        if (!this.readOnly && selection.includes(hit.id)) this.startMove(p, e, { clickedIds: ids, wasSelected, shift: e.shiftKey, alt: e.altKey })
        else this.startGesture({ type: 'noop' }, e)
        return true
      }
      if (this.mode === 'note' && this.host.isTextArea?.(e.clientX, e.clientY)) {
        if (this.state.selection.length) this.set({ selection: [] })
        return false
      }
      if (dbl && !this.readOnly) {
        this.createTextAt(p, this.defaultTextKind())
        return true
      }
      this.host.focusCanvas?.()
      this.startGesture({ type: 'marquee', start: p, base: e.shiftKey ? this.state.selection : [] }, e)
      if (!e.shiftKey) this.set({ selection: [] })
      return true
    }

    this.host.focusCanvas?.()
    if (CREATE_BOX.has(tool)) {
      const el = this.base(tool, { x: p.x, y: p.y, w: 1, h: 1, ...(tool === 'frame' ? { name: 'Frame', z: this.store.minZ() - 1 } : {}) })
      this.store.checkpoint()
      this.store.add(el)
      this.startGesture({ type: 'create-box', id: el.id, start: p }, e)
      this.set({ selection: [el.id] })
      return true
    }
    if (tool === 'arrow' || tool === 'line') {
      const start = this.bindingAt(p, e, null)
      const el = this.base(tool, { x: p.x, y: p.y, w: 0, h: 0, points: [[0, 0], [0, 0]], ...(start ? { start } : {}) })
      if (tool === 'arrow') {
        el.heads = this.styleFor('linear').heads || ['none', 'arrow']
      }
      this.store.checkpoint()
      this.store.add(el)
      this.startGesture({ type: 'create-linear', id: el.id, start: p }, e)
      this.set({ selection: [el.id] })
      return true
    }
    if (tool === 'pen' || tool === 'marker') {
      const draft = this.base('pen', { x: p.x, y: p.y, points: [[0, 0, pressureOf(e)]], tool: tool === 'marker' ? 'marker' : undefined })
      if (tool === 'marker') draft.stroke = this.styleFor('marker').markerStroke || 'yellow'
      this.startGesture({ type: 'draw', origin: p }, e)
      this.set({ draft, rawPoints: draft.points, selection: [] })
      return true
    }
    if (tool === 'text') {
      const hitText = hitTest(layout, p.x, p.y, { tol })
      if (hitText && (hitText.type === 'text' || hitText.type === 'sticky')) {
        this.set({ selection: [hitText.id], editing: { id: hitText.id } })
      } else this.createTextAt(p, this.state.tool === 'text' ? 'plain' : this.defaultTextKind())
      this.startGesture({ type: 'noop' }, e)
      return true
    }
    if (tool === 'sticky') {
      const size = 190
      const el = this.base('sticky', { x: p.x - size / 2, y: p.y - size / 2, w: size, h: size, color: this.styleFor('sticky').color || 'yellow', align: 'left' })
      this.addElement(el, { edit: true })
      if (!this.state.lockTool) this.set({ tool: 'select' })
      this.startGesture({ type: 'noop' }, e)
      return true
    }
    if (tool === 'eraser') {
      this.store.checkpoint()
      this.startGesture({ type: 'erase', hit: new Set() }, e)
      this.eraseAt(p, tol * 2)
      return true
    }
    return false
  }

  expandGroup(hit, e) {
    const el = source(hit)
    if (!el.group || e.ctrlKey || e.metaKey) return [hit.id]
    return this.layout().list.filter((x) => x.group === el.group).map((x) => x.id)
  }

  // kind: 'plain' types exactly what you type; 'markdown' follows the same
  // rules as a note, in a block you can size yourself.
  createTextAt(p, kind = 'plain') {
    const s = this.styleFor('text')
    const fs = s.fs || DEFAULTS.fs
    const el =
      kind === 'markdown'
        ? this.base('text', { x: p.x, y: p.y - fs * 0.7, w: 320, h: fs * 2, text: '', align: 'left', md: true, wrap: true, font: 'sans' })
        : this.base('text', { x: p.x, y: p.y - fs * 0.7, w: 8, h: fs * 1.3, text: '', align: 'left' })
    this.addElement(el, { edit: true })
    if (!this.state.lockTool) this.set({ tool: 'select' })
  }

  // Turn a text block between "exactly what I typed" and "read this as markdown".
  toggleMarkdown() {
    const el = this.selected()[0]
    if (!el || el.type !== 'text' || el.locked || this.readOnly) return
    const src = source(el)
    const md = !src.md
    const next = { md: md || undefined, wrap: md ? true : undefined, w: md ? Math.max(src.w, 280) : src.w }
    this.store.checkpoint()
    this.store.update([[el.id, { ...next, ...this.textSize({ ...src, ...next }) }]])
  }

  // what a double-click on empty canvas makes
  defaultTextKind() {
    return this.host.textKind?.() || 'markdown'
  }

  doubleClick(hit, p) {
    const el = source(hit)
    if (el.type === 'note') return this.host.openNote?.(el.path)
    if (el.type === 'link') return this.host.openUrl?.(el.url)
    if (el.type === 'image' && el.src) return this.host.openFile?.(el.src)
    if (this.readOnly || el.locked) return
    if (el.type === 'pen') return
    if (isLinear(el)) {
      // double-click on a bend removes it
      const pts = visiblePoints(hit)
      const zoom = this.host.zoom()
      const idx = pts.findIndex((q, i) => i > 0 && i < pts.length - 1 && Math.hypot(q[0] - p.x, q[1] - p.y) < 10 / zoom)
      if (idx > 0) {
        const points = el.points.filter((_, i) => i !== idx)
        this.store.checkpoint()
        this.store.update([[el.id, { points }]])
        return
      }
    }
    this.set({ selection: [el.id], editing: { id: el.id } })
  }

  // Drag out of a shape's edge bud: an arrow that starts bound to that shape.
  startArrowFrom(side, ownerId, p, e) {
    const owner = this.layout().byId.get(ownerId)
    if (!owner || owner.locked) return
    const b = visualBounds(owner)
    const from = {
      n: { x: b.x + b.w / 2, y: b.y },
      s: { x: b.x + b.w / 2, y: b.y + b.h },
      w: { x: b.x, y: b.y + b.h / 2 },
      e: { x: b.x + b.w, y: b.y + b.h / 2 },
    }[side] || p
    const el = this.base('arrow', { x: from.x, y: from.y, w: 0, h: 0, points: [[0, 0], [0, 0]], start: { id: owner.id } })
    el.heads = this.styleFor('linear').heads || ['none', 'arrow']
    this.store.checkpoint()
    this.store.add(el)
    this.startGesture({ type: 'create-linear', id: el.id, start: from }, e)
    this.set({ selection: [el.id], hover: null })
  }

  bindingAt(p, e, skipId) {
    const t = bindTargetAt(this.layout(), p.x, p.y, skipId)
    if (t) return { id: t.id }
    if (this.mode === 'note' && this.host.textAnchorAt) {
      const a = this.host.textAnchorAt(e.clientX, e.clientY)
      if (a) return { anchor: a }
    }
    return null
  }

  bindingRect(binding) {
    if (!binding) return null
    const t = this.layout().target(binding)
    return t ? { x: t.x, y: t.y, w: t.w, h: t.h } : null
  }

  startGesture(g, e) {
    this.endGesture()
    this.gesture = g
    g.pointerId = e.pointerId
    const move = (ev) => this.onPointerMove(ev)
    const up = (ev) => this.onPointerUp(ev)
    const cancel = () => this.onPointerUp(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    g.off = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }

  endGesture() {
    const g = this.gesture
    if (!g) return
    g.off?.()
    cancelAnimationFrame(g.raf)
    this.gesture = null
  }

  onPointerMove(e) {
    const g = this.gesture
    if (!g) return
    if (g.type === 'pan') {
      this.host.panBy(e.clientX - g.lx, e.clientY - g.ly)
      g.lx = e.clientX
      g.ly = e.clientY
      return
    }
    if (g.type === 'draw') {
      const events = e.getCoalescedEvents?.() || [e]
      const draft = this.state.draft
      if (!draft) return
      const pts = (this.state.rawPoints || draft.points).slice()
      for (const ev of events) {
        const q = this.host.toWorld(ev.clientX, ev.clientY)
        pts.push([q.x - draft.x, q.y - draft.y, pressureOf(ev)])
      }
      // Simplify as we go, exactly as the finished stroke is simplified:
      // perfect-freehand fakes pressure from point spacing, so a draft made
      // of raw dense points draws thicker than the stroke it turns into.
      const zoom = this.host.zoom()
      const shown = pts.length > 2 ? simplify(pts, 0.35 / zoom) : pts
      this.set({ draft: { ...draft, points: shown }, rawPoints: pts })
      return
    }
    g.last = e
    if (!g.raf) {
      g.raf = requestAnimationFrame(() => {
        g.raf = 0
        if (this.gesture === g && g.last) this.applyMove(g, g.last)
      })
    }
  }

  applyMove(g, e) {
    const p = this.host.toWorld(e.clientX, e.clientY)
    switch (g.type) {
      case 'marquee': {
        const rect = normRect(g.start, p)
        const inside = inMarquee(this.layout(), rect).map((el) => el.id)
        this.set({ marquee: rect, selection: [...new Set([...g.base, ...inside])] })
        break
      }
      case 'move':
        this.moveTo(g, p, e)
        break
      case 'resize':
        this.resizeTo(g, p, e)
        break
      case 'point':
        this.pointTo(g, p, e)
        break
      case 'create-box': {
        let { x, y } = g.start
        let w = p.x - x
        let h = p.y - y
        if (e.shiftKey) {
          const s = Math.max(Math.abs(w), Math.abs(h))
          w = Math.sign(w || 1) * s
          h = Math.sign(h || 1) * s
        }
        if (e.altKey) {
          x -= w
          y -= h
          w *= 2
          h *= 2
        }
        const r = normRect({ x, y }, { x: x + w, y: y + h })
        this.store.update([[g.id, this.snapBox(r)]])
        g.moved = true
        break
      }
      case 'create-linear': {
        let dx = p.x - g.start.x
        let dy = p.y - g.start.y
        if (e.shiftKey) [dx, dy] = snapAngle(dx, dy)
        const end = this.bindingAt(p, e, g.id)
        this.store.update([[g.id, { points: [[0, 0], [dx, dy]], x: g.start.x, y: g.start.y, end: end || undefined }]])
        this.set({ bindHint: this.bindingRect(end) })
        g.moved = Math.hypot(dx, dy) > 3
        break
      }
      case 'erase':
        this.eraseAt(p, (8 / this.host.zoom()))
        break
      case 'laser':
        this.addLaser(p)
        break
    }
    this.host.onPresence?.(p)
  }

  onPointerUp(e) {
    const g = this.gesture
    if (!g) return
    if (g.raf && g.last && e) {
      cancelAnimationFrame(g.raf)
      g.raf = 0
      this.applyMove(g, g.last)
    }
    this.endGesture()
    switch (g.type) {
      case 'pan':
        this.set({ panning: false })
        this.host.onPanEnd?.()
        break
      case 'marquee':
        this.set({ marquee: null })
        break
      case 'move':
        this.endMove(g, e)
        break
      case 'resize':
        this.endResize(g)
        break
      case 'point':
        this.set({ bindHint: null })
        this.reanchor([g.id])
        break
      case 'create-box': {
        const el = this.store.get(g.id)
        if (el && (!g.moved || (el.w < 6 && el.h < 6))) {
          const def = el.type === 'frame' ? { w: 360, h: 240 } : el.type === 'diamond' ? { w: 120, h: 120 } : { w: 150, h: 96 }
          this.store.update([[g.id, { x: g.start.x - def.w / 2, y: g.start.y - def.h / 2, ...def }]])
        }
        this.reanchor([g.id])
        if (!this.state.lockTool) this.set({ tool: 'select' })
        break
      }
      case 'create-linear': {
        this.set({ bindHint: null })
        const el = this.store.get(g.id)
        if (!g.moved && el) {
          this.store.remove([g.id])
          this.set({ selection: [] })
        } else {
          this.reanchor([g.id])
          if (!this.state.lockTool) this.set({ tool: 'select' })
        }
        break
      }
      case 'draw': {
        const draft = this.state.draft
        const raw = this.state.rawPoints
        this.set({ draft: null, rawPoints: null })
        if (!draft) break
        const zoom = this.host.zoom()
        let pts = raw || draft.points
        if (pts.length > 2) pts = simplify(pts, 0.35 / zoom)
        const el = normalizeLinear({ ...draft, points: pts.map((q) => q.map((n) => Math.round(n * 100) / 100)) })
        this.store.checkpoint()
        this.store.add(this.anchorize(el))
        break
      }
      case 'erase': {
        const ids = [...g.hit]
        this.set({ erasing: [] })
        if (ids.length) this.store.remove(ids)
        break
      }
    }
  }

  // ---------- move ----------
  startMove(p, e, info) {
    const layout = this.layout()
    let ids = this.state.selection.filter((id) => !layout.byId.get(id)?.locked)
    if (!ids.length) return this.startGesture({ type: 'noop' }, e)
    // frames carry what sits inside them
    const extra = []
    for (const id of ids) {
      const el = layout.byId.get(id)
      if (el?.type !== 'frame') continue
      const fb = elementBounds(el)
      for (const other of layout.list) {
        if (ids.includes(other.id) || other.locked) continue
        const b = visualBounds(other)
        if (b.x >= fb.x && b.y >= fb.y && b.x + b.w <= fb.x + fb.w && b.y + b.h <= fb.y + fb.h) extra.push(other.id)
      }
    }
    ids = [...new Set([...ids, ...extra])]
    const orig = new Map()
    for (const id of ids) {
      const el = layout.byId.get(id)
      const src = source(el)
      orig.set(id, { x: el.x, y: el.y, sy: src.y, dy: src.dy, start: src.start, end: src.end, pts: el._pts })
    }
    const bounds = unionBounds(ids.map((id) => visualBounds(layout.byId.get(id))))
    this.startGesture({ type: 'move', start: p, ids, orig, bounds, moved: false, ...info }, e)
  }

  moveTo(g, p, e) {
    let dx = p.x - g.start.x
    let dy = p.y - g.start.y
    const zoom = this.host.zoom()
    if (!g.moved) {
      if (Math.hypot(dx, dy) * zoom < 3) return
      g.moved = true
      this.store.checkpoint()
      if (g.alt) this.duplicateInPlace(g)
    }
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    const snap = this.snapMove(g, dx, dy)
    dx = snap.dx
    dy = snap.dy
    const moving = new Set(g.ids)
    const patches = []
    for (const id of g.ids) {
      const o = g.orig.get(id)
      const patch = { x: o.x + dx, y: o.sy + dy }
      if (o.dy != null) patch.dy = o.dy + dy
      const el = this.store.get(id)
      if (el && isLinear(el)) {
        // detach from things that are not moving along
        if (o.start && !(o.start.id && moving.has(o.start.id))) patch.start = undefined
        if (o.end && !(o.end.id && moving.has(o.end.id))) patch.end = undefined
        if ((o.start && patch.start === undefined) || (o.end && patch.end === undefined)) {
          if (o.pts) {
            const pts = o.pts.map(([px, py]) => [px - o.x, py - o.y])
            patch.points = pts
          }
        }
      }
      patches.push([id, patch])
    }
    this.store.update(patches)
    this.set({ snapLines: snap.lines })
  }

  duplicateInPlace(g) {
    // alt-drag: leave copies behind and move the originals
    const copies = []
    for (const id of g.ids) {
      const el = this.store.get(id)
      if (!el) continue
      copies.push({ ...el, id: newElementId(), z: el.z - 0.001, seed: newSeed() })
    }
    this.store.add(copies)
  }

  endMove(g) {
    this.set({ snapLines: [] })
    if (!g.moved) {
      // a plain click inside a multi-selection narrows it to what was clicked
      if (g.wasSelected && !g.shift && this.state.selection.length > g.clickedIds.length) this.set({ selection: g.clickedIds })
      return
    }
    this.reanchor(g.ids)
  }

  // snap the moving bounds to edges/centres of nearby elements (and the grid)
  snapMove(g, dx, dy) {
    const b = g.bounds
    if (!b) return { dx, dy, lines: [] }
    const zoom = this.host.zoom()
    const tol = 6 / zoom
    if (this.state.grid && this.mode === 'board') {
      const step = 20
      const nx = Math.round((b.x + dx) / step) * step
      const ny = Math.round((b.y + dy) / step) * step
      return { dx: nx - b.x, dy: ny - b.y, lines: [] }
    }
    const layout = this.layout()
    const xs = [b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w]
    const ys = [b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h]
    let bestX = null
    let bestY = null
    const view = this.host.visibleRect?.()
    for (const el of layout.list) {
      if (g.ids.includes(el.id) || el.type === 'pen') continue
      const o = visualBounds(el)
      if (view && (o.x > view.x + view.w || o.y > view.y + view.h || o.x + o.w < view.x || o.y + o.h < view.y)) continue
      const oxs = [o.x, o.x + o.w / 2, o.x + o.w]
      const oys = [o.y, o.y + o.h / 2, o.y + o.h]
      for (const a of xs) for (const c of oxs) if (Math.abs(a - c) < tol && (!bestX || Math.abs(a - c) < Math.abs(bestX.d))) bestX = { d: c - a, at: c, o }
      for (const a of ys) for (const c of oys) if (Math.abs(a - c) < tol && (!bestY || Math.abs(a - c) < Math.abs(bestY.d))) bestY = { d: c - a, at: c, o }
    }
    const lines = []
    if (bestX) {
      dx += bestX.d
      const y1 = Math.min(b.y + dy, bestX.o.y)
      const y2 = Math.max(b.y + dy + b.h, bestX.o.y + bestX.o.h)
      lines.push({ x: bestX.at, y: y1, w: 0, h: y2 - y1 })
    }
    if (bestY) {
      dy += bestY.d
      const x1 = Math.min(b.x + dx, bestY.o.x)
      const x2 = Math.max(b.x + dx + b.w, bestY.o.x + bestY.o.w)
      lines.push({ x: x1, y: bestY.at, w: x2 - x1, h: 0 })
    }
    return { dx, dy, lines }
  }

  snapBox(r) {
    if (!(this.state.grid && this.mode === 'board')) return r
    const s = 20
    const x = Math.round(r.x / s) * s
    const y = Math.round(r.y / s) * s
    return { x, y, w: Math.max(s, Math.round((r.x + r.w) / s) * s - x), h: Math.max(s, Math.round((r.y + r.h) / s) * s - y) }
  }

  // re-attach elements to the note line they now sit on
  reanchor(ids) {
    if (this.mode !== 'note') return
    const patches = []
    for (const id of ids) {
      const el = this.layout().byId.get(id)
      if (!el) continue
      const a = this.host.anchorFor?.(el.y)
      if (a) patches.push([id, { anchor: a.anchor, dy: Math.round((el.y - a.top) * 100) / 100, y: el.y }])
      else if (source(el).anchor) patches.push([id, { anchor: undefined, dy: undefined, y: el.y }])
    }
    if (patches.length) this.store.update(patches)
  }

  // ---------- handles ----------
  startHandle(data, p, e) {
    const layout = this.layout()
    this.store.checkpoint()
    if (data.handle === 'point' || data.handle === 'mid') {
      const el = layout.byId.get(data.id)
      if (!el) return
      this.startGesture({ type: 'point', id: el.id, index: Number(data.index), mid: data.handle === 'mid', inserted: false, pts: visiblePoints(el) }, e)
      return
    }
    const sel = this.selected().filter((el) => !el.locked)
    if (!sel.length) return
    const bounds = unionBounds(sel.map(visualBounds))
    const orig = new Map(sel.map((el) => [el.id, { ...source(el), y: el.y, _pts: el._pts }]))
    this.startGesture({ type: 'resize', dir: data.handle, bounds, orig, ids: sel.map((el) => el.id), start: p }, e)
  }

  resizeTo(g, p, e) {
    const b = g.bounds
    const dir = g.dir
    let x1 = b.x
    let y1 = b.y
    let x2 = b.x + b.w
    let y2 = b.y + b.h
    if (dir.includes('w')) x1 = p.x
    if (dir.includes('e')) x2 = p.x
    if (dir.includes('n')) y1 = p.y
    if (dir.includes('s')) y2 = p.y
    const single = g.ids.length === 1 ? g.orig.get(g.ids[0]) : null
    const keepAspect = e.shiftKey !== (single?.type === 'image') && dir.length === 2
    if (keepAspect && b.w && b.h) {
      const ratio = b.w / b.h
      let w = x2 - x1
      let h = y2 - y1
      if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * Math.abs(w) / ratio
      else w = (Math.sign(w) || 1) * Math.abs(h) * ratio
      if (dir.includes('w')) x1 = x2 - w
      else x2 = x1 + w
      if (dir.includes('n')) y1 = y2 - h
      else y2 = y1 + h
    }
    if (e.altKey) {
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      if (dir.includes('w') || dir.includes('e')) {
        const hw = Math.abs((dir.includes('w') ? x1 : x2) - cx)
        x1 = cx - hw
        x2 = cx + hw
      }
      if (dir.includes('n') || dir.includes('s')) {
        const hh = Math.abs((dir.includes('n') ? y1 : y2) - cy)
        y1 = cy - hh
        y2 = cy + hh
      }
    }
    const nb = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(2, Math.abs(x2 - x1)), h: Math.max(2, Math.abs(y2 - y1)) }
    const sx = b.w ? nb.w / b.w : 1
    const sy = b.h ? nb.h / b.h : 1
    const patches = []
    for (const id of g.ids) {
      const o = g.orig.get(id)
      if (isLinear(o)) {
        const pts = (o._pts || absPoints(o)).map((q) => [nb.x + (q[0] - b.x) * sx, nb.y + (q[1] - b.y) * sy, q[2]].filter((n) => n !== undefined))
        const next = normalizeLinear({ ...o, x: 0, y: 0, points: pts })
        patches.push([id, { x: next.x, y: next.y, points: next.points, ...(o.dy != null ? { dy: o.dy + (next.y - o.y) } : {}) }])
        continue
      }
      const ob = elementBounds(o)
      const nx = nb.x + (ob.x - b.x) * sx
      const ny = nb.y + (ob.y - b.y) * sy
      const patch = { x: nx, y: ny, w: Math.max(4, ob.w * sx), h: Math.max(4, ob.h * sy) }
      if (o.dy != null) patch.dy = o.dy + (ny - o.y)
      if (o.type === 'text') {
        if (dir.length === 2) {
          patch.fs = Math.max(6, Math.round(val(o, 'fs') * sy * 10) / 10)
          const m = measureText(o.text, { font: val(o, 'font'), fs: patch.fs, width: o.wrap ? patch.w : null })
          patch.h = m.h
          if (!o.wrap) patch.w = m.w
        } else if (dir === 'e' || dir === 'w') {
          patch.wrap = true
          patch.h = measureText(o.text, { font: val(o, 'font'), fs: val(o, 'fs'), width: patch.w }).h
        } else {
          delete patch.h
          delete patch.y
        }
      }
      patches.push([id, patch])
    }
    this.store.update(patches)
  }

  endResize(g) {
    this.reanchor(g.ids)
  }

  pointTo(g, p, e) {
    const el = this.store.get(g.id)
    if (!el) return
    const pts = g.pts.map((q) => [q[0], q[1]])
    let idx = g.index
    if (g.mid) {
      if (!g.inserted) {
        g.inserted = true
        g.insertAt = idx + 1
      }
      pts.splice(g.insertAt, 0, [p.x, p.y])
      idx = g.insertAt
    }
    let tx = p.x
    let ty = p.y
    if (e.shiftKey) {
      const ref = pts[idx === 0 ? 1 : idx - 1]
      const [sx, sy] = snapAngle(tx - ref[0], ty - ref[1])
      tx = ref[0] + sx
      ty = ref[1] + sy
    }
    pts[idx] = [tx, ty]
    const patch = { x: 0, y: 0, points: pts }
    let hint = null
    const isEnd = !g.mid && (idx === 0 || idx === pts.length - 1)
    if (isEnd && el.type !== 'pen') {
      const binding = this.bindingAt(p, e, el.id)
      patch[idx === 0 ? 'start' : 'end'] = binding || undefined
      hint = this.bindingRect(binding)
    }
    const next = normalizeLinear({ ...el, ...patch })
    const src = source(this.layout().byId.get(g.id) || el)
    const upd = { x: next.x, y: next.y, points: next.points }
    if ('start' in patch) upd.start = patch.start
    if ('end' in patch) upd.end = patch.end
    if (src.dy != null) upd.dy = src.dy + (next.y - (this.layout().byId.get(g.id)?.y ?? el.y))
    this.store.update([[g.id, upd]])
    this.set({ bindHint: hint })
  }

  // ---------- eraser & laser ----------
  eraseAt(p, tol) {
    const g = this.gesture
    if (!g) return
    for (const id of erasedBy(this.layout(), p.x, p.y, tol)) g.hit.add(id)
    this.set({ erasing: [...g.hit] })
  }

  addLaser(p) {
    const now = performance.now()
    const laser = [...this.state.laser.filter((q) => now - q.t < 900), { x: p.x, y: p.y, t: now }]
    this.set({ laser })
    this.host.onLaser?.(laser)
    if (!this.laserRaf) {
      const tick = () => {
        const t = performance.now()
        const next = this.state.laser.filter((q) => t - q.t < 900)
        if (next.length !== this.state.laser.length || next.length) this.set({ laser: next })
        this.laserRaf = next.length ? requestAnimationFrame(tick) : 0
      }
      this.laserRaf = requestAnimationFrame(tick)
    }
  }

  // ---------- hover ----------
  hoverAt(e) {
    if (this.gesture) return
    const p = this.host.toWorld(e.clientX, e.clientY)
    this.host.onPresence?.(p)
    if (this.state.tool !== 'select') return
    const layout = this.layout()
    const hit = hitTest(layout, p.x, p.y, { tol: 6 / this.host.zoom(), hollowInside: this.mode === 'board' })
    const hover = hit?.id || null
    if (hover !== this.state.hover) this.set({ hover })
  }

  // ---------- editing ----------
  commitEditing(value) {
    const ed = this.state.editing
    if (!ed) return
    const el = this.store.get(ed.id)
    this.set({ editing: null })
    if (!el) return
    const text = value ?? ed.value ?? el.text ?? ''
    if (el.type === 'text' && !text.trim()) {
      this.store.remove([el.id])
      return
    }
    if (el.type === 'frame') {
      this.store.update([[el.id, { name: text.trim() || 'Frame' }]])
      return
    }
    const patch = { text: text || undefined }
    if (el.type === 'text') Object.assign(patch, this.textSize({ ...el, text }))
    if (el.type === 'sticky') {
      const m = measureText(text, { font: val({ font: el.font || 'hand' }, 'font'), fs: val(el, 'fs'), width: el.w - 32 })
      if (m.h + 40 > el.h) patch.h = Math.ceil(m.h + 40)
    }
    this.store.update([[el.id, patch]])
  }

  setEditingValue(value) {
    const ed = this.state.editing
    if (!ed) return
    ed.value = value
    const el = this.store.get(ed.id)
    // grow text boxes live while typing
    if (el?.type === 'text') {
      const size = this.textSize({ ...el, text: value })
      if (size.w !== el.w || size.h !== el.h) this.store.update([[el.id, size]])
    }
  }

  // ---------- commands ----------
  deleteSelection() {
    if (this.readOnly) return
    const ids = this.selected().filter((el) => !el.locked).map((el) => el.id)
    if (!ids.length) return
    this.store.checkpoint()
    this.store.remove(ids)
    this.set({ selection: [] })
  }

  selectAll() {
    this.set({ selection: this.layout().list.map((el) => el.id), tool: 'select' })
  }

  duplicate(offset = 18) {
    if (this.readOnly) return
    const els = this.selected().map(source)
    if (!els.length) return
    const copies = cloneElements(els, offset, this.store.maxZ() + 1)
    this.store.checkpoint()
    this.store.add(copies)
    this.set({ selection: copies.map((c) => c.id) })
  }

  copy(cut = false) {
    const els = this.selected().map(source)
    if (!els.length) return false
    this.clip = els
    const payload = JSON.stringify({ type: 'obi-board-clip', elements: els })
    navigator.clipboard?.writeText(payload).catch(() => {})
    if (cut) this.deleteSelection()
    return true
  }

  async paste(e) {
    if (this.readOnly) return false
    const dt = e?.clipboardData
    const files = [...(dt?.files || [])].filter((f) => f.type.startsWith('image/'))
    const at = this.host.pointerWorld?.() || this.visibleCenter()
    if (files.length) {
      e.preventDefault()
      this.insertImages(files, at)
      return true
    }
    const text = dt?.getData('text/plain') ?? (await navigator.clipboard?.readText?.().catch(() => '')) ?? ''
    let clip = null
    try {
      const data = JSON.parse(text)
      if (data?.type === 'obi-board-clip' && Array.isArray(data.elements)) clip = data.elements
    } catch {}
    if (!clip && !text && this.clip) clip = this.clip
    e?.preventDefault?.()
    if (clip) {
      const b = unionBounds(clip.map(elementBounds))
      const copies = cloneElements(clip, 0, this.store.maxZ() + 1).map((el) => ({ ...el, x: el.x + (at.x - (b.x + b.w / 2)), y: el.y + (at.y - (b.y + b.h / 2)) }))
      this.store.checkpoint()
      this.store.add(copies.map((c) => this.anchorize(c)))
      this.set({ selection: copies.map((c) => c.id), tool: 'select' })
      return true
    }
    const trimmed = text.trim()
    if (!trimmed) return false
    if (/^https?:\/\/\S+$/.test(trimmed)) {
      const el = this.base('link', { x: at.x - 130, y: at.y - 40, w: 260, h: 80, url: trimmed })
      this.addElement(el)
      return true
    }
    const fs = this.styleFor('text').fs || DEFAULTS.fs
    const el = this.base('text', { x: at.x, y: at.y, text: trimmed.slice(0, 5000), align: 'left' })
    Object.assign(el, this.textSize({ ...el, fs }))
    if (el.w > 520) Object.assign(el, { wrap: true, w: 520 }, this.textSize({ ...el, wrap: true, w: 520 }))
    this.addElement(el)
    return true
  }

  order(kind) {
    const sel = this.selected().map(source)
    if (!sel.length || this.readOnly) return
    const list = this.store.getSnapshot().list
    const ids = new Set(sel.map((e) => e.id))
    let patches = []
    if (kind === 'front') patches = sel.sort((a, b) => a.z - b.z).map((el, i) => [el.id, { z: this.store.maxZ() + 1 + i }])
    else if (kind === 'back') patches = sel.sort((a, b) => a.z - b.z).map((el, i) => [el.id, { z: this.store.minZ() - sel.length + i }])
    else {
      for (const el of sel) {
        const idx = list.findIndex((x) => x.id === el.id)
        const step = kind === 'forward' ? 1 : -1
        let j = idx + step
        while (list[j] && ids.has(list[j].id)) j += step
        const other = list[j]
        if (!other) continue
        const beyond = list[j + step]
        const z = beyond ? (other.z + beyond.z) / 2 : other.z + step
        patches.push([el.id, { z }])
      }
    }
    this.store.checkpoint()
    this.store.update(patches)
  }

  group() {
    const sel = this.selected()
    if (sel.length < 2 || this.readOnly) return
    const g = newElementId()
    this.store.checkpoint()
    this.store.update(sel.map((el) => [el.id, { group: g }]))
  }

  ungroup() {
    const sel = this.selected()
    if (!sel.length || this.readOnly) return
    this.store.checkpoint()
    this.store.update(sel.map((el) => [el.id, { group: undefined }]))
  }

  toggleLock() {
    const sel = this.selected()
    if (!sel.length || this.readOnly) return
    const lock = !sel.every((el) => el.locked)
    this.store.checkpoint()
    this.store.update(sel.map((el) => [el.id, { locked: lock || undefined }]))
  }

  align(kind) {
    const sel = this.selected().filter((el) => !el.locked)
    if (sel.length < 2 || this.readOnly) return
    const bb = unionBounds(sel.map(visualBounds))
    const patches = []
    if (kind === 'hdist' || kind === 'vdist') {
      const horiz = kind === 'hdist'
      const sorted = [...sel].sort((a, b) => (horiz ? visualBounds(a).x - visualBounds(b).x : visualBounds(a).y - visualBounds(b).y))
      const total = sorted.reduce((n, el) => n + (horiz ? visualBounds(el).w : visualBounds(el).h), 0)
      const gap = ((horiz ? bb.w : bb.h) - total) / (sorted.length - 1)
      let cursor = horiz ? bb.x : bb.y
      for (const el of sorted) {
        const b = visualBounds(el)
        const d = cursor - (horiz ? b.x : b.y)
        patches.push([el.id, horiz ? { x: el.x + d } : { y: source(el).y + d, ...(source(el).dy != null ? { dy: source(el).dy + d } : {}) }])
        cursor += (horiz ? b.w : b.h) + gap
      }
    } else {
      for (const el of sel) {
        const b = visualBounds(el)
        let dx = 0
        let dy = 0
        if (kind === 'left') dx = bb.x - b.x
        if (kind === 'right') dx = bb.x + bb.w - (b.x + b.w)
        if (kind === 'hcenter') dx = bb.x + bb.w / 2 - (b.x + b.w / 2)
        if (kind === 'top') dy = bb.y - b.y
        if (kind === 'bottom') dy = bb.y + bb.h - (b.y + b.h)
        if (kind === 'vcenter') dy = bb.y + bb.h / 2 - (b.y + b.h / 2)
        const src = source(el)
        patches.push([el.id, { x: el.x + dx, y: el.y + dy, ...(src.dy != null ? { dy: src.dy + dy } : {}) }])
      }
    }
    this.store.checkpoint()
    this.store.update(patches)
    this.reanchor(sel.map((el) => el.id))
  }

  nudge(dx, dy) {
    const sel = this.selected().filter((el) => !el.locked)
    if (!sel.length || this.readOnly) return
    this.store.update(sel.map((el) => [el.id, { x: el.x + dx, y: el.y + dy, ...(source(el).dy != null ? { dy: source(el).dy + dy } : {}) }]))
    clearTimeout(this.nudgeTimer)
    this.nudgeTimer = setTimeout(() => {
      this.store.checkpoint()
      this.reanchor(sel.map((el) => el.id))
    }, 400)
  }

  async setLink() {
    const sel = this.selected()
    if (sel.length !== 1 || this.readOnly) return
    const pick = await this.host.pickLink?.({ allowRemove: !!source(sel[0]).link })
    if (!pick) return
    this.store.checkpoint()
    this.store.update([[sel[0].id, { link: pick.remove ? undefined : pick.url || pick.path }]])
  }

  undo() {
    this.store.undo()
  }
  redo() {
    this.store.redo()
  }

  // ---------- keyboard ----------
  onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (this.state.editing) {
      if (e.key === 'Escape' || (mod && e.key === 'Enter')) {
        e.preventDefault()
        const id = this.state.editing.id
        this.commitEditing()
        this.set({ selection: [id] })
        this.host.focusCanvas?.()
        return true
      }
      return false
    }
    if (e.key === ' ' && !e.repeat) {
      this.set({ spaceDown: true })
      e.preventDefault()
      return true
    }
    if (mod && k === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
      return true
    }
    if (mod && k === 'y') {
      e.preventDefault()
      this.redo()
      return true
    }
    if (mod && k === 'a') {
      e.preventDefault()
      this.selectAll()
      return true
    }
    if (mod && k === 'd') {
      e.preventDefault()
      this.duplicate()
      return true
    }
    if (mod && (k === 'c' || k === 'x')) {
      if (this.copy(k === 'x')) {
        e.preventDefault()
        return true
      }
      return false
    }
    if (mod && k === 'g') {
      e.preventDefault()
      if (e.shiftKey) this.ungroup()
      else this.group()
      return true
    }
    if (mod && e.shiftKey && k === 'l') {
      e.preventDefault()
      this.toggleLock()
      return true
    }
    if (mod && e.key === ']') {
      e.preventDefault()
      this.order('front')
      return true
    }
    if (mod && e.key === '[') {
      e.preventDefault()
      this.order('back')
      return true
    }
    if (mod) return false
    if (e.key === ']') return this.order('forward'), true
    if (e.key === '[') return this.order('backward'), true
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this.state.selection.length) return false
      e.preventDefault()
      this.deleteSelection()
      return true
    }
    if (e.key === 'Escape') {
      if (this.state.tool !== 'select') this.setTool('select')
      else if (this.state.selection.length) this.set({ selection: [] })
      else return false
      e.preventDefault()
      return true
    }
    if (e.key === 'Enter' && this.state.selection.length === 1) {
      const el = source(this.selected()[0])
      if (el && !el.locked && !this.readOnly && ['text', 'sticky', 'rect', 'ellipse', 'diamond', 'arrow', 'line', 'frame'].includes(el.type)) {
        e.preventDefault()
        this.set({ editing: { id: el.id } })
        return true
      }
    }
    if (e.key.startsWith('Arrow') && this.state.selection.length) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      this.nudge(d[0], d[1])
      return true
    }
    if (e.altKey) return false
    if (k === 'q') {
      this.toggleToolLock()
      return true
    }
    if (k === 'g' && this.mode === 'board') {
      this.toggleGrid()
      return true
    }
    if (TOOL_KEYS[k] && !e.shiftKey) {
      e.preventDefault()
      this.setTool(TOOL_KEYS[k])
      return true
    }
    return false
  }

  onKeyUp(e) {
    if (e.key === ' ') {
      this.set({ spaceDown: false })
      return true
    }
    return false
  }
}

// ---------- helpers ----------

export function appliesTo(key, el) {
  const t = el.type
  switch (key) {
    case 'stroke':
      return ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'pen', 'text'].includes(t)
    case 'fill':
    case 'fillStyle':
    case 'round':
      return ['rect', 'ellipse', 'diamond'].includes(t) && !(key === 'round' && t === 'ellipse')
    case 'sw':
      return ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'pen'].includes(t)
    case 'dash':
    case 'rough':
      return ['rect', 'ellipse', 'diamond', 'line', 'arrow'].includes(t)
    case 'font':
    case 'fs':
      return ['text', 'sticky', 'rect', 'ellipse', 'diamond', 'arrow', 'line'].includes(t)
    case 'align':
      return ['text', 'sticky', 'rect', 'ellipse', 'diamond'].includes(t)
    case 'color':
      return t === 'sticky'
    case 'heads':
    case 'curve':
      return t === 'arrow' || t === 'line'
    case 'opacity':
      return t !== 'highlight'
    default:
      return false
  }
}

export function cloneElements(els, offset, zBase) {
  const idMap = new Map(els.map((el) => [el.id, newElementId()]))
  const groupMap = new Map()
  return els
    .slice()
    .sort((a, b) => (a.z || 0) - (b.z || 0))
    .map((el, i) => {
      const c = { ...el, id: idMap.get(el.id), x: el.x + offset, y: el.y + offset, z: zBase + i, seed: newSeed() }
      if (c.dy != null) c.dy += offset
      if (el.group) {
        if (!groupMap.has(el.group)) groupMap.set(el.group, newElementId())
        c.group = groupMap.get(el.group)
      }
      for (const k of ['start', 'end']) {
        if (!el[k]) continue
        if (el[k].id) {
          if (idMap.has(el[k].id)) c[k] = { id: idMap.get(el[k].id) }
          else delete c[k]
        }
      }
      delete c.anchor
      return c
    })
}

function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

function snapAngle(dx, dy) {
  const len = Math.hypot(dx, dy)
  const step = Math.PI / 12
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return [Math.cos(ang) * len, Math.sin(ang) * len]
}

function pressureOf(e) {
  if (!e || e.pointerType !== 'pen') return 0.5
  return Math.round((e.pressure || 0.5) * 100) / 100
}

function imageSize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 220 })
      URL.revokeObjectURL(url)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

export { midPoint }
