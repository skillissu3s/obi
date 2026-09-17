import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { unionBounds, isLinear, sampleSmooth } from '@shared/boardgeom.js'
import { ElementView } from './ElementView.jsx'
import { visualBounds, visiblePoints, source } from './layout.js'

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }

export function useController(ctl) {
  const subscribe = useCallback((fn) => ctl.subscribe(fn), [ctl])
  const get = useCallback(() => ctl.getState(), [ctl])
  return useSyncExternalStore(subscribe, get)
}

export function usePeers(store) {
  const [peers, setPeers] = useState(() => store.peers())
  useEffect(() => {
    let raf = 0
    const update = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setPeers(store.peers())
      })
    }
    const off = store.onPresence(update)
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
  }, [store])
  return peers
}

// Everything that lives in world space: elements, selection, hints, peers.
export function CanvasLayer({ ctl, ctx, zoom = 1 }) {
  const state = useController(ctl)
  const layout = ctl.layout()
  const peers = usePeers(ctl.store)
  const erasing = state.erasing.length ? new Set(state.erasing) : null
  const editingId = state.editing?.id
  return (
    <>
      {layout.list.map((el) => (
        <ElementView key={el.id} el={el} ctx={ctx} editing={editingId === el.id} erasing={erasing?.has(el.id)} />
      ))}
      {state.draft && <ElementView el={state.draft} ctx={ctx} />}
      <Overlay ctl={ctl} state={state} layout={layout} zoom={zoom} peers={peers} />
    </>
  )
}

function Overlay({ ctl, state, layout, zoom, peers }) {
  const inv = 1 / zoom
  const selected = state.selection.map((id) => layout.byId.get(id)).filter(Boolean)
  const single = selected.length === 1 ? selected[0] : null
  const readOnly = ctl.readOnly
  const showHandles = !readOnly && !state.editing && state.tool === 'select' && !state.panning
  const hover = state.hover && !state.selection.includes(state.hover) && state.tool === 'select' ? layout.byId.get(state.hover) : null

  let box = null
  if (selected.length) box = unionBounds(selected.map(visualBounds))
  const pad = 6 * inv

  return (
    <div className="cv-overlay" style={{ '--inv': inv }}>
      {hover && !state.panning && <SelBox b={visualBounds(hover)} pad={pad} soft />}
      {selected.length > 1 && selected.map((el) => <SelBox key={el.id} b={visualBounds(el)} pad={2 * inv} soft locked={el.locked} />)}
      {box && !(single && isLinear(single) && single.type !== 'pen') && (
        <SelBox b={box} pad={pad} locked={selected.every((el) => el.locked)} />
      )}
      {showHandles && box && !(single && isLinear(single) && single.type !== 'pen') && !selected.every((el) => el.locked) &&
        HANDLES.filter((h) => !(single?.type === 'text' && (h === 'n' || h === 's'))).map((h) => {
          const x = box.x - pad + (h.includes('w') ? 0 : h.includes('e') ? box.w + pad * 2 : box.w / 2 + pad)
          const y = box.y - pad + (h.includes('n') ? 0 : h.includes('s') ? box.h + pad * 2 : box.h / 2 + pad)
          return <div key={h} className="cv-handle" data-handle={h} style={{ left: x, top: y, cursor: HANDLE_CURSOR[h] }} />
        })}
      {single && isLinear(single) && single.type !== 'pen' && <PointHandles el={single} show={showHandles && !single.locked} />}
      {state.marquee && <div className="cv-marquee" style={rectStyle(state.marquee)} />}
      {state.bindHint && <div className="cv-bind-hint" style={rectStyle(state.bindHint, 4 * inv)} />}
      {state.snapLines.map((l, i) => (
        <div key={i} className="cv-snap" style={{ left: l.x, top: l.y, width: Math.max(l.w, inv), height: Math.max(l.h, inv) }} />
      ))}
      {state.laser.length > 1 && <Laser points={state.laser} color="#ff4d6d" inv={inv} />}
      {peers.map((p) => (
        <Peer key={p.clientId} peer={p} layout={layout} inv={inv} pad={pad} />
      ))}
    </div>
  )
}

function SelBox({ b, pad, soft, locked }) {
  return <div className={`cv-sel-box ${soft ? 'soft' : ''} ${locked ? 'locked' : ''}`} style={{ left: b.x - pad, top: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2 }} />
}

function PointHandles({ el, show }) {
  const pts = visiblePoints(el)
  const src = source(el)
  const trace = el.curve && pts.length > 2 ? sampleSmooth(pts, 8) : null
  return (
    <>
      {show &&
        pts.slice(0, -1).map((p, i) => {
          // midpoint handle to add a bend
          let m = [(p[0] + pts[i + 1][0]) / 2, (p[1] + pts[i + 1][1]) / 2]
          if (trace) m = trace[Math.min(trace.length - 1, i * 8 + 4)]
          return <div key={`m${i}`} className="cv-handle mid" data-handle="mid" data-id={el.id} data-index={i} style={{ left: m[0], top: m[1], cursor: 'copy' }} />
        })}
      {pts.map((p, i) => {
        const bound = (i === 0 && src.start) || (i === pts.length - 1 && src.end)
        return (
          <div
            key={i}
            className={`cv-handle point ${bound ? 'bound' : ''}`}
            data-handle={show ? 'point' : undefined}
            data-id={el.id}
            data-index={i}
            style={{ left: p[0], top: p[1], cursor: show ? 'move' : 'default', pointerEvents: show ? 'auto' : 'none' }}
          />
        )
      })}
    </>
  )
}

function Laser({ points, color, inv }) {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
  return (
    <svg className="cv-laser">
      <path d={d} style={{ fill: 'none', stroke: color, strokeWidth: 4 * inv, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.85, filter: `drop-shadow(0 0 ${3 * inv}px ${color})` }} />
    </svg>
  )
}

function Peer({ peer, layout, inv, pad }) {
  const color = peer.user?.color || '#888'
  const sel = (peer.selection || []).map((id) => layout.byId.get(id)).filter(Boolean)
  return (
    <>
      {sel.map((el) => {
        const b = visualBounds(el)
        return <div key={el.id} className="cv-sel-box" style={{ left: b.x - pad, top: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, borderColor: color }} />
      })}
      {peer.laser?.length > 1 && <Laser points={peer.laser} color={color} inv={inv} />}
      {peer.x != null && (
        <div className="cv-cursor" style={{ transform: `translate(${peer.x}px, ${peer.y}px) scale(${inv})` }}>
          <svg viewBox="0 0 16 16">
            <path d="M1 1l5.5 14 2.2-5.8L14.5 7z" fill={color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span style={{ background: color }}>{peer.user?.name}</span>
        </div>
      )}
    </>
  )
}

function rectStyle(r, pad = 0) {
  return { left: r.x - pad, top: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 }
}
