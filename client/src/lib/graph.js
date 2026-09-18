import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force'
import { isNote, basename, stripExt, extname, IMAGE_EXT } from '@shared/paths.js'

// Build graph data from the workspace index
export function buildGraph({ notes, tree, resolver, options = {}, focus = null, depth = 1 }) {
  const { showTags, showAttachments, showUnresolved, showOrphans = true } = options
  const nodes = new Map()
  const links = []
  const addNode = (id, data) => {
    if (!nodes.has(id)) nodes.set(id, { id, degree: 0, ...data })
    return nodes.get(id)
  }

  for (const [path] of notes) addNode(path, { label: stripExt(basename(path)), type: 'note', path })
  if (showAttachments) {
    for (const e of tree) {
      if (e.type === 'file' && !isNote(e.path)) addNode(e.path, { label: basename(e.path), type: IMAGE_EXT.has(extname(e.path)) ? 'image' : 'file', path: e.path })
    }
  }

  for (const [path, meta] of notes) {
    for (const link of meta.links || []) {
      const target = resolver.resolve(link.t, path, link.k === 'md' ? 'md' : 'wiki')
      if (target) {
        if (!nodes.has(target)) continue
        if (target === path) continue
        links.push({ source: path, target, kind: 'link' })
      } else if (showUnresolved && link.t) {
        const id = `ghost:${link.t.toLowerCase()}`
        addNode(id, { label: link.t, type: 'unresolved' })
        links.push({ source: path, target: id, kind: 'unresolved' })
      }
    }
    if (showTags) {
      for (const tag of meta.tags || []) {
        const id = `tag:${tag.toLowerCase()}`
        addNode(id, { label: `#${tag}`, type: 'tag' })
        links.push({ source: path, target: id, kind: 'tag' })
      }
    }
  }

  // dedupe links
  const seen = new Set()
  const uniq = []
  for (const l of links) {
    const key = `${l.source}\u0000${l.target}`
    const rev = `${l.target}\u0000${l.source}`
    if (seen.has(key) || seen.has(rev)) continue
    seen.add(key)
    uniq.push(l)
    nodes.get(l.source).degree++
    nodes.get(l.target).degree++
  }

  let list = [...nodes.values()]
  let linkList = uniq

  if (focus) {
    const keep = new Set([focus])
    let frontier = new Set([focus])
    for (let d = 0; d < depth; d++) {
      const next = new Set()
      for (const l of uniq) {
        if (frontier.has(l.source) && !keep.has(l.target)) next.add(l.target)
        if (frontier.has(l.target) && !keep.has(l.source)) next.add(l.source)
      }
      for (const n of next) keep.add(n)
      frontier = next
    }
    list = list.filter((n) => keep.has(n.id))
    linkList = uniq.filter((l) => keep.has(l.source) && keep.has(l.target))
  } else if (!showOrphans) {
    const connected = new Set()
    for (const l of uniq) {
      connected.add(l.source)
      connected.add(l.target)
    }
    list = list.filter((n) => connected.has(n.id))
  }

  return { nodes: list, links: linkList }
}


export class GraphRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.opts = { nodeSize: 1, labels: 1, colorFolders: true, ...opts }
    this.nodes = []
    this.links = []
    this.positions = new Map()
    this.transform = { x: 0, y: 0, k: 1 }
    this.hover = null
    this.highlight = new Set()
    this.focus = null
    this.dragging = null
    this.needsDraw = true
    this.userMoved = false
    this.autoFit = true
    this.running = true
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.colors = readColors()

    this.sim = forceSimulation([])
      .force('link', forceLink([]).id((d) => d.id).distance(opts.linkDistance || 70).strength(0.6))
      .force('charge', forceManyBody().strength(-(opts.repel || 140)).distanceMax(600))
      .force('center', forceCenter(0, 0).strength(0.08))
      .force('x', forceX(0).strength(0.02))
      .force('y', forceY(0).strength(0.02))
      .force('collide', forceCollide((d) => this.radius(d) + 3))
      .alphaDecay(0.028)
      .on('tick', () => {
        this.needsDraw = true
        // Frame the graph once the layout stops moving — fitting while it is
        // still spreading leaves half the notes off screen.
        if (this.autoFit && !this.userMoved && this.sim.alpha() < 0.12) {
          this.autoFit = false
          this.fit()
        }
      })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.bindEvents()
    this.loop = () => {
      if (!this.running) return
      if (this.needsDraw) {
        this.draw()
        this.needsDraw = false
      }
      this.raf = requestAnimationFrame(this.loop)
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  radius(d) {
    const base = d.type === 'tag' ? 3.5 : d.type === 'unresolved' ? 3 : 4
    return (base + Math.sqrt(d.degree || 0) * 1.6) * (this.opts.nodeSize || 1)
  }

  colorFor(d) {
    const c = this.colors
    if (d.id === this.focus) return c.accent
    if (d.type === 'tag') return c.tag
    if (d.type === 'unresolved') return c.faint
    if (d.type === 'image' || d.type === 'file') return c.file
    if (this.opts.colorFolders && d.path?.includes('/')) {
      const top = d.path.split('/')[0]
      let h = 0
      for (let i = 0; i < top.length; i++) h = (h * 31 + top.charCodeAt(i)) | 0
      return c.folders[Math.abs(h) % c.folders.length]
    }
    return c.node
  }

  setOptions(opts) {
    Object.assign(this.opts, opts)
    this.sim.force('charge').strength(-(this.opts.repel || 140))
    this.sim.force('link').distance(this.opts.linkDistance || 70)
    this.sim.alpha(0.4).restart()
    this.needsDraw = true
  }

  setData({ nodes, links }, focus = null) {
    this.focus = focus
    const old = this.positions
    const prepared = nodes.map((n) => {
      const p = old.get(n.id)
      return { ...n, x: p?.x ?? (Math.random() - 0.5) * 300, y: p?.y ?? (Math.random() - 0.5) * 300, vx: 0, vy: 0 }
    })
    this.nodes = prepared
    this.nodeById = new Map(prepared.map((n) => [n.id, n]))
    this.links = links.map((l) => ({ ...l }))
    this.sim.nodes(prepared)
    this.sim.force('link').links(this.links)
    this.sim.alpha(0.9).restart()
    this.autoFit = true
    this.needsDraw = true
  }

  savePositions() {
    for (const n of this.nodes) this.positions.set(n.id, { x: n.x, y: n.y })
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // coming back from a hidden tab (or a first real layout): frame it again
    if ((!this.width || !this.height) && !this.userMoved) this.autoFit = true
    this.canvas.width = rect.width * this.dpr
    this.canvas.height = rect.height * this.dpr
    this.width = rect.width
    this.height = rect.height
    if (this.autoFit && !this.userMoved) {
      this.autoFit = false
      this.fit()
    }
    this.needsDraw = true
  }

  toWorld(cx, cy) {
    return { x: (cx - this.width / 2 - this.transform.x) / this.transform.k, y: (cy - this.height / 2 - this.transform.y) / this.transform.k }
  }

  nodeAt(cx, cy) {
    const p = this.toWorld(cx, cy)
    let best = null
    let bestDist = Infinity
    for (const n of this.nodes) {
      const dx = n.x - p.x
      const dy = n.y - p.y
      const d = dx * dx + dy * dy
      const r = this.radius(n) + 6 / this.transform.k
      if (d < r * r && d < bestDist) {
        best = n
        bestDist = d
      }
    }
    return best
  }

  setHover(node) {
    if (this.hover === node) return
    this.hover = node
    this.highlight = new Set()
    if (node) {
      this.highlight.add(node.id)
      for (const l of this.links) {
        const s = typeof l.source === 'object' ? l.source.id : l.source
        const t = typeof l.target === 'object' ? l.target.id : l.target
        if (s === node.id) this.highlight.add(t)
        if (t === node.id) this.highlight.add(s)
      }
    }
    this.canvas.style.cursor = node ? 'pointer' : 'grab'
    this.needsDraw = true
  }

  bindEvents() {
    const c = this.canvas
    let panning = false
    let last = null
    const pos = (e) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    let downAt = null // where the gesture started
    let downNode = null
    let travelled = 0 // furthest distance from the start point
    const CLICK_SLOP = 5 // px of movement still counted as a click

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse' && e.button !== 1) return
      try {
        c.setPointerCapture(e.pointerId)
      } catch {}
      const p = pos(e)
      const node = this.nodeAt(p.x, p.y)
      last = p
      downAt = p
      downNode = node
      travelled = 0
      if (node) {
        this.dragging = node
        node.fx = node.x
        node.fy = node.y
        this.sim.alphaTarget(0.3).restart()
      } else {
        panning = true
        c.style.cursor = 'grabbing'
      }
    })
    c.addEventListener('pointermove', (e) => {
      const p = pos(e)
      if (downAt) travelled = Math.max(travelled, Math.hypot(p.x - downAt.x, p.y - downAt.y))
      if (this.dragging) {
        const w = this.toWorld(p.x, p.y)
        this.dragging.fx = w.x
        this.dragging.fy = w.y
        this.needsDraw = true
      } else if (panning && last) {
        this.userMoved = true
        this.transform.x += p.x - last.x
        this.transform.y += p.y - last.y
        this.needsDraw = true
      } else {
        this.setHover(this.nodeAt(p.x, p.y))
        this.opts.onHover?.(this.hover, p)
      }
      last = p
    })
    const end = () => {
      if (this.dragging) {
        this.dragging.fx = null
        this.dragging.fy = null
        this.sim.alphaTarget(0)
        this.dragging = null
      }
      panning = false
      downAt = null
      downNode = null
      c.style.cursor = this.hover ? 'pointer' : 'grab'
      this.savePositions()
    }
    c.addEventListener('pointerup', (e) => {
      const p = pos(e)
      // a click is a press and release on the same node without dragging it
      const dist = downAt ? Math.max(travelled, Math.hypot(p.x - downAt.x, p.y - downAt.y)) : Infinity
      const node = this.nodeAt(p.x, p.y)
      if (node && node === downNode && dist <= CLICK_SLOP) this.opts.onClick?.(node, e)
      end()
    })
    c.addEventListener('pointercancel', () => end())
    c.addEventListener('pointerleave', () => {
      end()
      this.setHover(null)
      this.opts.onHover?.(null)
    })
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const p = pos(e)
        this.userMoved = true
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))
        const k = Math.max(0.12, Math.min(6, this.transform.k * factor))
        const wx = p.x - this.width / 2
        const wy = p.y - this.height / 2
        this.transform.x = wx - ((wx - this.transform.x) * k) / this.transform.k
        this.transform.y = wy - ((wy - this.transform.y) * k) / this.transform.k
        this.transform.k = k
        this.needsDraw = true
      },
      { passive: false },
    )
    c.addEventListener('dblclick', () => this.fit())
  }

  fit() {
    if (!this.nodes.length) return
    // A tab that is laid out while hidden has no size yet; fitting against it
    // parks the whole graph in the top-left corner. Wait for a real size.
    if (!this.width || !this.height) {
      this.autoFit = true
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x)
      maxX = Math.max(maxX, n.x)
      minY = Math.min(minY, n.y)
      maxY = Math.max(maxY, n.y)
    }
    const w = Math.max(maxX - minX, 50)
    const h = Math.max(maxY - minY, 50)
    const k = Math.min(this.width / (w + 110), this.height / (h + 110), 1.5)
    this.transform.k = k
    this.transform.x = -((minX + maxX) / 2) * k
    this.transform.y = -((minY + maxY) / 2) * k
    this.needsDraw = true
  }

  refreshColors() {
    this.colors = readColors()
    this.needsDraw = true
  }

  draw() {
    const { ctx } = this
    const { x, y, k } = this.transform
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.translate(this.width / 2 + x, this.height / 2 + y)
    ctx.scale(k, k)

    const dim = this.hover ? 0.15 : 1
    // links
    ctx.lineWidth = 1 / k
    for (const l of this.links) {
      const s = l.source
      const t = l.target
      if (!s.x && s.x !== 0) continue
      const active = this.hover && (this.highlight.has(s.id) && this.highlight.has(t.id))
      ctx.globalAlpha = this.hover ? (active ? 0.9 : 0.06) : 0.55
      ctx.strokeStyle = active ? this.colors.accent : this.colors.link
      ctx.lineWidth = (active ? 1.6 : 1) / k
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(t.x, t.y)
      ctx.stroke()
    }

    // nodes
    for (const n of this.nodes) {
      const active = !this.hover || this.highlight.has(n.id)
      ctx.globalAlpha = active ? 1 : dim
      ctx.beginPath()
      ctx.arc(n.x, n.y, this.radius(n), 0, Math.PI * 2)
      ctx.fillStyle = this.colorFor(n)
      ctx.fill()
      // a ring in the page colour keeps links from crowding the dot
      ctx.lineWidth = 1.5 / k
      ctx.strokeStyle = this.colors.bg
      ctx.stroke()
      if (n.id === this.focus) {
        ctx.lineWidth = 2 / k
        ctx.strokeStyle = this.colors.accent
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        ctx.arc(n.x, n.y, this.radius(n) + 3 / k, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // labels
    const labelZoom = this.opts.labels ?? 1
    // A small graph is legible with every name on screen; only crowded ones
    // need to wait for zoom before they show.
    const showAll = this.nodes.length <= 60 || k > 0.85 / labelZoom
    // world units, so the name stays ~11.5px on screen at any zoom
    ctx.font = `${11.5 / k}px Inter Variable, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = this.colors.bg
    ctx.lineWidth = 3 / k
    for (const n of this.nodes) {
      const isHot = this.hover && this.highlight.has(n.id)
      if (!showAll && !isHot && n.id !== this.focus) continue
      ctx.globalAlpha = isHot || !this.hover ? 1 : 0.15
      const label = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label
      const ly = n.y + this.radius(n) + 3 / k
      // halo first, so a name crossing a link still reads
      ctx.strokeText(label, n.x, ly)
      ctx.fillStyle = isHot ? this.colors.text : this.colors.text2
      ctx.fillText(label, n.x, ly)
    }
    ctx.restore()
  }

  destroy() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.sim.stop()
    this.resizeObserver.disconnect()
  }
}

// Folder hues are spun off the palette's own accent rather than a fixed list,
// so the graph belongs to whichever theme is on instead of fighting it.
function hueOf(css) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim())
  let r, g, b
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
    r = parseInt(h.slice(0, 2), 16) / 255
    g = parseInt(h.slice(2, 4), 16) / 255
    b = parseInt(h.slice(4, 6), 16) / 255
  } else {
    const n = css.match(/[\d.]+/g)
    if (!n || n.length < 3) return 258
    r = +n[0] / 255
    g = +n[1] / 255
    b = +n[2] / 255
  }
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 258
  const d = max - min
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60) % 360
}

const HUE_STEPS = [0, 42, 84, 126, 170, 208, 246, 288, 320, 350]

function readColors() {
  const s = getComputedStyle(document.documentElement)
  const v = (n, f) => s.getPropertyValue(n).trim() || f
  const accent = v('--accent', '#8b7cf6')
  const dark = document.documentElement.dataset.theme !== 'light'
  const base = hueOf(accent)
  const sat = dark ? 42 : 48
  const light = dark ? 62 : 44
  return {
    accent,
    bg: v('--bg', dark ? '#161513' : '#fff'),
    node: v('--graph-node', '#9d9daa'),
    link: v('--graph-link', 'rgba(150,150,160,.25)'),
    text: v('--text', '#eee'),
    text2: v('--text-3', '#888'),
    tag: `hsl(${(base + 96) % 360} ${sat - 4}% ${light}%)`,
    file: `hsl(${(base + 200) % 360} ${sat - 10}% ${light}%)`,
    faint: v('--text-faint', '#555'),
    folders: HUE_STEPS.map((d) => `hsl(${(base + d) % 360} ${sat}% ${light}%)`),
  }
}
