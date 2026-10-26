import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MousePointer2, Hand, Square, Circle, Diamond, MoveUpRight, Minus, Pencil, Highlighter, Type, Heading, StickyNote, ImagePlus, Link2,
  Frame, Eraser, Pointer, Lock, LockOpen, ChevronsDown,
} from 'lucide-react'
import { useController } from './CanvasLayer.jsx'
import { QuickBar, styleSubjects, keepFocus } from './QuickBar.jsx'

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

const TOOL_BY_ID = Object.fromEntries(TOOLS.filter((t) => t !== 'sep').map((t) => [t.id, t]))

// The bar shows one button per group, with the group's tool last used on it.
// Pointing at the button lifts the group's tools into a small tray above it;
// picking one there takes it (and brings up its settings). Clicking the button
// takes the tool it shows. On a touch screen, with no pointing, tapping the
// button of the tool in hand opens the tray. Every tool keeps its shortcut.
const GROUPS = [
  ['select'], ['hand'], 'sep',
  ['rect', 'ellipse', 'diamond', 'line'], ['arrow'], 'sep',
  ['pen', 'marker', 'laser'], ['eraser'], 'sep',
  ['text', 'mdtext'], ['sticky'], 'sep',
  ['image', 'note'], ['frame'],
]
const OPEN_DELAY = 110 // pointing in passing, across the bar, opens nothing
const CLOSE_DELAY = 220 // time to move from the button up into the tray

export function Toolbar({ ctl, extra, onCollapse }) {
  const state = useController(ctl)
  const readOnly = ctl.readOnly
  // each group's tool last used
  const [last, setLast] = useState({})
  const [tray, setTray] = useState(null) // { group, anchor }
  const timer = useRef(0)
  useEffect(() => {
    const g = GROUPS.findIndex((grp) => grp !== 'sep' && grp.length > 1 && grp.includes(state.tool))
    if (g >= 0 && last[g] !== state.tool) setLast((l) => ({ ...l, [g]: state.tool }))
  }, [state.tool, last])
  // the tool's own settings bar steps aside while a tray is up (they share the space)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('obi:tool-tray', { detail: { ctl, open: !!tray } }))
  }, [tray, ctl])
  useEffect(() => () => clearTimeout(timer.current), [])
  const later = (fn, ms) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }
  const hold = () => clearTimeout(timer.current)
  const close = () => later(() => setTray(null), CLOSE_DELAY)
  const usable = (id) => !(readOnly && !['select', 'hand', 'laser'].includes(id))
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
      {GROUPS.map((grp, i) => {
        if (grp === 'sep') return <div key={i} className="cv-sep" />
        const shown = grp.includes(state.tool) ? state.tool : last[i] || grp[0]
        const t = TOOL_BY_ID[shown]
        const active = grp.includes(state.tool)
        const many = grp.length > 1
        return (
          <button
            key={i}
            className={`cv-tool ${active ? 'active' : ''} ${many ? 'has-more' : ''} ${tray?.group === i ? 'tray-open' : ''}`}
            title={many ? undefined : `${t.label} (${t.key})`}
            aria-label={t.label}
            aria-haspopup={many ? 'menu' : undefined}
            disabled={!usable(shown)}
            onPointerEnter={(e) => {
              if (e.pointerType === 'touch') return
              const anchor = e.currentTarget
              if (!many) return tray && close()
              // from one open tray straight to the next; else after a moment's pointing
              if (tray) {
                hold()
                setTray({ group: i, anchor })
              } else later(() => setTray({ group: i, anchor }), OPEN_DELAY)
            }}
            onPointerLeave={(e) => e.pointerType !== 'touch' && (tray ? close() : hold())}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              if (many && active && e.nativeEvent.pointerType === 'touch') return setTray((f) => (f ? null : { group: i, anchor: e.currentTarget }))
              // picking the tool you already have shows or hides its settings
              if (state.tool === shown) window.dispatchEvent(new CustomEvent('obi:tool-settings', { detail: ctl }))
              ctl.setTool(shown)
              hold()
              setTray(null)
            }}
          >
            <t.icon key={shown} className="cv-tool-icon" />
            {many && <span className="cv-more-dot" aria-hidden="true" />}
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
      {tray && tray.anchor.isConnected && (
        <Popover anchor={tray.anchor} className="bare" onClose={() => setTray(null)}>
          <Tray
            key={tray.group}
            ids={GROUPS[tray.group]}
            current={state.tool}
            usable={usable}
            onEnter={hold}
            onLeave={close}
            onPick={(id) => {
              ctl.setTool(id)
              hold()
              setTray(null)
            }}
          />
        </Popover>
      )}
    </div>
  )
}

// A group's tools, in a row, the name of the one pointed at (or in hand) under
// them. Every name is laid in the same spot and only one shows, so the tray is as
// wide as its longest name from the start and never changes size under the pointer.
function Tray({ ids, current, usable, onEnter, onLeave, onPick }) {
  const [hover, setHover] = useState(null)
  const named = TOOL_BY_ID[hover || (ids.includes(current) ? current : ids[0])]
  return (
    <div className="cv-tray" role="menu" onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <div className="cv-tray-row">
        {ids.map((id, n) => {
          const t = TOOL_BY_ID[id]
          return (
            <button
              key={id}
              role="menuitem"
              className={`cv-tray-item ${current === id ? 'active' : ''}`}
              style={{ animationDelay: `${n * 22}ms` }}
              aria-label={t.label}
              disabled={!usable(id)}
              onPointerEnter={() => setHover(id)}
              onPointerLeave={() => setHover(null)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(id)}
            >
              <t.icon />
            </button>
          )
        })}
      </div>
      <div className="cv-tray-name">
        {ids.map((id) => {
          const t = TOOL_BY_ID[id]
          return (
            <span key={id} className={t === named ? 'on' : ''} aria-hidden={t !== named}>
              <span>{t.label.split(' — ')[0]}</span>
              <kbd>{t.key}</kbd>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ---------- popovers ----------

function Popover({ anchor, onClose, side = false, avoid = null, persistent = false, className = '', children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return undefined
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = ref.current.offsetWidth
      if (side) {
        // Beside the button on a selection's corner, clear of the selection
        // (`avoid`) so what is being styled stays in view: to the right of both
        // if there is room, else to the left of both, from the button's top down.
        const a = avoid?.getBoundingClientRect()
        const right = Math.max(r.right, a?.right ?? -Infinity)
        const leftEdge = Math.min(r.left, a?.left ?? Infinity)
        const left = right + 8 + w <= window.innerWidth - 8 ? right + 8 : leftEdge - 8 - w >= 8 ? leftEdge - 8 - w : Math.max(8, window.innerWidth - w - 8)
        const maxHeight = window.innerHeight - 16
        const h = Math.min(ref.current.scrollHeight, maxHeight)
        setPos({ left, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - h - 8)), maxHeight })
        return
      }
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
      // Pinned by its bottom edge, just above the button it belongs to, so it
      // grows upward when its content changes (the fill pattern appears, say)
      // and never runs off the bottom; a tall panel scrolls instead.
      setPos({ left, bottom: window.innerHeight - r.top + 8, maxHeight: Math.max(160, r.top - 16) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, side, avoid])
  useEffect(() => {
    if (persistent) return undefined
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
  }, [anchor, onClose, persistent])
  return createPortal(
    <div ref={ref} className={`cv-pop ${className}`} style={pos || { left: -9999, top: -9999 }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={keepFocus}>
      {children}
    </div>,
    document.body,
  )
}

// ---------- the tool's settings ----------

// A drawing tool's settings sit in a short bar right above its button for as
// long as it is in hand (picking the tool again hides or shows it). A selection's
// float above the selection instead: SelectionBar (CanvasLayer.jsx).
export function StyleBar({ ctl }) {
  const state = useController(ctl)
  const rootRef = useRef(null)
  const [toolAnchor, setToolAnchor] = useState(null)
  const [hidden, setHidden] = useState(null)
  const [trayUp, setTrayUp] = useState(false)
  useEffect(() => setHidden(null), [state.tool])
  useEffect(() => {
    const on = (e) => e.detail.ctl === ctl && setTrayUp(e.detail.open)
    window.addEventListener('obi:tool-tray', on)
    return () => window.removeEventListener('obi:tool-tray', on)
  }, [ctl])
  useEffect(() => {
    const flip = (e) => e.detail === ctl && setHidden((h) => (h ? null : ctl.getState().tool))
    window.addEventListener('obi:tool-settings', flip)
    return () => window.removeEventListener('obi:tool-settings', flip)
  }, [ctl])
  useLayoutEffect(() => {
    const dock = rootRef.current?.closest('.cv-dock')
    const next = dock?.querySelector('.cv-tool.active') || null
    if (next !== toolAnchor) setToolAnchor(next)
  })
  const { sel, subjects } = styleSubjects(ctl, state)
  const tool = state.tool
  const show = !ctl.readOnly && !state.editing && !state.panning && !sel.length && subjects.length > 0 && hidden !== tool && !trayUp
  return (
    <span ref={rootRef} style={{ display: 'contents' }}>
      {show && toolAnchor && (
        <Popover anchor={toolAnchor} persistent className="bare" onClose={() => {}}>
          <QuickBar ctl={ctl} tool={tool} sel={sel} subjects={subjects} up />
        </Popover>
      )}
    </span>
  )
}
