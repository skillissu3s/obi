import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MousePointer2, Hand, Square, Circle, Diamond, MoveUpRight, Minus, Pencil, Highlighter, Type, StickyNote, ImagePlus, Link2,
  Frame, Eraser, Pointer, Lock, LockOpen, Copy, Trash2, Group, Ungroup, Layers, AlignStartVertical, AlignCenterVertical,
  AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter, AlignLeft, AlignCenter, AlignRight, SlidersHorizontal, Spline, ChevronsDown, Link as LinkIcon,
  ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, ChevronRight, FileText, Hash, Pilcrow,
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
  { id: 'mdtext', key: 'W', label: 'Markdown block — headings, lists and links', icon: Pilcrow },
  { id: 'sticky', key: 'N', label: 'Sticky note', icon: StickyNote },
  'sep',
  { id: 'image', key: 'I', label: 'Image', icon: ImagePlus },
  { id: 'note', key: 'K', label: 'Link a note or web page', icon: Link2 },
  { id: 'frame', key: 'F', label: 'Frame', icon: Frame, boardOnly: true },
  { id: 'eraser', key: 'E', label: 'Eraser', icon: Eraser },
  { id: 'laser', key: 'X', label: 'Laser pointer', icon: Pointer },
]

export function Toolbar({ ctl, mode, extra, onCollapse }) {
  const state = useController(ctl)
  const readOnly = ctl.readOnly
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t, i) => {
        if (t === 'sep') return <div key={i} className="cv-sep" />
        if (t.boardOnly && mode !== 'board') return null
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
  const [flip, setFlip] = useState(false)
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const r = anchor.getBoundingClientRect()
    const pr = ref.current.getBoundingClientRect()
    let left = r.left + r.width / 2 - pr.width / 2
    left = Math.max(8, Math.min(window.innerWidth - pr.width - 8, left))
    // Opens above the button it belongs to. When there isn't room, it rises as
    // far as it needs to stay whole on screen — it never drops below the
    // toolbar, where it would run off the bottom.
    let top = r.top - pr.height - 8
    if (top < 8) top = Math.max(8, window.innerHeight - pr.height - 8)
    // submenus open to the right unless there is no room for them there
    setFlip(left + pr.width + 180 > window.innerWidth)
    setPos({ left, top })
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
    <div ref={ref} className={`cv-pop ${flip ? 'flip-sub' : ''}`} style={pos || { left: -9999, top: -9999 }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  )
}

function PopButton({ title, label, children, active }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <button
        className={`cv-sbtn ${anchor ? 'open' : ''} ${active ? 'active' : ''}`}
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {label}
      </button>
      {anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)}>{typeof children === 'function' ? children(() => setAnchor(null)) : children}</Popover>}
    </>
  )
}

function Btn({ title, onClick, children, active, danger, disabled }) {
  return (
    <button className={`cv-sbtn ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
}

function Swatches({ colors, value, onPick, css, allowNone }) {
  return (
    <div className="cv-swatches">
      {allowNone && (
        <button className={`cv-swatch ${value === 'none' || !value ? 'active' : ''}`} title="None" onClick={() => onPick('none')}>
          <span className="cv-dot none" />
        </button>
      )}
      {colors.map((c) => (
        <button key={c} className={`cv-swatch ${value === c ? 'active' : ''}`} title={c} onClick={() => onPick(c)}>
          <span className="cv-dot" style={{ background: css(c) }} />
        </button>
      ))}
    </div>
  )
}

function Opts({ options, value, onPick }) {
  return (
    <div className="cv-opts">
      {options.map((o) => (
        <Btn key={String(o.value)} title={o.title} active={JSON.stringify(value) === JSON.stringify(o.value)} onClick={() => onPick(o.value)}>
          {o.label}
        </Btn>
      ))}
    </div>
  )
}

const line = (w, dash) => (
  <svg width="22" height="12" viewBox="0 0 22 12">
    <path d="M2 6H20" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeDasharray={dash} />
  </svg>
)
const sloppy = (n) => (
  <svg width="22" height="14" viewBox="0 0 22 14">
    <path d={n === 0 ? 'M2 7H20' : n === 1 ? 'M2 8C6 5 9 9 12 7S17 6 20 7' : 'M2 9C4 3 7 12 10 6S15 2 17 10 19 5 20 7'} stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
)
const headIcon = (kind, flip) => (
  <svg width="22" height="12" viewBox="0 0 22 12" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M2 6H18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    {kind === 'arrow' && <path d="M14 2L19 6L14 10" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    {kind === 'triangle' && <path d="M14 2L20 6L14 10Z" fill="currentColor" />}
    {kind === 'dot' && <circle cx="18" cy="6" r="3" fill="currentColor" />}
    {kind === 'bar' && <path d="M19 1.5V10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
  </svg>
)

const TOOL_TYPE = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', arrow: 'arrow', line: 'line', pen: 'pen', marker: 'pen', text: 'text', mdtext: 'text', sticky: 'sticky', frame: 'frame' }

// One settings area rather than a row of unlabelled icons: every row says what
// it is and shows what it is set to, and its options open beside it.
// Which submenu is open follows the pointer at once — with one exception, the
// one desktop menus make ("menu aim"): while the pointer is heading toward the
// submenu that is already open, the rows it crosses on the way don't take
// over. That is decided from the direction of travel on every move, not by
// waiting, so running up and down the list never lags.
const SubmenuCtx = createContext(null)

// p inside the triangle a-b-c (edges count)
function inTriangle(p, a, b, c) {
  const side = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = side(p, a, b)
  const d2 = side(p, b, c)
  const d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

function MenuRows({ children }) {
  const [open, setOpen] = useState(null)
  const openRef = useRef(null)
  openRef.current = open
  const trail = useRef([]) // the last few pointer positions, to read direction
  const rest = useRef(0)
  useEffect(() => () => clearTimeout(rest.current), [])

  const show = (id) => {
    clearTimeout(rest.current)
    if (openRef.current !== id) setOpen(id)
  }

  const onMove = (e) => {
    const p = { x: e.clientX, y: e.clientY }
    const from = trail.current[0] // a few moves back: steadier than the last one
    trail.current = [...trail.current.slice(-2), p]
    // inside the open options: nothing to decide
    if (e.target.closest('.cv-sub')) return clearTimeout(rest.current)
    const id = e.target.closest('.cv-row')?.dataset.sub || null
    const current = openRef.current
    if (!current || id === current) return show(id ?? current)
    const sub = e.currentTarget.querySelector('.cv-row.open > .cv-sub')
    if (sub && from) {
      const r = sub.getBoundingClientRect()
      const flip = !!e.currentTarget.closest('.flip-sub')
      const edge = flip ? r.right : r.left
      const toward = flip ? p.x < from.x : p.x > from.x
      if (toward && inTriangle(p, from, { x: edge, y: r.top - 6 }, { x: edge, y: r.bottom + 6 })) {
        // on its way there: keep the open options. Only if the pointer comes
        // to rest on this row does the row get its turn.
        clearTimeout(rest.current)
        rest.current = setTimeout(() => setOpen(id), 60)
        return
      }
    }
    show(id)
  }

  return (
    <SubmenuCtx.Provider value={open}>
      <div
        className="cv-menu"
        onPointerMove={onMove}
        onPointerLeave={() => {
          trail.current = []
          show(null)
        }}
      >
        {children}
      </div>
    </SubmenuCtx.Provider>
  )
}

function MenuRow({ name, value, children, hint, danger, active, onClick }) {
  const open = useContext(SubmenuCtx)
  if (!children) {
    return (
      <button className={`cv-row ${danger ? 'danger' : ''} ${active ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
        <span className="cv-row-name">{name}</span>
        {hint && <span className="cv-row-hint">{hint}</span>}
      </button>
    )
  }
  return (
    <div className={`cv-row has-sub ${open === name ? 'open' : ''}`} data-sub={name}>
      <span className="cv-row-name">{name}</span>
      {value != null && <span className="cv-row-value">{value}</span>}
      <ChevronRight className="cv-row-arrow" />
      <div className="cv-sub" onPointerDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

const labelOf = (options, value, fallback = '') => options.find((o) => o.value === value)?.title ?? fallback

// Contextual style controls for the selection (or the active drawing tool).
export function StyleBar({ ctl, mode }) {
  const state = useController(ctl)
  const rootRef = useRef(null)
  // A drawing tool's settings open by themselves, right above that tool's
  // button. Clicking away closes them until the tool is picked again.
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
  const layout = ctl.layout()
  const sel = state.selection.map((id) => layout.byId.get(id)).filter(Boolean).map(source)
  const toolType = TOOL_TYPE[state.tool]
  const toolStyle = ctl.styleFor(styleGroup(state.tool))
  const subjects = sel.length ? sel : toolType ? [{ type: toolType, ...toolStyle, ...(state.tool === 'marker' ? { tool: 'marker', stroke: toolStyle.markerStroke || 'yellow' } : {}) }] : []
  if (!subjects.length) return null
  const has = (k) => subjects.some((el) => appliesTo(k, el))
  const first = (k) => {
    const el = subjects.find((e) => appliesTo(k, e))
    return el ? (el[k] ?? (k === 'heads' ? (el.type === 'arrow' ? ['none', 'arrow'] : ['none', 'none']) : DEFAULTS[k])) : undefined
  }
  const set = (patch) => {
    if (state.tool === 'marker' && !sel.length && patch.stroke) ctl.setStyle({ markerStroke: patch.stroke })
    else ctl.setStyle(patch)
  }
  const multi = sel.length > 1
  const locked = sel.length > 0 && sel.every((el) => el.locked)
  const grouped = sel.some((el) => el.group)
  const stroke = first('stroke')
  const fill = first('fill')
  const single = sel.length === 1 ? sel[0] : null

  const swOpts = [
    { value: 1, title: 'Thin', label: line(1.2) },
    { value: 2, title: 'Medium', label: line(2.4) },
    { value: 4, title: 'Bold', label: line(4) },
  ]
  const dashOpts = [
    { value: 'solid', title: 'Solid', label: line(2) },
    { value: 'dashed', title: 'Dashed', label: line(2, '5 3') },
    { value: 'dotted', title: 'Dotted', label: line(2.4, '0.1 4') },
  ]
  const roughOpts = [
    { value: 0, title: 'Clean', label: sloppy(0) },
    { value: 1, title: 'Sketchy', label: sloppy(1) },
    { value: 2, title: 'Wild', label: sloppy(2) },
  ]
  const roundOpts = [
    { value: false, title: 'Sharp', label: 'Sharp' },
    { value: true, title: 'Round', label: 'Round' },
  ]
  const fontOpts = [
    { value: 'hand', title: 'Hand-drawn', label: <span style={{ fontFamily: "'Caveat Variable', cursive", fontSize: 17 }}>Hand</span> },
    { value: 'sans', title: 'Normal', label: 'Sans' },
    { value: 'mono', title: 'Code', label: <span style={{ fontFamily: 'var(--font-mono)' }}>Mono</span> },
  ]
  const fsOpts = [
    { value: 14, title: 'Small', label: 'S' },
    { value: 20, title: 'Medium', label: 'M' },
    { value: 28, title: 'Large', label: 'L' },
    { value: 40, title: 'Extra large', label: 'XL' },
  ]
  const alignOpts = [
    { value: 'left', title: 'Left', label: <AlignLeft size={15} /> },
    { value: 'center', title: 'Centre', label: <AlignCenter size={15} /> },
    { value: 'right', title: 'Right', label: <AlignRight size={15} /> },
  ]
  const fillStyleOpts = [
    { value: 'solid', title: 'Solid', label: 'Solid' },
    { value: 'hachure', title: 'Hatched', label: 'Hatch' },
    { value: 'cross', title: 'Cross-hatched', label: 'Cross' },
  ]

  const menu = (close) => (
          <MenuRows>
            {has('stroke') && (
              <MenuRow name="Stroke" value={<span className="cv-dot sm" style={{ background: colorCss(stroke) }} />}>
                <Swatches colors={STROKE_COLORS} value={stroke} css={colorCss} onPick={(c) => set({ stroke: c })} />
              </MenuRow>
            )}
            {has('fill') && (
              <MenuRow
                name="Fill"
                value={<span className={`cv-dot sm ${fill === 'none' || !fill ? 'none' : ''}`} style={fill && fill !== 'none' ? { background: fillCss(fill) } : undefined} />}
              >
                <Swatches colors={STROKE_COLORS} value={fill} css={fillCss} allowNone onPick={(c) => set({ fill: c })} />
                {fill && fill !== 'none' && (
                  <>
                    <div className="cv-pop-label">Pattern</div>
                    <Opts value={first('fillStyle')} onPick={(v) => set({ fillStyle: v })} options={fillStyleOpts} />
                  </>
                )}
              </MenuRow>
            )}
            {has('color') && (
              <MenuRow name="Note colour" value={<span className="cv-dot sm" style={{ background: stickyCss(first('color')), borderRadius: 4 }} />}>
                <Swatches colors={STICKY_COLORS} value={first('color')} css={stickyCss} onPick={(c) => set({ color: c })} />
              </MenuRow>
            )}
            {has('sw') && (
              <MenuRow name="Thickness" value={labelOf(swOpts, first('sw'), 'Medium')}>
                <Opts value={first('sw')} onPick={(v) => set({ sw: v })} options={swOpts} />
              </MenuRow>
            )}
            {has('dash') && (
              <MenuRow name="Line style" value={labelOf(dashOpts, first('dash'), 'Solid')}>
                <Opts value={first('dash')} onPick={(v) => set({ dash: v })} options={dashOpts} />
              </MenuRow>
            )}
            {has('rough') && (
              <MenuRow name="Sloppiness" value={labelOf(roughOpts, first('rough'), 'Sketchy')}>
                <Opts value={first('rough')} onPick={(v) => set({ rough: v })} options={roughOpts} />
              </MenuRow>
            )}
            {has('round') && (
              <MenuRow name="Corners" value={labelOf(roundOpts, !!first('round'), 'Sharp')}>
                <Opts value={!!first('round')} onPick={(v) => set({ round: v })} options={roundOpts} />
              </MenuRow>
            )}
            {has('heads') && (
              <MenuRow name="Ends and path" value={first('curve') ? 'Curved' : 'Straight'}>
                <div className="cv-pop-label">Start</div>
                <Opts
                  value={first('heads')?.[0] ?? 'none'}
                  onPick={(v) => set({ heads: [v, first('heads')?.[1] ?? 'arrow'] })}
                  options={['none', 'arrow', 'triangle', 'dot', 'bar'].map((k) => ({ value: k, title: k, label: headIcon(k, true) }))}
                />
                <div className="cv-pop-label">End</div>
                <Opts
                  value={first('heads')?.[1] ?? 'arrow'}
                  onPick={(v) => set({ heads: [first('heads')?.[0] ?? 'none', v] })}
                  options={['none', 'arrow', 'triangle', 'dot', 'bar'].map((k) => ({ value: k, title: k, label: headIcon(k) }))}
                />
                <div className="cv-pop-label">Path</div>
                <Opts
                  value={!!first('curve')}
                  onPick={(v) => set({ curve: v })}
                  options={[
                    { value: false, title: 'Straight', label: 'Straight' },
                    { value: true, title: 'Curved', label: 'Curved' },
                  ]}
                />
              </MenuRow>
            )}
            {has('font') && (
              <MenuRow name="Font" value={labelOf(fontOpts, first('font'), 'Hand-drawn')}>
                <Opts value={first('font')} onPick={(v) => set({ font: v })} options={fontOpts} />
              </MenuRow>
            )}
            {has('fs') && (
              <MenuRow name="Text size" value={labelOf(fsOpts, first('fs'), 'Medium')}>
                <Opts value={first('fs')} onPick={(v) => set({ fs: v })} options={fsOpts} />
              </MenuRow>
            )}
            {has('align') && (
              <MenuRow name="Alignment" value={labelOf(alignOpts, first('align'), 'Left')}>
                <Opts value={first('align')} onPick={(v) => set({ align: v })} options={alignOpts} />
              </MenuRow>
            )}
            {sel.length > 0 && (
              <>
                <div className="cv-menu-sep" />
                <MenuRow name="Opacity" value={`${first('opacity') ?? 100}%`}>
                  <input
                    className="cv-range"
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    defaultValue={first('opacity') ?? 100}
                    onChange={(e) => ctl.setStyle({ opacity: Number(e.target.value) })}
                  />
                </MenuRow>
                <MenuRow name="Layer">
                  <div className="cv-opts">
                    <Btn title="Bring to front (Ctrl ])" onClick={() => ctl.order('front')}>
                      <ArrowUpToLine />
                    </Btn>
                    <Btn title="Bring forward (])" onClick={() => ctl.order('forward')}>
                      <ChevronUp />
                    </Btn>
                    <Btn title="Send backward ([)" onClick={() => ctl.order('backward')}>
                      <ChevronDown />
                    </Btn>
                    <Btn title="Send to back (Ctrl [)" onClick={() => ctl.order('back')}>
                      <ArrowDownToLine />
                    </Btn>
                  </div>
                </MenuRow>
                {multi && (
                  <MenuRow name="Align and distribute">
                    <div className="cv-opts">
                      <Btn title="Align left" onClick={() => ctl.align('left')}>
                        <AlignStartVertical />
                      </Btn>
                      <Btn title="Centre horizontally" onClick={() => ctl.align('hcenter')}>
                        <AlignCenterVertical />
                      </Btn>
                      <Btn title="Align right" onClick={() => ctl.align('right')}>
                        <AlignEndVertical />
                      </Btn>
                      <Btn title="Distribute horizontally" onClick={() => ctl.align('hdist')}>
                        <AlignHorizontalDistributeCenter />
                      </Btn>
                    </div>
                    <div className="cv-opts">
                      <Btn title="Align top" onClick={() => ctl.align('top')}>
                        <AlignStartHorizontal />
                      </Btn>
                      <Btn title="Centre vertically" onClick={() => ctl.align('vcenter')}>
                        <AlignCenterHorizontal />
                      </Btn>
                      <Btn title="Align bottom" onClick={() => ctl.align('bottom')}>
                        <AlignEndHorizontal />
                      </Btn>
                      <Btn title="Distribute vertically" onClick={() => ctl.align('vdist')}>
                        <AlignVerticalDistributeCenter />
                      </Btn>
                    </div>
                  </MenuRow>
                )}
                <div className="cv-menu-sep" />
                {single?.type === 'text' && (
                  <MenuRow
                    name={single.md ? 'Read as plain text' : 'Read as markdown'}
                    active={!!single.md}
                    onClick={() => {
                      ctl.toggleMarkdown()
                      close()
                    }}
                  />
                )}
                {multi && !grouped && (
                  <MenuRow
                    name="Group"
                    hint="Ctrl G"
                    onClick={() => {
                      ctl.group()
                      close()
                    }}
                  />
                )}
                {grouped && (
                  <MenuRow
                    name="Ungroup"
                    hint="Ctrl ⇧ G"
                    onClick={() => {
                      ctl.ungroup()
                      close()
                    }}
                  />
                )}
                {single && single.type !== 'note' && single.type !== 'link' && (
                  <MenuRow
                    name={single.link ? 'Change link' : 'Link to a note or page'}
                    active={!!single.link}
                    onClick={() => {
                      ctl.setLink()
                      close()
                    }}
                  />
                )}
                <MenuRow
                  name={locked ? 'Unlock' : 'Lock'}
                  hint="Ctrl ⇧ L"
                  active={locked}
                  onClick={() => {
                    ctl.toggleLock()
                    close()
                  }}
                />
                <MenuRow
                  name="Duplicate"
                  hint="Ctrl D"
                  onClick={() => {
                    ctl.duplicate()
                    close()
                  }}
                />
                <MenuRow
                  name="Delete"
                  hint="Del"
                  danger
                  onClick={() => {
                    ctl.deleteSelection()
                    close()
                  }}
                />
              </>
            )}
          </MenuRows>
  )

  // Nothing selected, drawing tool in hand: its settings, above its button.
  if (!sel.length) {
    const tool = state.tool
    const hide = () => setDismissed(tool)
    return (
      <span ref={rootRef} style={{ display: 'contents' }}>
        {toolAnchor && dismissed !== tool && (
          <Popover anchor={toolAnchor} onClose={hide}>
            {menu(hide)}
          </Popover>
        )}
      </span>
    )
  }

  // A selection: its settings behind one Style button above the toolbar.
  return (
    <div className="cv-stylebar" ref={rootRef} onPointerDown={(e) => e.stopPropagation()}>
      <PopButton
        title="Style and arrangement"
        label={
          <>
            {has('stroke') ? <span className="cv-dot" style={{ background: colorCss(stroke) }} /> : <SlidersHorizontal />}
            <span className="cv-sbtn-label">{multi ? `${sel.length} selected` : 'Style'}</span>
          </>
        }
      >
        {(close) => menu(close)}
      </PopButton>
    </div>
  )
}
