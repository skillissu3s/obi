import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Lock, LockOpen, Copy, Trash2, Group, Ungroup, AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  AlignLeft, AlignCenter, AlignRight, Link as LinkIcon, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, FileText, MoreHorizontal,
} from 'lucide-react'
import { STROKE_COLORS, STICKY_COLORS, colorCss, fillCss, stickyCss, DEFAULTS } from '@shared/boardsvg.js'
import { appliesTo, styleGroup } from './controller.js'
import { source } from './layout.js'

// ---------- the quick bar ----------
//
// What is being styled — the tool in hand, or the selection — gets one short row:
// the few things changed most (its colour, its fill, how thick, how big its text
// is), each a small button showing what it is now and opening its choices, and a
// ⋯ menu for everything else. It sits above the tool's button in the dock, or
// floats above the selection on the canvas.

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
  { value: false, title: 'Straight segments', label: pathGlyph(false) },
  { value: true, title: 'Smooth curve through the bends', label: pathGlyph(true) },
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
  { value: 'hand', title: 'Hand-drawn', label: <span style={{ fontFamily: "'Caveat Variable', cursive", fontSize: 16 }}>Hand</span> },
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

// A press in a bar or menu leaves the focus where it was (on the canvas or the
// text being written), except on a field: a slider can't be dragged without it.
export const keepFocus = (e) => !e.target.closest('input, textarea, select') && e.preventDefault()

function Btn({ title, onClick, children, active, danger, className = '' }) {
  return (
    <button type="button" className={`cv-sbtn ${active ? 'active' : ''} ${danger ? 'danger' : ''} ${className}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
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
    <button type="button" key={c} className={`cv-swatch ${value === c ? 'active' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)}>
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

const Row = ({ label, children }) => (
  <div className="cv-qrow">
    <div className="cv-qrow-label">{label}</div>
    {children}
  </div>
)

// A menu under (or over) its button, kept inside the window: nudged sideways off
// an edge, opened the other way when that side has more room, and scrolling
// when neither has enough. Worked out once, as it opens. The bar on a selection
// is scaled against the zoom, so the sizes are in the menu's own pixels.
function Menu({ end, children, wide }) {
  const ref = useRef(null)
  const [fit, setFit] = useState(null) // { dx, flip, maxHeight }
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || fit) return
    const r = el.getBoundingClientRect()
    const scale = r.width / (el.offsetWidth || 1) || 1
    let dx = 0
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right
    if (r.left + dx < 8) dx = 8 - r.left
    // the button the menu hangs from: the room beside it, above and below
    const btn = el.parentElement.getBoundingClientRect()
    const up = el.closest('.cv-qb')?.classList.contains('up')
    const roomBelow = window.innerHeight - btn.bottom - 16
    const roomAbove = btn.top - 16
    const need = r.height + 8 * scale
    const flip = up ? roomAbove < need && roomBelow > roomAbove : roomBelow < need && roomAbove > roomBelow
    const room = (up ? !flip : flip) ? roomAbove : roomBelow
    setFit({ dx: dx / scale, flip, maxHeight: need > room ? Math.max(120, room - 8 * scale) / scale : undefined })
  }, [fit])
  const style = fit ? { translate: fit.dx ? `${fit.dx}px 0` : undefined, maxHeight: fit.maxHeight } : { visibility: 'hidden' }
  return (
    <div ref={ref} className={`cv-qmenu ${end ? 'end' : ''} ${wide ? 'wide' : ''} ${fit?.flip ? 'flip' : ''}`} style={style} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

const TEXTISH = new Set(['text', 'sticky'])
const defaultHeads = (el) => (el.type === 'arrow' ? ['none', 'arrow'] : ['none', 'none'])

const TOOL_TYPE = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', arrow: 'arrow', line: 'line', pen: 'pen', marker: 'pen', text: 'text', mdtext: 'text', sticky: 'sticky', frame: 'frame' }

// What the bar is about: the selection, or else the tool in hand.
export function styleSubjects(ctl, state) {
  const layout = ctl.layout()
  const sel = state.selection.map((id) => layout.byId.get(id)).filter(Boolean).map(source)
  if (sel.length) return { sel, subjects: sel }
  const type = TOOL_TYPE[state.tool]
  if (!type) return { sel, subjects: [] }
  const style = ctl.styleFor(styleGroup(state.tool))
  return { sel, subjects: [{ type, ...style, ...(state.tool === 'marker' ? { tool: 'marker', stroke: style.markerStroke || 'yellow' } : {}) }] }
}

/**
 * `up`: the menus open above the bar (the bar in the dock, at the bottom);
 * otherwise below it. `onAction` runs after an action in the ⋯ menu (Delete, say).
 */
export function QuickBar({ ctl, tool, sel, subjects, up = false, onAction }) {
  const [open, setOpen] = useState(null)
  const rootRef = useRef(null)
  const key = sel.map((el) => el.id).join()
  useEffect(() => setOpen(null), [key, tool])
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => !rootRef.current?.contains(e.target) && setOpen(null)
    const esc = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(null)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

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
  const toggle = (id) => setOpen((now) => (now === id ? null : id))

  const textish = subjects.length > 0 && subjects.every((el) => TEXTISH.has(el.type))
  const fill = first('fill')
  const heads = first('heads') || ['none', 'arrow']
  const single = sel.length === 1 ? sel[0] : null
  const multi = sel.length > 1
  const grouped = sel.some((el) => el.group)
  const locked = sel.length > 0 && sel.every((el) => el.locked)

  // the buttons on the bar itself: the few things changed most
  const chips = []
  const chip = (id, title, face, menu, cls) =>
    chips.push(
      <div key={id} className="cv-qitem">
        <Btn title={title} active={open === id} className={`cv-chip ${cls || ''}`} onClick={() => toggle(id)}>
          {face}
        </Btn>
        {open === id && <Menu>{menu}</Menu>}
      </div>,
    )
  if (has('color')) {
    const c = first('color')
    chip('color', 'Colour', <span className="cv-dot" style={{ background: stickyCss(c) }} />, <Swatches colors={STICKY_COLORS} value={c} css={stickyCss} onPick={(v) => set({ color: v })} />)
  }
  if (has('stroke')) {
    const c = first('stroke')
    const label = has('fill') ? 'Stroke colour' : 'Colour'
    chip('stroke', label, <span className="cv-dot" style={{ background: colorCss(c) }} />, <Swatches colors={STROKE_COLORS} value={c} css={colorCss} onPick={(v) => set({ stroke: v })} />)
  }
  if (has('fill')) {
    chip(
      'fill',
      'Fill',
      <span className={`cv-dot fill ${!fill || fill === 'none' ? 'none' : ''}`} style={fill && fill !== 'none' ? { background: fillCss(fill) } : undefined} />,
      <>
        <Swatches colors={STROKE_COLORS} value={fill} css={fillCss} allowNone onPick={(v) => set({ fill: v })} />
        {fill && fill !== 'none' && (
          <Row label="Pattern">
            <Choice value={first('fillStyle')} options={FILL_STYLE_OPTS} onPick={(v) => set({ fillStyle: v })} />
          </Row>
        )}
      </>,
    )
  }
  if (has('sw')) {
    const v = first('sw')
    chip('sw', 'Thickness', (SW_OPTS.find((o) => o.value === v) || SW_OPTS[1]).label, <Choice value={v} options={SW_OPTS} onPick={(x) => set({ sw: x })} />)
  }
  if (has('heads')) {
    chip(
      'heads',
      'Arrowheads and path',
      headGlyph(heads[1] ?? 'arrow'),
      <>
        <Row label="Start">
          <Choice value={heads[0] ?? 'none'} options={HEAD_START} onPick={(v) => set({ heads: [v, heads[1] ?? 'arrow'] })} />
        </Row>
        <Row label="End">
          <Choice value={heads[1] ?? 'arrow'} options={HEAD_END} onPick={(v) => set({ heads: [heads[0] ?? 'none', v] })} />
        </Row>
        <Row label="Path">
          <Choice value={!!first('curve')} options={PATH_OPTS} onPick={(v) => set({ curve: v })} />
        </Row>
      </>,
    )
  }
  if (textish && has('fs')) {
    const v = first('fs')
    chip('fs', 'Text size', <span className="cv-chip-text">{(FS_OPTS.find((o) => o.value === v) || { label: 'M' }).label}</span>, <Choice value={v} options={FS_OPTS} onPick={(x) => set({ fs: x })} />)
  }
  if (textish && has('align')) {
    const v = first('align') || 'left'
    chip('align', 'Alignment', (ALIGN_OPTS.find((o) => o.value === v) || ALIGN_OPTS[0]).label, <Choice value={v} options={ALIGN_OPTS} onPick={(x) => set({ align: x })} />)
  }

  // the rest, behind ⋯
  const more = []
  if (has('dash')) more.push(<Row key="dash" label="Line"><Choice value={first('dash')} options={DASH_OPTS} onPick={(v) => set({ dash: v })} /></Row>)
  if (has('rough')) more.push(<Row key="rough" label="Sloppiness"><Choice value={first('rough')} options={ROUGH_OPTS} onPick={(v) => set({ rough: v })} /></Row>)
  if (has('round')) more.push(<Row key="round" label="Corners"><Choice value={!!first('round')} options={ROUND_OPTS} onPick={(v) => set({ round: v })} /></Row>)
  if (has('font')) more.push(<Row key="font" label="Font"><Choice value={first('font')} options={FONT_OPTS} onPick={(v) => set({ font: v })} /></Row>)
  if (!textish && has('fs')) more.push(<Row key="fs" label="Text size"><Choice value={first('fs')} options={FS_OPTS} onPick={(v) => set({ fs: v })} /></Row>)
  if (!textish && has('align')) more.push(<Row key="align" label="Text align"><Choice value={first('align')} options={ALIGN_OPTS} onPick={(v) => set({ align: v })} /></Row>)
  if (sel.length) {
    more.push(<Row key="opacity" label="Opacity"><Opacity key={key} value={first('opacity') ?? 100} onChange={(v) => ctl.setStyle({ opacity: v })} /></Row>)
    more.push(
      <Row key="layer" label="Layer">
        <div className="cv-opts">
          {LAYER_OPTS.map((o) => (
            <Btn key={o.op} title={o.title} onClick={() => ctl.order(o.op)}>
              <o.icon />
            </Btn>
          ))}
        </div>
      </Row>,
    )
    if (multi) {
      more.push(
        <Row key="arrange" label="Arrange">
          <div className="cv-opts cv-opts-wrap">
            {ALIGN_ACTIONS.map((o) => (
              <Btn key={o.op} title={o.title} onClick={() => ctl.align(o.op)}>
                <o.icon />
              </Btn>
            ))}
          </div>
        </Row>,
      )
    }
  }
  const actions = sel.length
    ? [
        single?.type === 'text' && { icon: FileText, label: single.md ? 'Read as plain text' : 'Read as markdown', active: !!single.md, run: () => ctl.toggleMarkdown() },
        multi && !grouped && { icon: Group, label: 'Group', keys: 'Ctrl G', run: () => ctl.group() },
        grouped && { icon: Ungroup, label: 'Ungroup', keys: 'Ctrl ⇧ G', run: () => ctl.ungroup() },
        single && single.type !== 'note' && single.type !== 'link' && { icon: LinkIcon, label: single.link ? 'Change link' : 'Link to a note or page', active: !!single.link, run: () => ctl.setLink() },
        { icon: locked ? LockOpen : Lock, label: locked ? 'Unlock' : 'Lock', keys: 'Ctrl ⇧ L', run: () => ctl.toggleLock() },
        { icon: Copy, label: 'Duplicate', keys: 'Ctrl D', run: () => ctl.duplicate() },
        { icon: Trash2, label: 'Delete', keys: 'Del', danger: true, run: () => ctl.deleteSelection() },
      ].filter(Boolean)
    : []

  if (!chips.length && !more.length && !actions.length) return null
  return (
    <div ref={rootRef} className={`cv-qb ${up ? 'up' : ''}`} role="toolbar" aria-label="Style" onMouseDown={keepFocus} onPointerDown={(e) => e.stopPropagation()}>
      {chips}
      {(more.length > 0 || actions.length > 0) && (
        <>
          {chips.length > 0 && <div className="cv-qsep" />}
          <div className="cv-qitem">
            <Btn title="More options" active={open === 'more'} className="cv-chip" onClick={() => toggle('more')}>
              <MoreHorizontal />
            </Btn>
            {open === 'more' && (
              <Menu end wide>
                {more}
                {more.length > 0 && actions.length > 0 && <div className="cv-qmenu-sep" />}
                {actions.map((a) => (
                  <button
                    type="button"
                    key={a.label}
                    className={`cv-qaction ${a.active ? 'active' : ''} ${a.danger ? 'danger' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(null)
                      a.run()
                      onAction?.()
                    }}
                  >
                    <a.icon />
                    <span>{a.label}</span>
                    {a.keys && <kbd>{a.keys}</kbd>}
                  </button>
                ))}
              </Menu>
            )}
          </div>
        </>
      )}
    </div>
  )
}
