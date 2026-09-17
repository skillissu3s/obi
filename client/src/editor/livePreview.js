import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view'
import { StateField, StateEffect, Facet } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { renderMarkdown, renderInline, fetchNote, extractSection, loadKatex, renderMermaid } from '../lib/render.js'
import { IMAGE_EXT, AUDIO_EXT, VIDEO_EXT, extname, basename, stripExt } from '@shared/paths.js'

export const editorCtx = Facet.define({ combine: (v) => v[0] || {} })
export const refreshEffect = StateEffect.define()

const hide = Decoration.replace({})
const lineCache = new Map()
const lineDeco = (cls) => {
  let d = lineCache.get(cls)
  if (!d) lineCache.set(cls, (d = Decoration.line({ class: cls })))
  return d
}

// ---------------- widgets ----------------

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super()
    this.checked = checked
  }
  eq(o) {
    return o.checked === this.checked
  }
  toDOM(view) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-lp-checkbox'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.tabIndex = -1
    input.addEventListener('mousedown', (e) => e.preventDefault())
    input.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (view.state.readOnly) return
      const pos = view.posAtDOM(wrap)
      toggleTaskAt(view, pos)
    })
    wrap.appendChild(input)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

export function toggleTaskAt(view, pos) {
  const line = view.state.doc.lineAt(pos)
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX/\-])(\])/.exec(line.text)
  if (!m) return false
  const at = line.from + m[1].length
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } })
  return true
}

class TextWidget extends WidgetType {
  constructor(text, cls) {
    super()
    this.text = text
    this.cls = cls
  }
  eq(o) {
    return o.text === this.text && o.cls === this.cls
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.cls
    span.textContent = this.text
    return span
  }
  ignoreEvent() {
    return false
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-lp-hr'
    return span
  }
}

class CalloutIconWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-lp-callout-icon'
    return span
  }
}

class ImageWidget extends WidgetType {
  constructor(src, alt, width, height) {
    super()
    this.src = src
    this.alt = alt
    this.width = width
    this.height = height
  }
  eq(o) {
    return o.src === this.src && o.width === this.width && o.alt === this.alt
  }
  toDOM(view) {
    if (!this.src) {
      const span = document.createElement('span')
      span.className = 'cm-lp-image-missing'
      span.textContent = `🖼 ${this.alt || 'missing image'}`
      return span
    }
    const img = document.createElement('img')
    img.className = 'cm-lp-image'
    img.src = this.src
    img.alt = this.alt || ''
    if (this.width) img.style.width = `${this.width}px`
    if (this.height) img.style.height = `${this.height}px`
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => {
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'cm-lp-image-missing', textContent: `🖼 ${this.alt || basename(this.src)}` }))
    })
    return img
  }
  ignoreEvent() {
    return false
  }
}

class MediaWidget extends WidgetType {
  constructor(src, kind) {
    super()
    this.src = src
    this.kind = kind
  }
  eq(o) {
    return o.src === this.src
  }
  toDOM() {
    const el = document.createElement(this.kind)
    el.src = this.src
    el.controls = true
    el.className = `cm-lp-${this.kind}`
    el.style.maxWidth = '100%'
    if (this.kind === 'video') el.style.borderRadius = '8px'
    return el
  }
  ignoreEvent() {
    return false
  }
}

class EmbedNoteWidget extends WidgetType {
  constructor(ws, path, subpath, label) {
    super()
    this.ws = ws
    this.path = path
    this.subpath = subpath
    this.label = label
  }
  eq(o) {
    return o.path === this.path && o.subpath === this.subpath
  }
  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-embed'
    const title = document.createElement('div')
    title.className = 'embed-note-title'
    title.textContent = this.label
    title.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      view.state.facet(editorCtx).openPath?.(this.path, { newTab: e.metaKey || e.ctrlKey })
    })
    const body = document.createElement('div')
    body.className = 'markdown'
    body.textContent = '…'
    wrap.append(title, body)
    if (this.path) {
      fetchNote(this.ws, this.path)
        .then((content) => {
          const { html } = renderMarkdown(extractSection(content, this.subpath), { ws: this.ws, path: this.path })
          body.innerHTML = html
          import('../lib/render.js').then((m) => m.enhanceRendered(body))
          view.requestMeasure()
        })
        .catch(() => {
          body.textContent = 'Could not load note'
        })
    } else {
      body.textContent = 'Note not found'
    }
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

// A whiteboard embedded with ![[name.board]] — live preview, editable in place.
class BoardEmbedWidget extends WidgetType {
  constructor(ws, path, label, height, missing) {
    super()
    this.ws = ws
    this.path = path
    this.label = label
    this.height = height
    this.missing = missing
  }
  eq(o) {
    return o.ws === this.ws && o.path === this.path && o.label === this.label && o.height === this.height && o.missing === this.missing
  }
  get estimatedHeight() {
    return Math.min(this.height, 360)
  }
  toDOM(view) {
    const dom = document.createElement('div')
    dom.className = 'cm-board-embed'
    if (this.missing) {
      dom.className += ' cm-lp-image-missing'
      dom.textContent = `🖊 ${this.label} (whiteboard not found)`
      return dom
    }
    let cancelled = false
    import('../canvas/BoardEmbed.jsx').then(({ mountBoardEmbed }) => {
      if (cancelled) return
      dom._unmount = mountBoardEmbed(dom, {
        ws: this.ws,
        path: this.path,
        label: this.label,
        height: this.height,
        onExit: () => view.focus(),
      })
      requestAnimationFrame(() => view.requestMeasure())
    })
    dom._cancel = () => {
      cancelled = true
    }
    // resizes (preview ↔ editor) change the line height
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => view.requestMeasure())
      ro.observe(dom)
      dom._ro = ro
    }
    return dom
  }
  destroy(dom) {
    dom._cancel?.()
    dom._unmount?.()
    dom._ro?.disconnect()
  }
  ignoreEvent() {
    return true
  }
}

class TableWidget extends WidgetType {
  constructor(text, ws, path) {
    super()
    this.text = text
    this.ws = ws
    this.path = path
  }
  eq(o) {
    return o.text === this.text
  }
  toDOM(view) {
    const div = document.createElement('div')
    div.className = 'cm-lp-table markdown'
    div.innerHTML = renderMarkdown(this.text, { ws: this.ws, path: this.path }).html
    div.addEventListener('mousedown', (e) => {
      if (e.target.closest('a')) return
      const pos = view.posAtDOM(div)
      e.preventDefault()
      view.dispatch({ selection: { anchor: pos } })
      view.focus()
    })
    return div
  }
  ignoreEvent() {
    return false
  }
}

class MathWidget extends WidgetType {
  constructor(tex) {
    super()
    this.tex = tex
  }
  eq(o) {
    return o.tex === this.tex
  }
  toDOM(view) {
    const div = document.createElement('div')
    div.className = 'cm-lp-math'
    div.textContent = this.tex
    loadKatex()
      .then((katex) => {
        katex.render(this.tex, div, { displayMode: true, throwOnError: false })
        view.requestMeasure()
      })
      .catch(() => {})
    return div
  }
  ignoreEvent() {
    return false
  }
}

class InlineMathWidget extends WidgetType {
  constructor(tex) {
    super()
    this.tex = tex
  }
  eq(o) {
    return o.tex === this.tex
  }
  toDOM(view) {
    const span = document.createElement('span')
    span.className = 'cm-lp-math-inline'
    span.textContent = this.tex
    loadKatex()
      .then((katex) => {
        katex.render(this.tex, span, { displayMode: false, throwOnError: false })
        view.requestMeasure()
      })
      .catch(() => {})
    return span
  }
  ignoreEvent() {
    return false
  }
}

class MermaidWidget extends WidgetType {
  constructor(code) {
    super()
    this.code = code
  }
  eq(o) {
    return o.code === this.code
  }
  toDOM(view) {
    const div = document.createElement('div')
    div.className = 'cm-lp-mermaid'
    div.textContent = '◌ rendering diagram…'
    const draw = () =>
      renderMermaid(this.code)
        .then((svg) => {
          div.innerHTML = svg
          view.requestMeasure()
        })
        .catch((e) => {
          div.textContent = `Mermaid error: ${String(e.message || e).split('\n')[0]}`
        })
    draw()
    div._redraw = draw
    window.addEventListener('obi:theme', draw)
    return div
  }
  destroy(dom) {
    if (dom?._redraw) window.removeEventListener('obi:theme', dom._redraw)
  }
  ignoreEvent() {
    return false
  }
}

// ---------------- helpers ----------------

function splitTarget(text) {
  const h = text.search(/[#^]/)
  return { target: (h >= 0 ? text.slice(0, h) : text).trim(), subpath: h >= 0 ? text.slice(h) : '' }
}

function embedSize(alias) {
  if (!alias) return {}
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias.trim())
  return m ? { width: Number(m[1]), height: m[2] ? Number(m[2]) : undefined } : {}
}

export function boardEmbedFor(ctx, raw) {
  const { target } = splitTarget(raw.split('|')[0])
  if (extname(target) !== 'board') return null
  const alias = raw.includes('|') ? raw.slice(raw.indexOf('|') + 1).trim() : ''
  const resolved = ctx.resolve?.(target) || null
  const height = /^\d+$/.test(alias) ? Math.max(200, Math.min(1400, Number(alias))) : 440
  const label = alias && !/^\d+$/.test(alias) ? alias : stripExt(basename(target))
  return new BoardEmbedWidget(ctx.ws, resolved, label, height, !resolved)
}

function embedWidget(ctx, raw) {
  const { target, subpath } = splitTarget(raw.split('|')[0])
  const alias = raw.includes('|') ? raw.slice(raw.indexOf('|') + 1) : null
  const ext = extname(target)
  const resolved = ctx.resolve?.(target) || null
  if (IMAGE_EXT.has(ext)) {
    const { width, height } = embedSize(alias)
    return new ImageWidget(resolved ? ctx.fileUrl(resolved) : null, alias && !width ? alias : basename(target), width, height)
  }
  if (AUDIO_EXT.has(ext) && resolved) return new MediaWidget(ctx.fileUrl(resolved), 'audio')
  if (VIDEO_EXT.has(ext) && resolved) return new MediaWidget(ctx.fileUrl(resolved), 'video')
  return new EmbedNoteWidget(ctx.ws, resolved, subpath, (alias || stripExt(basename(target))) + (subpath ? ` › ${subpath.replace(/^[#^]/, '')}` : ''))
}

// ---------------- inline/line decorations ----------------

function buildDecorations(view) {
  const { state } = view
  const ctx = state.facet(editorCtx)
  const doc = state.doc
  const focused = view.hasFocus
  const ranges = state.selection.ranges
  const decos = []
  const seen = new Set()
  const activeLines = new Set()
  if (focused) {
    for (const r of ranges) {
      const a = doc.lineAt(r.from).number
      const b = r.empty ? a : doc.lineAt(r.to).number
      for (let i = a; i <= b; i++) activeLines.add(i)
    }
  }
  const touches = (from, to) => focused && ranges.some((r) => r.from <= to && r.to >= from)
  const lineActive = (pos) => activeLines.has(doc.lineAt(pos).number)
  const add = (deco, from, to) => {
    const key = `${from}:${to}:${deco.spec.class || deco.spec.widget?.constructor.name || 'r'}`
    if (seen.has(key)) return
    seen.add(key)
    decos.push(deco.range(from, to))
  }
  const addLine = (pos, cls) => {
    const line = doc.lineAt(pos)
    const key = `L${line.from}:${cls}`
    if (seen.has(key)) return
    seen.add(key)
    decos.push(lineDeco(cls).range(line.from))
  }
  const hideRange = (from, to) => {
    if (to > from) add(hide, from, to)
  }
  const calloutTitles = new Set()

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        if (name.startsWith('ATXHeading')) {
          addLine(node.from, `cm-lp-h${name.slice(-1)}`)
          return
        }
        switch (name) {
          case 'HeaderMark': {
            const p = node.node.parent
            if (!p || !p.name.startsWith('ATXHeading')) return
            if (lineActive(node.from)) return
            const line = doc.lineAt(node.from)
            if (node.from === line.from + (line.text.length - line.text.trimStart().length)) {
              let end = node.to
              if (doc.sliceString(end, end + 1) === ' ') end++
              if (end <= line.to) hideRange(node.from, end)
            } else {
              let start = node.from
              if (doc.sliceString(start - 1, start) === ' ') start--
              hideRange(start, node.to)
            }
            return
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'HighlightMark':
          case 'SuperscriptMark':
          case 'SubscriptMark': {
            const p = node.node.parent
            if (p && !touches(p.from, p.to)) hideRange(node.from, node.to)
            return
          }
          case 'CodeMark': {
            const p = node.node.parent
            if (p?.name === 'InlineCode' && !touches(p.from, p.to)) hideRange(node.from, node.to)
            return
          }
          case 'InlineCode':
            add(Decoration.mark({ class: 'cm-inline-code' }), node.from, node.to)
            return
          case 'Link': {
            const n = node.node
            const marks = n.getChildren('LinkMark')
            if (marks.length < 2 || touches(n.from, n.to)) return
            const textFrom = marks[0].to
            const textTo = marks[1].from
            const url = n.getChild('URL')
            const href = url ? doc.sliceString(url.from, url.to) : ''
            if (textTo > textFrom) {
              hideRange(marks[0].from, marks[0].to)
              add(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-mdlink': href } }), textFrom, textTo)
              hideRange(marks[1].from, n.to)
            }
            return
          }
          case 'Image': {
            if (touches(node.from, node.to)) return
            const n = node.node
            const url = n.getChild('URL')
            if (!url) return
            let href = doc.sliceString(url.from, url.to)
            const marks = n.getChildren('LinkMark')
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
            try {
              href = decodeURIComponent(href)
            } catch {}
            const external = /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)
            const resolved = external ? href : ctx.resolve?.(href)
            const src = external ? href : resolved ? ctx.fileUrl(resolved) : null
            add(Decoration.replace({ widget: new ImageWidget(src, alt) }), node.from, node.to)
            return false
          }
          case 'Autolink': {
            if (touches(node.from, node.to)) return
            const marks = node.node.getChildren('LinkMark')
            if (marks.length === 2) {
              hideRange(marks[0].from, marks[0].to)
              hideRange(marks[1].from, marks[1].to)
              add(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-mdlink': doc.sliceString(marks[0].to, marks[1].from) } }), marks[0].to, marks[1].from)
            }
            return false
          }
          case 'URL': {
            const p = node.node.parent
            if (p && (p.name === 'Link' || p.name === 'Image' || p.name === 'Autolink')) return
            add(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-mdlink': doc.sliceString(node.from, node.to) } }), node.from, node.to)
            return
          }
          case 'WikiLink': {
            const n = node.node
            const target = n.getChild('WikiTarget')
            const alias = n.getChild('WikiAlias')
            if (!target) return
            const raw = doc.sliceString(target.from, target.to)
            const { target: tgt } = splitTarget(raw)
            const resolved = tgt ? ctx.resolve?.(tgt) : ctx.path
            const attrs = { 'data-wikilink': doc.sliceString(target.from, target.to) }
            const cls = `cm-lp-wikilink${resolved ? '' : ' is-unresolved'}`
            if (touches(n.from, n.to)) {
              add(Decoration.mark({ class: 'cm-wikilink', attributes: attrs }), n.from, n.to)
              return false
            }
            const marks = n.getChildren('WikiMark')
            if (marks.length === 2) {
              hideRange(marks[0].from, marks[0].to)
              hideRange(marks[1].from, marks[1].to)
            }
            if (alias) {
              hideRange(target.from, alias.from)
              if (alias.to > alias.from) add(Decoration.mark({ class: cls, attributes: attrs }), alias.from, alias.to)
            } else {
              add(Decoration.mark({ class: cls, attributes: attrs }), target.from, target.to)
            }
            return false
          }
          case 'WikiEmbed': {
            const n = node.node
            const target = n.getChild('WikiTarget')
            if (!target) return false
            if (touches(n.from, n.to)) {
              add(Decoration.mark({ class: 'cm-wikilink' }), n.from, n.to)
              return false
            }
            const raw = doc.sliceString(target.from, n.getChild('WikiAlias') ? n.getChild('WikiAlias').to : target.to)
            // whiteboards on their own line are drawn as blocks by `blockWidgets`
            if (extname(splitTarget(raw.split('|')[0]).target) === 'board' && soloEmbedLine(doc, n.from, n.to)) return false
            add(Decoration.replace({ widget: embedWidget(ctx, raw) }), n.from, n.to)
            return false
          }
          case 'Hashtag': {
            add(Decoration.mark({ class: 'cm-lp-tag', attributes: { 'data-tag': doc.sliceString(node.from + 1, node.to) } }), node.from, node.to)
            return
          }
          case 'TaskMarker': {
            const task = node.node.parent
            const item = task?.parent
            const listMark = item?.getChild('ListMark')
            const start = listMark ? listMark.from : node.from
            const checked = /[xX]/.test(doc.sliceString(node.from + 1, node.to - 1))
            if (checked) addLine(node.from, 'cm-lp-task-done')
            if (!touches(start, node.to)) add(Decoration.replace({ widget: new CheckboxWidget(checked) }), start, node.to)
            return
          }
          case 'ListMark': {
            const item = node.node.parent
            if (item?.parent?.name !== 'BulletList') return
            if (item.getChild('Task')) return
            if (!touches(node.from, node.to + 1)) add(Decoration.replace({ widget: new TextWidget('•', 'cm-lp-bullet') }), node.from, node.to)
            return
          }
          case 'Blockquote': {
            const first = doc.lineAt(node.from)
            const last = doc.lineAt(Math.min(node.to, doc.length))
            const m = /^\s*>+\s*\[!([\w-]+)\]([+-]?)/.exec(first.text)
            const start = Math.max(first.number, doc.lineAt(Math.max(from - 1, 0)).number)
            const end = Math.min(last.number, doc.lineAt(Math.min(to, doc.length)).number)
            for (let l = start; l <= end; l++) {
              const line = doc.line(l)
              let cls = m ? `cm-lp-callout cm-callout-${m[1].toLowerCase()}` : 'cm-lp-quote'
              if (m && l === first.number) cls += ' cm-lp-callout-title'
              if (m && l === last.number) cls += ' cm-lp-callout-last'
              addLine(line.from, cls)
            }
            if (m && !lineActive(first.from)) {
              const idx = first.text.indexOf('[!')
              let endIdx = first.text.indexOf(']', idx) + 1
              if (m[2]) endIdx++
              if (first.text[endIdx] === ' ') endIdx++
              calloutTitles.add(first.from)
              add(Decoration.replace({ widget: new CalloutIconWidget() }), first.from, first.from + endIdx)
            }
            return
          }
          case 'QuoteMark': {
            const line = doc.lineAt(node.from)
            if (calloutTitles.has(line.from) || lineActive(node.from)) return
            let end = node.to
            if (doc.sliceString(end, end + 1) === ' ') end++
            hideRange(node.from, Math.min(end, line.to))
            return
          }
          case 'HorizontalRule': {
            if (!lineActive(node.from)) add(Decoration.replace({ widget: new HrWidget() }), node.from, node.to)
            return
          }
          case 'FencedCode': {
            const first = doc.lineAt(node.from)
            const last = doc.lineAt(Math.min(node.to, doc.length))
            const start = Math.max(first.number, doc.lineAt(Math.max(from - 1, 0)).number)
            const end = Math.min(last.number, doc.lineAt(Math.min(to, doc.length)).number)
            for (let l = start; l <= end; l++) {
              let cls = 'cm-lp-codeblock'
              if (l === first.number) cls += ' cm-lp-codeblock-begin'
              if (l === last.number) cls += ' cm-lp-codeblock-end'
              addLine(doc.line(l).from, cls)
            }
            for (const cm of node.node.getChildren('CodeMark')) add(Decoration.mark({ class: 'cm-lp-fence' }), cm.from, cm.to)
            const info = node.node.getChild('CodeInfo')
            if (info) add(Decoration.mark({ class: 'cm-lp-fence' }), info.from, info.to)
            return
          }
          case 'Frontmatter': {
            const first = doc.lineAt(node.from)
            const last = doc.lineAt(Math.min(node.to, doc.length))
            for (let l = first.number; l <= last.number; l++) {
              let cls = 'cm-lp-frontmatter'
              if (l === first.number) cls += ' cm-lp-frontmatter-begin'
              if (l === last.number) cls += ' cm-lp-frontmatter-end'
              addLine(doc.line(l).from, cls)
            }
            return false
          }
          case 'Table':
          case 'CommentBlock':
          case 'HTMLBlock':
            return false
        }
      },
    })
  }
  // inline math: $x^2$ (skipped inside code/frontmatter)
  const tree = syntaxTree(state)
  const MATH = /(?<![$\\])\$([^$\n]{1,200}?)\$(?!\$)/g
  for (const { from, to } of view.visibleRanges) {
    const firstLine = doc.lineAt(from).number
    const lastLine = doc.lineAt(to).number
    for (let n = firstLine; n <= lastLine; n++) {
      const line = doc.line(n)
      if (!line.text.includes('$')) continue
      MATH.lastIndex = 0
      let m
      while ((m = MATH.exec(line.text))) {
        const start = line.from + m.index
        const end = start + m[0].length
        if (touches(start, end)) continue
        if (!m[1].trim() || /^\s|\s$/.test(m[1])) continue
        const node = tree.resolveInner(start + 1, 1)
        let skip = false
        for (let p = node; p; p = p.parent) {
          if (['FencedCode', 'CodeText', 'InlineCode', 'Frontmatter', 'CodeBlock', 'HTMLBlock', 'URL', 'Link', 'Image', 'WikiLink', 'WikiEmbed', 'Table'].includes(p.name)) {
            skip = true
            break
          }
        }
        if (skip) continue
        add(Decoration.replace({ widget: new InlineMathWidget(m[1].trim()) }), start, end)
      }
    }
  }

  return Decoration.set(decos, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view)
    }
    update(update) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect))) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// ---------------- block widgets (tables, math, mermaid, whiteboards) ----------------

function soloEmbedLine(doc, from, to) {
  const line = doc.lineAt(from)
  return to <= line.to && !line.text.slice(0, from - line.from).trim() && !line.text.slice(to - line.from).trim()
}

function buildBlocks(state) {
  const ctx = state.facet(editorCtx)
  const doc = state.doc
  const ranges = state.selection.ranges
  const touches = (from, to) => ranges.some((r) => r.from <= to && r.to >= from)
  const decos = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Table') {
        if (!touches(node.from, node.to)) {
          const f = doc.lineAt(node.from).from
          const t = doc.lineAt(Math.min(node.to, doc.length)).to
          decos.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(f, t), ctx.ws, ctx.path), block: true }).range(f, t))
        }
        return false
      }
      if (node.name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : ''
        if (lang === 'mermaid' && !touches(node.from, node.to)) {
          const text = node.node.getChild('CodeText')
          const code = text ? doc.sliceString(text.from, text.to) : ''
          const f = doc.lineAt(node.from).from
          const t = doc.lineAt(Math.min(node.to, doc.length)).to
          if (code.trim()) decos.push(Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(f, t))
        }
        return false
      }
      if (node.name === 'WikiEmbed') {
        const n = node.node
        const target = n.getChild('WikiTarget')
        if (target && soloEmbedLine(doc, n.from, n.to) && !touches(n.from, n.to)) {
          const raw = doc.sliceString(target.from, n.getChild('WikiAlias') ? n.getChild('WikiAlias').to : target.to)
          const widget = boardEmbedFor(ctx, raw)
          if (widget) {
            const line = doc.lineAt(n.from)
            decos.push(Decoration.replace({ widget, block: true }).range(line.from, line.to))
          }
        }
        return false
      }
      if (node.name === 'Paragraph') {
        if (doc.sliceString(node.from, node.from + 2) === '$$') {
          const text = doc.sliceString(node.from, node.to)
          const m = /^\$\$([\s\S]*?)\$\$\s*$/.exec(text)
          if (m && m[1].trim() && !touches(node.from, node.to)) {
            const f = doc.lineAt(node.from).from
            const t = doc.lineAt(Math.min(node.to, doc.length)).to
            decos.push(Decoration.replace({ widget: new MathWidget(m[1].trim()), block: true }).range(f, t))
          }
          return false
        }
        // only paragraphs holding an embed need a look inside (for whiteboards)
        return doc.sliceString(node.from, node.to).includes('.board') ? undefined : false
      }
      if (node.name === 'Frontmatter' || node.name === 'HTMLBlock') return false
    },
  })
  return Decoration.set(decos, true)
}

export const blockWidgets = StateField.define({
  create(state) {
    return buildBlocks(state)
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshEffect)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return buildBlocks(tr.state)
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ---------------- interactions ----------------

export const linkHandlers = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 && e.button !== 1) return false
    const ctx = view.state.facet(editorCtx)
    const el = e.target
    if (!(el instanceof HTMLElement)) return false
    const newTab = e.metaKey || e.ctrlKey || e.button === 1
    const wl = el.closest('.cm-lp-wikilink')
    if (wl) {
      e.preventDefault()
      ctx.openPath?.(null, { newTab, link: wl.dataset.wikilink })
      return true
    }
    const src = el.closest('.cm-wikilink')
    if (src && newTab) {
      e.preventDefault()
      const text = src.textContent.replace(/^!?\[\[|\]\]$/g, '')
      ctx.openPath?.(null, { newTab: true, link: text })
      return true
    }
    const link = el.closest('.cm-lp-link')
    if (link) {
      const href = link.dataset.mdlink || ''
      e.preventDefault()
      if (/^[a-z][a-z0-9+.-]*:|^www\./i.test(href)) window.open(/^www\./i.test(href) ? `https://${href}` : href, '_blank', 'noopener')
      else ctx.openPath?.(null, { newTab, link: href, md: true })
      return true
    }
    const tag = el.closest('.cm-lp-tag')
    if (tag && newTab) {
      e.preventDefault()
      ctx.openTag?.(tag.dataset.tag)
      return true
    }
    return false
  },
  click(e, view) {
    const el = e.target
    if (el instanceof HTMLElement && el.closest('.cm-lp-wikilink, .cm-lp-link')) {
      e.preventDefault()
      return true
    }
    return false
  },
})
