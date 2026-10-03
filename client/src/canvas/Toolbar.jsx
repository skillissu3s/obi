import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MousePointer2, Hand, Square, Circle, Diamond, MoveUpRight, Minus, Pencil, Highlighter, Type, Heading, StickyNote, ImagePlus, Link2,
  Frame, Eraser, Pointer, Lock, LockOpen, Copy, Trash2, Group, Ungroup, AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  AlignLeft, AlignCenter, AlignRight, SlidersHorizontal, ChevronsDown, Link as LinkIcon, ArrowUpToLine, ArrowDownToLine, ChevronUp,
  ChevronDown, FileText,
} from 'lucide-react'
import { STROKE_COLORS, STICKY_COLORS, colorCss, fillCss, stickyCss, DEFAULTS } from '@shared/boardsvg.js'
import { appliesTo, styleGroup } from './controller.js'
import { useController } from './CanvasLayer.jsx'
import { source } from './layout.js'

export const TOOLS = [
  { id: 'select', key: 'V', label: 'Select', icon: MousePointer2 },
  { id: 'hand', key: 'H', label: 'Pan — or hold Space / middle mouse', icon: Hand },
  'sep',
  { id: 'rect', key: 'R', label: 'Rectangle', icon: Square },
  { id: 'ellipse', key: 'O', label: 'Ellipse', icon: Circle },
  { id: 'diamond', key: 'D', label: 'Diamond', icon: Diamond },
  { id: 'arrow', key: 'A', label: 'Arrow — drag from a shape (or text) to connect', icon: MoveUpRight },
  { id: 'line', key: 'L', label: 'Line', icon: Minus },
  'sep',
  { id: 'pen', key: 'P', label: 'Draw', icon: Pencil },
  { id: 'marker', key: 'M', label: 'Highlighter', icon: Highlighter },
  { id: 'text', key: 'T', label: 'Text', icon: Type },
  { id: 'mdtext', key: 'W', label: 'Markdown block — headings, lists and links', icon: Heading },
  { id: 'sticky', key: 'N', label: 'Sticky note', icon: StickyNote },
  'sep',
  { id: 'image', key: 'I', label: 'Image', icon: ImagePlus },
  { id: 'note', key: 'K', label: 'Link a note or web page', icon: Link2 },
  { id: 'frame', key: 'F', label: 'Frame — group things on the canvas', icon: Frame },
  { id: 'eraser', key: 'E', label: 'Eraser', icon: Eraser },
  { id: 'laser', key: 'X', label: 'Laser pointer', icon: Pointer },
]

export function Toolbar({ ctl, extra, onCollapse }) {
  const state = useController(ctl)
  const readOnly = ctl.readOnly
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t, i) => {
        if (t === 'sep') return <div key={i} className="cv-sep" />
        const disabled = readOnly && !['select', 'hand', 'laser'].includes(t.id)
        return (
          <button
            key={t.id}
            className={`cv-tool ${state.tool === t.id ? 'active' : ''}`}
            title={`${t.label} (${t.key})`}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // picking the tool you already have brings its settings back
              if (state.tool === t.id) window.dispatchEvent(new CustomEvent('obi:tool-settings', { detail: ctl }))
              ctl.setTool(t.id)
            }}
          >
            <t.icon />
            <kbd>{t.key}</kbd>
          </button>
        )
      })}
      <div className="cv-sep" />
      <button
        className={`cv-tool ${state.lockTool ? 'active' : ''}`}
        title={state.lockTool ? 'Tool stays selected after drawing (Q)' : 'Keep the tool selected after drawing (Q)'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ctl.toggleToolLock()}
      >
        {state.lockTool ? <Lock /> : <LockOpen />}
      </button>
      {extra}
      {onCollapse && (
        <button className="cv-tool" title="Hide canvas tools" onMouseDown={(e) => e.preventDefault()} onClick={onCollapse}>
          <ChevronsDown />
        </button>
      )}
    </div>
  )
}

// ---------- popovers ----------

function Popover({ anchor, onClose, children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return undefined
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = ref.current.offsetWidth
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
      // Pinned by its bottom edge, just above the button it belongs to, so it
      // grows upward when its content changes (the fill pattern appears, say)
      // and never runs off the bottom; a tall panel scrolls instead.
      setPos({ left, bottom: window.innerHeight - r.top + 8, maxHeight: Math.max(160, r.top - 16) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])
  useEffect(() => {
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains(e.target)) return
      onClose()
    }
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className="cv-pop" style={pos || { left: -9999, top: -9999 }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  )
}

function PopButton({ title, label, children }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <button className={`cv-sbtn ${anchor ? 'open' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {label}
      </button>
      {anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)}>{typeof children === 'function' ? children(() => setAnchor(null)) : children}</Popover>}
    </>
  )
}

// ---------- the style panel ----------
//
// Everything a tool or a selection can be set to sits in one view: a label, and
// the choices beside it, always showing. Nothing opens on hover or needs a
// second click to reach.

// The little previews share one 24×14 box and are drawn symmetrically about
// x = 12, so each sits dead centre in its button.
const INK = { stroke: 'currentColor', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }
const Glyph = ({ children, flip }) => (
  <svg className="cv-glyph" viewBox="0 0 24 14" style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden="true">
    {children}
  </svg>
)
const lineGlyph = (w, dash) => (
  <Glyph>
    <path d="M3 7H21" {...INK} strokeWidth={w} strokeDasharray={dash} />
  </Glyph>
)
const SLOPPY_PATHS = ['M3 7H21', 'M3 8C7 5 10 9 13 7S18 6 21 7', 'M3 9C5 3 8 12 11 6S16 2 18 10 20 5 21 7']
const sloppyGlyph = (n) => (
  <Glyph>
    <path d={SLOPPY_PATHS[n]} {...INK} strokeWidth="1.8" />
  </Glyph>
)
const headGlyph = (kind, flip) => (
  <Glyph flip={flip}>
    <path d={kind === 'none' || kind === 'arrow' ? 'M3 7H21' : kind === 'bar' ? 'M3 7H20' : 'M3 7H16'} {...INK} strokeWidth="1.6" />
    {kind === 'arrow' && <path d="M16 3L21 7L16 11" {...INK} strokeWidth="1.6" />}
    {kind === 'triangle' && <path d="M15.5 3L21 7L15.5 11Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />}
    {kind === 'dot' && <circle cx="18" cy="7" r="3" fill="currentColor" />}
    {kind === 'bar' && <path d="M20.2 2.5V11.5" {...INK} strokeWidth="1.8" />}
  </Glyph>
)
const pathGlyph = (curved) => (
  <Glyph>
    <path d={curved ? 'M3 11C6 11 6.5 4 9 4S12.5 10 15 10S18.5 3 21 3' : 'M3 11L9 4L15 10L21 3'} {...INK} strokeWidth="1.8" />
  </Glyph>
)

const HEAD_KINDS = ['none', 'arrow', 'triangle', 'dot', 'bar']
const HEAD_START = HEAD_KINDS.map((k) => ({ value: k, title: k, label: headGlyph(k, true) }))
const HEAD_END = HEAD_KINDS.map((k) => ({ value: k, title: k, label: headGlyph(k) }))
const PATH_OPTS = [
  { value: false, title: 'Straight segments', label: <>{pathGlyph(false)}Straight</> },
  { value: true, title: 'Smooth curve through the bends', label: <>{pathGlyph(true)}Smooth</> },
]
const SW_OPTS = [
  { value: 1, title: 'Thin', label: lineGlyph(1.2) },
  { value: 2, title: 'Medium', label: lineGlyph(2.4) },
  { value: 4, title: 'Bold', label: lineGlyph(4) },
]
const DASH_OPTS = [
  { value: 'solid', title: 'Solid', label: lineGlyph(2) },
  { value: 'dashed', title: 'Dashed', label: lineGlyph(2, '5 3') },
  { value: 'dotted', title: 'Dotted', label: lineGlyph(2.4, '0.1 4') },
]
const ROUGH_OPTS = [
  { value: 0, title: 'Clean', label: sloppyGlyph(0) },
  { value: 1, title: 'Sketchy', label: sloppyGlyph(1) },
  { value: 2, title: 'Wild', label: sloppyGlyph(2) },
]
const ROUND_OPTS = [
  { value: false, title: 'Sharp corners', label: 'Sharp' },
  { value: true, title: 'Rounded corners', label: 'Round' },
]
const FONT_OPTS = [
  { value: 'hand', title: 'Hand-drawn', label: <span style={{ fontFamily: "'Caveat Variable', cursive", fontSize: 17 }}>Hand</span> },
  { value: 'sans', title: 'Normal', label: 'Sans' },
  { value: 'mono', title: 'Code', label: <span style={{ fontFamily: 'var(--font-mono)' }}>Mono</span> },
]
const FS_OPTS = [
  { value: 14, title: 'Small', label: 'S' },
  { value: 20, title: 'Medium', label: 'M' },
  { value: 28, title: 'Large', label: 'L' },
  { value: 40, title: 'Extra large', label: 'XL' },
]
const ALIGN_OPTS = [
  { value: 'left', title: 'Left', label: <AlignLeft /> },
  { value: 'center', title: 'Centre', label: <AlignCenter /> },
  { value: 'right', title: 'Right', label: <AlignRight /> },
]
const FILL_STYLE_OPTS = [
  { value: 'solid', title: 'Solid', label: 'Solid' },
  { value: 'hachure', title: 'Hatched', label: 'Hatch' },
  { value: 'cross', title: 'Cross-hatched', label: 'Cross' },
]
const LAYER_OPTS = [
  { op: 'front', title: 'Bring to front (Ctrl ])', icon: ArrowUpToLine },
  { op: 'forward', title: 'Bring forward (])', icon: ChevronUp },
  { op: 'backward', title: 'Send backward ([)', icon: ChevronDown },
  { op: 'back', title: 'Send to back (Ctrl [)', icon: ArrowDownToLine },
]
const ALIGN_ACTIONS = [
  { op: 'left', title: 'Align left', icon: AlignStartVertical },
  { op: 'hcenter', title: 'Centre horizontally', icon: AlignCenterVertical },
  { op: 'right', title: 'Align right', icon: AlignEndVertical },
  { op: 'hdist', title: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter },
  { op: 'top', title: 'Align top', icon: AlignStartHorizontal },
  { op: 'vcenter', title: 'Centre vertically', icon: AlignCenterHorizontal },
  { op: 'bottom', title: 'Align bottom', icon: AlignEndHorizontal },
  { op: 'vdist', title: 'Distribute vertically', icon: AlignVerticalDistributeCenter },
]

const Section = ({ label, children }) => (
  <div className="cv-sec">
    <div className="cv-sec-label">{label}</div>
    <div className="cv-sec-body">{children}</div>
  </div>
)

function Btn({ title, onClick, children, active, danger }) {
  return (
    <button className={`cv-sbtn ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
}

function Choice({ options, value, onPick }) {
  return (
    <div className="cv-opts">
      {options.map((o) => (
        <Btn key={String(o.value)} title={o.title} active={value === o.value} onClick={() => onPick(o.value)}>
          {o.label}
        </Btn>
      ))}
    </div>
  )
}

function Swatches({ colors, value, onPick, css, allowNone }) {
  const swatch = (c, title, dot) => (
    <button key={c} className={`cv-swatch ${value === c ? 'active' : ''}`} title={title} onClick={() => onPick(c)}>
      {dot}
    </button>
  )
  return (
    <div className="cv-swatches">
      {allowNone && swatch('none', 'None', <span className="cv-dot none" />)}
      {colors.map((c) => swatch(c, c, <span className="cv-dot" style={{ background: css(c) }} />))}
    </div>
  )
}

function Opacity({ value, onChange }) {
  const [v, setV] = useState(value)
  return (
    <div className="cv-range-row">
      <input
        className="cv-range"
        type="range"
        min="10"
        max="100"
        step="5"
        value={v}
        onChange={(e) => {
          setV(Number(e.target.value))
          onChange(Number(e.target.value))
        }}
      />
      <span className="cv-range-value">{v}%</span>
    </div>
  )
}

const TOOL_TYPE = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', arrow: 'arrow', line: 'line', pen: 'pen', marker: 'pen', text: 'text', mdtext: 'text', sticky: 'sticky', frame: 'frame' }

// What the style controls are about: the selection, or else the tool in hand.
function styleSubjects(ctl, state) {
  const layout = ctl.layout()
  const sel = state.selection.map((id) => layout.byId.get(id)).filter(Boolean).map(source)
  if (sel.length) return { sel, subjects: sel }
  const type = TOOL_TYPE[state.tool]
  if (!type) return { sel, subjects: [] }
  const style = ctl.styleFor(styleGroup(state.tool))
  return { sel, subjects: [{ type, ...style, ...(state.tool === 'marker' ? { tool: 'marker', stroke: style.markerStroke || 'yellow' } : {}) }] }
}

const defaultHeads = (el) => (el.type === 'arrow' ? ['none', 'arrow'] : ['none', 'none'])

function StylePanel({ ctl, tool, sel, subjects, close }) {
  const has = (k) => subjects.some((el) => appliesTo(k, el))
  const first = (k) => {
    const el = subjects.find((e) => appliesTo(k, e))
    if (!el) return undefined
    return el[k] ?? (k === 'heads' ? defaultHeads(el) : DEFAULTS[k])
  }
  const set = (patch) => {
    if (tool === 'marker' && !sel.length && patch.stroke) ctl.setStyle({ markerStroke: patch.stroke })
    else ctl.setStyle(patch)
  }
  const fill = first('fill')
  const heads = first('heads') || ['none', 'arrow']
  const single = sel.length === 1 ? sel[0] : null
  const multi = sel.length > 1
  const grouped = sel.some((el) => el.group)
  const locked = sel.length > 0 && sel.every((el) => el.locked)

  const actions = [
    single?.type === 'text' && { icon: FileText, label: single.md ? 'Plain text' : 'Markdown', title: single.md ? 'Read as plain text' : 'Read as markdown', active: !!single.md, run: () => ctl.toggleMarkdown() },
    multi && !grouped && { icon: Group, label: 'Group', title: 'Group (Ctrl G)', run: () => ctl.group() },
    grouped && { icon: Ungroup, label: 'Ungroup', title: 'Ungroup (Ctrl ⇧ G)', run: () => ctl.ungroup() },
    single && single.type !== 'note' && single.type !== 'link' && { icon: LinkIcon, label: single.link ? 'Change link' : 'Link', title: 'Link to a note or page', active: !!single.link, run: () => ctl.setLink() },
    { icon: locked ? LockOpen : Lock, label: locked ? 'Unlock' : 'Lock', title: locked ? 'Unlock (Ctrl ⇧ L)' : 'Lock (Ctrl ⇧ L)', active: locked, run: () => ctl.toggleLock() },
    { icon: Copy, label: 'Duplicate', title: 'Duplicate (Ctrl D)', run: () => ctl.duplicate() },
    { icon: Trash2, label: 'Delete', title: 'Delete (Del)', danger: true, run: () => ctl.deleteSelection() },
  ].filter(Boolean)

  return (
    <div className="cv-panel">
      {has('stroke') && (
        <Section label="Stroke">
          <Swatches colors={STROKE_COLORS} value={first('stroke')} css={colorCss} onPick={(c) => set({ stroke: c })} />
        </Section>
      )}
      {has('fill') && (
        <>
          <Section label="Fill">
            <Swatches colors={STROKE_COLORS} value={fill} css={fillCss} allowNone onPick={(c) => set({ fill: c })} />
          </Section>
          {fill && fill !== 'none' && (
            <Section label="Pattern">
              <Choice value={first('fillStyle')} options={FILL_STYLE_OPTS} onPick={(v) => set({ fillStyle: v })} />
            </Section>
          )}
        </>
      )}
      {has('color') && (
        <Section label="Colour">
          <Swatches colors={STICKY_COLORS} value={first('color')} css={stickyCss} onPick={(c) => set({ color: c })} />
        </Section>
      )}
      {has('sw') && (
        <Section label="Thickness">
          <Choice value={first('sw')} options={SW_OPTS} onPick={(v) => set({ sw: v })} />
        </Section>
      )}
      {has('dash') && (
        <Section label="Line style">
          <Choice value={first('dash')} options={DASH_OPTS} onPick={(v) => set({ dash: v })} />
        </Section>
      )}
      {has('rough') && (
        <Section label="Sloppiness">
          <Choice value={first('rough')} options={ROUGH_OPTS} onPick={(v) => set({ rough: v })} />
        </Section>
      )}
      {has('round') && (
        <Section label="Corners">
          <Choice value={!!first('round')} options={ROUND_OPTS} onPick={(v) => set({ round: v })} />
        </Section>
      )}
      {has('heads') && (
        <>
          <Section label="Start">
            <Choice value={heads[0] ?? 'none'} options={HEAD_START} onPick={(v) => set({ heads: [v, heads[1] ?? 'arrow'] })} />
          </Section>
          <Section label="End">
            <Choice value={heads[1] ?? 'arrow'} options={HEAD_END} onPick={(v) => set({ heads: [heads[0] ?? 'none', v] })} />
          </Section>
          <Section label="Path">
            <Choice value={!!first('curve')} options={PATH_OPTS} onPick={(v) => set({ curve: v })} />
          </Section>
        </>
      )}
      {has('font') && (
        <Section label="Font">
          <Choice value={first('font')} options={FONT_OPTS} onPick={(v) => set({ font: v })} />
        </Section>
      )}
      {has('fs') && (
        <Section label="Text size">
          <Choice value={first('fs')} options={FS_OPTS} onPick={(v) => set({ fs: v })} />
        </Section>
      )}
      {has('align') && (
        <Section label="Alignment">
          <Choice value={first('align')} options={ALIGN_OPTS} onPick={(v) => set({ align: v })} />
        </Section>
      )}
      {sel.length > 0 && (
        <>
          <div className="cv-panel-sep" />
          <Section label="Opacity">
            <Opacity key={sel.map((el) => el.id).join()} value={first('opacity') ?? 100} onChange={(v) => ctl.setStyle({ opacity: v })} />
          </Section>
          <Section label="Layer">
            <div className="cv-opts">
              {LAYER_OPTS.map((o) => (
                <Btn key={o.op} title={o.title} onClick={() => ctl.order(o.op)}>
                  <o.icon />
                </Btn>
              ))}
            </div>
          </Section>
          {multi && (
            <Section label="Align">
              <div className="cv-opts">
                {ALIGN_ACTIONS.map((o) => (
                  <Btn key={o.op} title={o.title} onClick={() => ctl.align(o.op)}>
                    <o.icon />
                  </Btn>
                ))}
              </div>
            </Section>
          )}
          <div className="cv-panel-sep" />
          <div className="cv-actions">
            {actions.map((a) => (
              <Btn
                key={a.label}
                title={a.title}
                active={a.active}
                danger={a.danger}
                onClick={() => {
                  a.run()
                  close()
                }}
              >
                <a.icon />
                {a.label}
              </Btn>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// A drawing tool's settings open by themselves, right above that tool's
// button; with something selected they sit behind one Style button instead.
export function StyleBar({ ctl }) {
  const state = useController(ctl)
  const rootRef = useRef(null)
  // Clicking away closes a tool's settings until the tool is picked again.
  const [toolAnchor, setToolAnchor] = useState(null)
  const [dismissed, setDismissed] = useState(null)
  useEffect(() => setDismissed(null), [state.tool])
  useEffect(() => {
    const reopen = (e) => e.detail === ctl && setDismissed(null)
    window.addEventListener('obi:tool-settings', reopen)
    return () => window.removeEventListener('obi:tool-settings', reopen)
  }, [ctl])
  useLayoutEffect(() => {
    const dock = rootRef.current?.closest('.cv-dock')
    setToolAnchor(dock?.querySelector('.cv-tool.active') || null)
  })
  if (ctl.readOnly || state.editing || state.panning) return null
  const { sel, subjects } = styleSubjects(ctl, state)
  if (!subjects.length) return null
  const panel = (close) => <StylePanel ctl={ctl} tool={state.tool} sel={sel} subjects={subjects} close={close} />

  // Nothing selected, drawing tool in hand: its settings, above its button.
  if (!sel.length) {
    const tool = state.tool
    const hide = () => setDismissed(tool)
    return (
      <span ref={rootRef} style={{ display: 'contents' }}>
        {toolAnchor && dismissed !== tool && (
          <Popover anchor={toolAnchor} onClose={hide}>
            {panel(hide)}
          </Popover>
        )}
      </span>
    )
  }

  const stroke = subjects.find((el) => appliesTo('stroke', el))?.stroke ?? DEFAULTS.stroke
  const hasStroke = subjects.some((el) => appliesTo('stroke', el))
  return (
    <div className="cv-stylebar" ref={rootRef} onPointerDown={(e) => e.stopPropagation()}>
      <PopButton
        title="Style and arrangement"
        label={
          <>
            {hasStroke ? <span className="cv-dot" style={{ background: colorCss(stroke) }} /> : <SlidersHorizontal />}
            <span className="cv-sbtn-label">{sel.length > 1 ? `${sel.length} selected` : 'Style'}</span>
          </>
        }
      >
        {panel}
      </PopButton>
    </div>
  )
}
