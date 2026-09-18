import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MousePointer2, Hand, Square, Circle, Diamond, MoveUpRight, Minus, Pencil, Highlighter, Type, StickyNote, ImagePlus, Link2,
  Frame, Eraser, Pointer, Lock, LockOpen, Copy, Trash2, Group, Ungroup, Layers, AlignStartVertical, AlignCenterVertical,
  AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter, AlignLeft, AlignCenter, AlignRight, SlidersHorizontal, Spline, ChevronsDown, Link as LinkIcon,
  ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, FileText, Hash,
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
            onClick={() => ctl.setTool(t.id)}
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
    if (!anchor || !ref.current) return
    const r = anchor.getBoundingClientRect()
    const pr = ref.current.getBoundingClientRect()
    let left = r.left + r.width / 2 - pr.width / 2
    left = Math.max(8, Math.min(window.innerWidth - pr.width - 8, left))
    let top = r.top - pr.height - 8
    if (top < 8) top = r.bottom + 8
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
    <div ref={ref} className="cv-pop" style={pos || { left: -9999, top: -9999 }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
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

const TOOL_TYPE = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', arrow: 'arrow', line: 'line', pen: 'pen', marker: 'pen', text: 'text', sticky: 'sticky', frame: 'frame' }

// Contextual style controls for the selection (or the active drawing tool).
export function StyleBar({ ctl, mode }) {
  const state = useController(ctl)
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

  return (
    <div className="cv-stylebar" onPointerDown={(e) => e.stopPropagation()}>
      {has('stroke') && (
        <PopButton title="Stroke colour" label={<span className="cv-dot" style={{ background: colorCss(stroke) }} />}>
          <div className="cv-pop-label">Stroke</div>
          <Swatches colors={STROKE_COLORS} value={stroke} css={colorCss} onPick={(c) => set({ stroke: c })} />
        </PopButton>
      )}
      {has('fill') && (
        <PopButton title="Fill" label={<span className={`cv-dot ${fill === 'none' || !fill ? 'none' : ''}`} style={fill && fill !== 'none' ? { background: fillCss(fill) } : undefined} />}>
          <div className="cv-pop-label">Fill</div>
          <Swatches colors={STROKE_COLORS} value={fill} css={fillCss} allowNone onPick={(c) => set({ fill: c })} />
          {fill && fill !== 'none' && (
            <Opts
              value={first('fillStyle')}
              onPick={(v) => set({ fillStyle: v })}
              options={[
                { value: 'solid', title: 'Solid', label: 'Solid' },
                { value: 'hachure', title: 'Hatched', label: 'Hatch' },
                { value: 'cross', title: 'Cross-hatched', label: 'Cross' },
              ]}
            />
          )}
        </PopButton>
      )}
      {has('color') && (
        <PopButton title="Note colour" label={<span className="cv-dot" style={{ background: stickyCss(first('color')), borderRadius: 4 }} />}>
          <div className="cv-pop-label">Sticky colour</div>
          <Swatches colors={STICKY_COLORS} value={first('color')} css={stickyCss} onPick={(c) => set({ color: c })} />
        </PopButton>
      )}
      {has('sw') && (
        <PopButton title="Stroke" label={<SlidersHorizontal />}>
          <div className="cv-pop-label">Thickness</div>
          <Opts
            value={first('sw')}
            onPick={(v) => set({ sw: v })}
            options={[
              { value: 1, title: 'Thin', label: line(1.2) },
              { value: 2, title: 'Medium', label: line(2.4) },
              { value: 4, title: 'Bold', label: line(4) },
            ]}
          />
          {has('dash') && (
            <>
              <div className="cv-pop-label">Style</div>
              <Opts
                value={first('dash')}
                onPick={(v) => set({ dash: v })}
                options={[
                  { value: 'solid', title: 'Solid', label: line(2) },
                  { value: 'dashed', title: 'Dashed', label: line(2, '5 3') },
                  { value: 'dotted', title: 'Dotted', label: line(2.4, '0.1 4') },
                ]}
              />
              <div className="cv-pop-label">Sloppiness</div>
              <Opts
                value={first('rough')}
                onPick={(v) => set({ rough: v })}
                options={[
                  { value: 0, title: 'Clean', label: sloppy(0) },
                  { value: 1, title: 'Sketchy', label: sloppy(1) },
                  { value: 2, title: 'Wild', label: sloppy(2) },
                ]}
              />
            </>
          )}
          {has('round') && (
            <>
              <div className="cv-pop-label">Corners</div>
              <Opts
                value={first('round')}
                onPick={(v) => set({ round: v })}
                options={[
                  { value: false, title: 'Sharp', label: 'Sharp' },
                  { value: true, title: 'Round', label: 'Round' },
                ]}
              />
            </>
          )}
        </PopButton>
      )}
      {has('heads') && (
        <PopButton title="Arrowheads & path" label={<Spline />}>
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
              { value: false, title: 'Straight segments', label: 'Straight' },
              { value: true, title: 'Smooth curve through bends', label: 'Curved' },
            ]}
          />
        </PopButton>
      )}
      {has('font') && (
        <PopButton title="Text" label={<Type />}>
          <div className="cv-pop-label">Font</div>
          <Opts
            value={first('font')}
            onPick={(v) => set({ font: v })}
            options={[
              { value: 'hand', title: 'Hand-drawn', label: <span style={{ fontFamily: "'Caveat Variable', cursive", fontSize: 17 }}>Hand</span> },
              { value: 'sans', title: 'Normal', label: 'Sans' },
              { value: 'mono', title: 'Code', label: <span style={{ fontFamily: 'var(--font-mono)' }}>Mono</span> },
            ]}
          />
          <div className="cv-pop-label">Size</div>
          <Opts
            value={first('fs')}
            onPick={(v) => set({ fs: v })}
            options={[
              { value: 14, title: 'Small', label: 'S' },
              { value: 20, title: 'Medium', label: 'M' },
              { value: 28, title: 'Large', label: 'L' },
              { value: 40, title: 'Extra large', label: 'XL' },
            ]}
          />
          {has('align') && (
            <Opts
              value={first('align')}
              onPick={(v) => set({ align: v })}
              options={[
                { value: 'left', title: 'Align left', label: <AlignLeft size={15} /> },
                { value: 'center', title: 'Centre', label: <AlignCenter size={15} /> },
                { value: 'right', title: 'Align right', label: <AlignRight size={15} /> },
              ]}
            />
          )}
        </PopButton>
      )}
      {sel.length > 0 && (
        <>
          <div className="cv-sep" />
          <PopButton title="Arrange" label={<Layers />}>
            {(close) => (
              <>
                <div className="cv-pop-label">Layer</div>
                <div className="cv-opts">
                  <Btn title="Bring to front (Ctrl ])" onClick={() => ctl.order('front')}><ArrowUpToLine /></Btn>
                  <Btn title="Bring forward (])" onClick={() => ctl.order('forward')}><ChevronUp /></Btn>
                  <Btn title="Send backward ([)" onClick={() => ctl.order('backward')}><ChevronDown /></Btn>
                  <Btn title="Send to back (Ctrl [)" onClick={() => ctl.order('back')}><ArrowDownToLine /></Btn>
                </div>
                {multi && (
                  <>
                    <div className="cv-pop-label">Align</div>
                    <div className="cv-opts">
                      <Btn title="Align left" onClick={() => ctl.align('left')}><AlignStartVertical /></Btn>
                      <Btn title="Centre horizontally" onClick={() => ctl.align('hcenter')}><AlignCenterVertical /></Btn>
                      <Btn title="Align right" onClick={() => ctl.align('right')}><AlignEndVertical /></Btn>
                      <Btn title="Distribute horizontally" onClick={() => ctl.align('hdist')}><AlignHorizontalDistributeCenter /></Btn>
                    </div>
                    <div className="cv-opts">
                      <Btn title="Align top" onClick={() => ctl.align('top')}><AlignStartHorizontal /></Btn>
                      <Btn title="Centre vertically" onClick={() => ctl.align('vcenter')}><AlignCenterHorizontal /></Btn>
                      <Btn title="Align bottom" onClick={() => ctl.align('bottom')}><AlignEndHorizontal /></Btn>
                      <Btn title="Distribute vertically" onClick={() => ctl.align('vdist')}><AlignVerticalDistributeCenter /></Btn>
                    </div>
                  </>
                )}
                <div className="cv-pop-label">Opacity</div>
                <input
                  className="cv-range"
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  defaultValue={first('opacity') ?? 100}
                  onChange={(e) => ctl.setStyle({ opacity: Number(e.target.value) })}
                  onPointerUp={close}
                />
              </>
            )}
          </PopButton>
          {sel.length === 1 && sel[0].type === 'text' && (
            <Btn
              title={sel[0].md ? 'Reading as markdown — switch to plain text' : 'Read this block as markdown'}
              active={!!sel[0].md}
              onClick={() => ctl.toggleMarkdown()}
            >
              <Hash />
            </Btn>
          )}
          {multi && !grouped && (
            <Btn title="Group (Ctrl G)" onClick={() => ctl.group()}>
              <Group />
            </Btn>
          )}
          {grouped && (
            <Btn title="Ungroup (Ctrl Shift G)" onClick={() => ctl.ungroup()}>
              <Ungroup />
            </Btn>
          )}
          {sel.length === 1 && sel[0].type !== 'note' && sel[0].type !== 'link' && (
            <Btn title={sel[0].link ? `Linked to ${sel[0].link}` : 'Link to a note or web page'} active={!!sel[0].link} onClick={() => ctl.setLink()}>
              {sel[0].link ? <FileText /> : <LinkIcon />}
            </Btn>
          )}
          <Btn title={locked ? 'Unlock (Ctrl Shift L)' : 'Lock (Ctrl Shift L)'} active={locked} onClick={() => ctl.toggleLock()}>
            {locked ? <Lock /> : <LockOpen />}
          </Btn>
          <Btn title="Duplicate (Ctrl D)" onClick={() => ctl.duplicate()}>
            <Copy />
          </Btn>
          <Btn title="Delete (Del)" danger disabled={locked} onClick={() => ctl.deleteSelection()}>
            <Trash2 />
          </Btn>
        </>
      )}
      {!sel.length && mode === 'note' && null}
    </div>
  )
}
