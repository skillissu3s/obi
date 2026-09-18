import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileText, Globe, ExternalLink, Link2, ImageOff } from 'lucide-react'
import { drawables, val, colorCss, stickyCss, FONTS, fontScale, lineHeight, DEFAULTS } from '@shared/boardsvg.js'
import { midPoint } from '@shared/boardgeom.js'
import { measureText } from './layout.js'
import { renderMarkdown } from '../lib/render.js'

function Paths({ list }) {
  return list.map((p, i) => (
    <path
      key={i}
      d={p.d}
      style={{
        fill: p.fill || 'none',
        stroke: p.stroke || 'none',
        strokeWidth: p.sw,
        strokeDasharray: p.dash || undefined,
        strokeLinecap: p.cap || (p.dash ? 'round' : undefined),
        strokeLinejoin: p.join,
        opacity: p.opacity,
      }}
    />
  ))
}

const shapeKey = (el) => [el.type, el.w, el.h, el.stroke, el.fill, el.fillStyle, el.sw, el.dash, el.rough, el.round, el.seed, el.curve, el.tool, el.heads?.join()].join('|')

export function textStyle(el, defaults = {}) {
  const font = el.font ?? defaults.font ?? 'hand'
  const fs = el.fs ?? defaults.fs ?? 20
  return {
    // a markdown block follows the editor font from Settings, since it is
    // writing rather than lettering on a drawing
    fontFamily: el.md ? 'var(--font-editor)' : FONTS[font] || FONTS.sans,
    fontSize: fs * fontScale(font),
    lineHeight: lineHeight(font),
    textAlign: el.align ?? defaults.align ?? 'center',
  }
}

const place = (el, extra = {}) => ({
  transform: `translate(${el.x}px, ${el.y}px)`,
  opacity: el.opacity != null && el.opacity !== 100 ? el.opacity / 100 : undefined,
  ...extra,
})

// [[wiki links]] inside sticky notes and text are clickable
function RichText({ text, ctx }) {
  const parts = useMemo(() => {
    const out = []
    const re = /\[\[([^\]\n]+?)\]\]/g
    let last = 0
    let m
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index))
      out.push({ link: m[1] })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }, [text])
  return parts.map((p, i) =>
    typeof p === 'string' ? (
      p
    ) : (
      <span
        key={i}
        className="cv-wikilink"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.openLink?.(p.link, e)
        }}
      >
        {p.link.split('|').pop()}
      </span>
    ),
  )
}

function EditText({ el, ctx, kind, style, className = '' }) {
  const ref = useRef(null)
  const initial = kind === 'name' ? el.name || 'Frame' : el.text || ''
  useLayoutEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus({ preventScroll: true })
    t.select?.()
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const fit = () => {
    const t = ref.current
    if (!t || kind === 'name' || kind === 'text') return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter') || (kind === 'name' && e.key === 'Enter')) {
      e.preventDefault()
      e.stopPropagation()
      ctx.controller.commitEditing(e.currentTarget.value)
      ctx.focusCanvas?.()
      return
    }
    e.stopPropagation()
  }
  const common = {
    ref,
    defaultValue: initial,
    spellCheck: kind !== 'name',
    onKeyDown,
    onKeyUp: (e) => e.stopPropagation(),
    onPointerDown: (e) => e.stopPropagation(),
    onPaste: (e) => e.stopPropagation(),
    onCopy: (e) => e.stopPropagation(),
    onCut: (e) => e.stopPropagation(),
    onInput: (e) => {
      ctx.controller.setEditingValue(e.currentTarget.value)
      fit()
    },
    onBlur: (e) => ctx.controller.commitEditing(e.currentTarget.value),
  }
  if (kind === 'name') return <input {...common} className="cv-edit-frame" />
  return <textarea {...common} className={`cv-edit ${className}`} style={style} rows={1} />
}

function ShapeEl({ el, editing, ctx }) {
  const key = shapeKey(el)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paths = useMemo(() => drawables(el), [key])
  const ts = textStyle(el)
  return (
    <div className="cv-el" style={place(el, { width: el.w, height: el.h, color: colorCss(el.stroke) })}>
      <svg>
        <Paths list={paths} />
      </svg>
      {editing ? (
        <div className="cv-label">
          <EditText el={el} ctx={ctx} kind="label" style={{ ...ts, position: 'static', width: '100%' }} />
        </div>
      ) : el.text ? (
        // a hatched or cross-hatched fill runs straight through the letters,
        // so the text sits on its own patch of the page colour
        <div className={`cv-label cv-text ${el.fill && (el.fillStyle ?? DEFAULTS.fillStyle) !== 'solid' ? 'on-pattern' : ''}`} style={ts}>
          <div>
            <RichText text={el.text} ctx={ctx} />
          </div>
        </div>
      ) : null}
      {el.link && <LinkMark el={el} ctx={ctx} />}
    </div>
  )
}

function LinearEl({ el, editing, ctx }) {
  const pts = el._pts
  const sig = pts ? pts.map((p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`).join(' ') : el.points.map((p) => p.join(',')).join(' ')
  const key = shapeKey(el) + '|' + sig
  const paths = useMemo(
    () => drawables(el, pts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, pts ? el.x : 0, pts ? el.y : 0],
  )
  const local = (pts || el.points.map((p) => [el.x + p[0], el.y + p[1]])).map((p) => [p[0] - el.x, p[1] - el.y])
  const mid = el.text || editing ? midPoint(local) : null
  const ts = { ...textStyle(el), color: colorCss(el.stroke) }
  return (
    <div className="cv-el" style={place(el)}>
      <svg>
        <Paths list={paths} />
      </svg>
      {mid && editing && (
        <EditText
          el={el}
          ctx={ctx}
          kind="label"
          style={{ ...ts, left: mid[0] - 110, top: mid[1] - ts.fontSize * 0.75, width: 220, background: 'var(--cv-bg)', borderRadius: 4 }}
        />
      )}
      {mid && !editing && (
        <div className="cv-arrow-label cv-text" style={{ ...ts, left: mid[0], top: mid[1] }}>
          {el.text}
        </div>
      )}
      {el.link && <LinkMark el={el} ctx={ctx} at={local[local.length - 1]} />}
    </div>
  )
}

function PenEl({ el }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paths = useMemo(() => drawables(el), [el.points, el.sw, el.tool, el.stroke])
  return (
    <div className="cv-el" style={place(el)}>
      <svg style={el.tool === 'marker' ? { mixBlendMode: 'normal' } : undefined}>
        <Paths list={paths} />
      </svg>
    </div>
  )
}

function TextEl({ el, editing, ctx }) {
  const ts = { ...textStyle(el, { align: 'left' }), color: colorCss(el.stroke) }
  const box = { width: el.w, minHeight: el.h, whiteSpace: el.wrap ? 'pre-wrap' : 'pre' }
  // A markdown block writes as markdown and reads as the formatting it means:
  // headings, lists, quotes, code and links, the same rules as a note.
  const markdown = el.md ? renderMarkdown(el.text || '', { ws: ctx?.ws, path: ctx?.path }).html : null
  return (
    <div className="cv-el" style={place(el)}>
      {editing ? (
        <EditText el={el} ctx={ctx} kind="text" style={{ ...ts, ...box, height: el.h, minWidth: 24 }} />
      ) : el.md ? (
        <div
          className="cv-text cv-md"
          style={{ ...ts, width: el.w, minHeight: el.h, whiteSpace: 'normal' }}
          onPointerDown={(e) => {
            // links inside the block stay clickable
            if (e.target.closest('a')) e.stopPropagation()
          }}
          dangerouslySetInnerHTML={{ __html: markdown }}
        />
      ) : (
        <div className="cv-text" style={{ ...ts, ...box }}>
          <RichText text={el.text || ''} ctx={ctx} />
        </div>
      )}
      {el.link && <LinkMark el={el} ctx={ctx} />}
    </div>
  )
}

function StickyEl({ el, editing, ctx }) {
  const ts = textStyle(el, { align: 'left', font: 'hand', fs: 20 })
  return (
    <div className="cv-el" style={place(el, { width: el.w, height: el.h })}>
      <div className="cv-sticky" style={{ background: stickyCss(el.color), ...ts }}>
        {editing ? (
          <EditText el={el} ctx={ctx} kind="sticky" style={{ ...ts, position: 'static', width: '100%', color: 'inherit' }} />
        ) : (
          <div className="cv-text">
            <RichText text={el.text || ''} ctx={ctx} />
          </div>
        )}
      </div>
      {el.link && <LinkMark el={el} ctx={ctx} />}
    </div>
  )
}

function ImageEl({ el, ctx }) {
  const target = ctx.imageUrl(el)
  // keep showing the local preview until the uploaded file has loaded
  const [url, setUrl] = useState(target)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!target || target === url) return
    if (!url) return setUrl(target)
    const img = new Image()
    img.onload = img.onerror = () => setUrl(target)
    img.src = target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  useEffect(() => setFailed(false), [url])
  return (
    <div className="cv-el" style={place(el, { width: el.w, height: el.h })}>
      <div className={`cv-image ${!url || failed ? 'loading' : ''}`}>
        {url && !failed ? (
          <img src={url} alt="" draggable={false} onError={() => setFailed(true)} />
        ) : failed ? (
          <ImageOff size={20} />
        ) : (
          <span className="spinner sm" />
        )}
      </div>
      {el.link && <LinkMark el={el} ctx={ctx} />}
    </div>
  )
}

function NoteEl({ el, ctx }) {
  const exists = ctx.noteExists(el.path)
  const [excerpt, setExcerpt] = useState('')
  useEffect(() => {
    let alive = true
    if (!exists || el.h < 70) return
    ctx
      .noteExcerpt(el.path)
      .then((t) => alive && setExcerpt(t))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [el.path, exists, el.h, ctx])
  const title = String(el.path || '').split('/').pop().replace(/\.md$/i, '')
  return (
    <div className="cv-el" style={place(el, { width: el.w, height: el.h })}>
      <div className={`cv-card ${exists ? '' : 'missing'}`}>
        <div className="cv-card-title">
          <FileText />
          <span>{title || 'Untitled'}</span>
        </div>
        <div className="cv-card-body">{exists ? excerpt : 'This note no longer exists'}</div>
      </div>
      {exists && (
        <button
          className="icon-btn sm cv-card-open"
          title="Open note"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => ctx.openNote(el.path, e)}
        >
          <ExternalLink />
        </button>
      )}
    </div>
  )
}

function LinkEl({ el, ctx }) {
  let host = el.url
  try {
    host = new URL(el.url).host
  } catch {}
  return (
    <div className="cv-el" style={place(el, { width: el.w, height: el.h })}>
      <div className="cv-card">
        <div className="cv-card-title">
          <Globe />
          <span>{el.name || host}</span>
        </div>
        <div className="cv-card-body" style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {el.url}
        </div>
      </div>
      <button className="icon-btn sm cv-card-open" title="Open link" onPointerDown={(e) => e.stopPropagation()} onClick={() => ctx.openUrl(el.url)}>
        <ExternalLink />
      </button>
    </div>
  )
}

function FrameEl({ el, editing, ctx }) {
  return (
    <div className="cv-el" style={place(el, { width: el.w, height: el.h })}>
      <div className="cv-frame" />
      <div className="cv-frame-name" style={editing ? { pointerEvents: 'auto' } : undefined}>
        {editing ? <EditText el={el} ctx={ctx} kind="name" /> : el.name || 'Frame'}
      </div>
    </div>
  )
}

function LinkMark({ el, ctx, at }) {
  return (
    <span
      className="cv-link-mark"
      style={at ? { left: at[0] + 4, top: at[1] - 24, right: 'auto' } : undefined}
      title={`Open ${el.link}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onClick={(e) => ctx.openLink(el.link, e)}
    >
      <Link2 />
    </span>
  )
}

const VIEWS = {
  rect: ShapeEl,
  ellipse: ShapeEl,
  diamond: ShapeEl,
  line: LinearEl,
  arrow: LinearEl,
  pen: PenEl,
  text: TextEl,
  sticky: StickyEl,
  image: ImageEl,
  note: NoteEl,
  link: LinkEl,
  frame: FrameEl,
}

export const ElementView = memo(function ElementView({ el, ctx, editing, erasing }) {
  const View = VIEWS[el.type]
  if (!View) return null
  const node = <View el={el} ctx={ctx} editing={editing} />
  if (!erasing) return node
  return <div style={{ opacity: 0.25 }}>{node}</div>
})

export function textBoxSize(el) {
  return measureText(el.text || '', { font: el.font ?? 'hand', fs: el.fs ?? 20, width: el.wrap ? el.w : null })
}

export { val }
