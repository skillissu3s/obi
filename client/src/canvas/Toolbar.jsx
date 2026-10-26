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

// The bar shows one button per group; a group's other tools are in a little menu
// above it (its corner caret, or the button again once its tool is in hand). The
// button shows the group's tool last used. Every tool keeps its shortcut.
const GROUPS = [
  ['select'], ['hand'], 'sep',
  ['rect', 'ellipse', 'diamond', 'line'], ['arrow'], 'sep',
  ['pen', 'marker', 'laser'], ['eraser'], 'sep',
  ['text', 'mdtext'], ['sticky'], 'sep',
  ['image', 'note'], ['frame'],
]

export function Toolbar({ ctl, extra, onCollapse }) {
  const state = useController(ctl)
  const readOnly = ctl.readOnly
  // each group's tool last used
  const [last, setLast] = useState({})
  const [flyout, setFlyout] = useState(null) // { group, anchor }
  useEffect(() => {
    const g = GROUPS.findIndex((grp) => grp !== 'sep' && grp.length > 1 && grp.includes(state.tool))
    if (g >= 0 && last[g] !== state.tool) setLast((l) => ({ ...l, [g]: state.tool }))
  }, [state.tool, last])
  const usable = (id) => !(readOnly && !['select', 'hand', 'laser'].includes(id))
  return (
    <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
      {GROUPS.map((grp, i) => {
        if (grp === 'sep') return <div key={i} className="cv-sep" />
        const shown = grp.includes(state.tool) ? state.tool : last[i] || grp[0]
        const t = TOOL_BY_ID[shown]
        const active = grp.includes(state.tool)
        const many = grp.length > 1
        const openFly = (anchor) => setFlyout((f) => (f?.group === i ? null : { group: i, anchor }))
        return (
          <button
            key={i}
            className={`cv-tool ${active ? 'active' : ''} ${many ? 'has-more' : ''}`}
            title={`${t.label} (${t.key})${many ? ' — more in the corner' : ''}`}
            aria-label={t.label}
            disabled={!usable(shown)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              if (many && active) return openFly(e.currentTarget)
              // picking the tool you already have shows or hides its settings
              if (state.tool === shown) window.dispatchEvent(new CustomEvent('obi:tool-settings', { detail: ctl }))
              ctl.setTool(shown)
              setFlyout(null)
            }}
          >
            <t.icon />
            {many && (
              <span
                className="cv-caret"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation()
                  openFly(e.currentTarget.parentElement)
                }}
              />
            )}
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
      {flyout && flyout.anchor.isConnected && (
        <Popover anchor={flyout.anchor} onClose={() => setFlyout(null)}>
          <div className="cv-flyout" role="menu">
            {GROUPS[flyout.group].map((id) => {
              const t = TOOL_BY_ID[id]
              return (
                <button
                  key={id}
                  role="menuitem"
                  className={`cv-flyout-item ${state.tool === id ? 'active' : ''}`}
                  disabled={!usable(id)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    ctl.setTool(id)
                    setFlyout(null)
                  }}
                >
                  <t.icon />
                  <span>{t.label.split(' — ')[0]}</span>
                  <kbd>{t.key}</kbd>
                </button>
              )
            })}
          </div>
        </Popover>
      )}
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
  useEffect(() => setHidden(null), [state.tool])
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
  const show = !ctl.readOnly && !state.editing && !state.panning && !sel.length && subjects.length > 0 && hidden !== tool
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
