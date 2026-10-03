import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Eye, EyeOff, FileText, LocateFixed, Users, X } from 'lucide-react'
import { basename, dirname, stripExt } from '@shared/paths.js'
import { useLayout } from '../store/layout.js'
import { useApp } from '../store/app.js'
import { Avatar, AvatarStack } from './ui.jsx'

// A popover under its button, right edges aligned (these buttons sit at the
// right of a header). Closes on a click outside or Escape.
function Popover({ anchor, onClose, children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const r = anchor.getBoundingClientRect()
    const w = ref.current.offsetWidth
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)), top: r.bottom + 6 })
  }, [anchor])
  useEffect(() => {
    const down = (e) => {
      if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose()
    }
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className="people-pop" style={pos || { left: -9999, top: -9999 }}>
      {children}
    </div>,
    document.body,
  )
}

// someone typing has a caret; anyone else just has it open
const placeText = (p) => (p.index == null ? 'Viewing' : ['Editing', p.line && `line ${p.line}`, p.heading].filter(Boolean).join(' · '))

// a button inside a clickable row: it does its own thing, not the row's
const own = (fn) => (e) => {
  e.stopPropagation()
  fn()
}

function Row({ person, children, onClick, title, where }) {
  return (
    <div className={`people-row ${onClick ? 'clickable' : ''}`} title={title} onClick={onClick}>
      <Avatar name={person.user.name} color={person.user.color} size={26} />
      <div className="people-main">
        <div className="people-name">{person.user.name}</div>
        <div className="people-where truncate">{where}</div>
      </div>
      {children && <div className="people-actions">{children}</div>}
    </div>
  )
}

function openFile(path) {
  const { wsId } = useApp.getState()
  useLayout.getState().openNote(wsId, path)
}

// Who else is in the workspace, and where. The people in this note come first
// with where their caret is; the rest say which file they have open.
function PeopleList({ collab, onClose }) {
  const { here, elsewhere, followed, jump, follow } = collab
  return (
    <>
      {here.length > 0 && <div className="people-label">In this note</div>}
      {here.map((p) => (
        <Row
          key={p.user.id}
          person={p}
          where={placeText(p)}
          title={p.index != null ? 'Go to their cursor' : undefined}
          onClick={p.index != null ? () => jump(p) : undefined}
        >
          {p.index != null && (
            <>
              <button className="people-act" title="Go to their cursor" onClick={own(() => jump(p))}>
                <LocateFixed />
              </button>
              <button
                className={`people-act ${followed?.user.id === p.user.id ? 'on' : ''}`}
                title={followed?.user.id === p.user.id ? 'Stop following' : 'Follow — your view goes where their cursor goes'}
                onClick={own(() => follow(p))}
              >
                {followed?.user.id === p.user.id ? <EyeOff /> : <Eye />}
              </button>
            </>
          )}
        </Row>
      ))}
      {elsewhere.length > 0 && <div className="people-label">Elsewhere in this workspace</div>}
      {elsewhere.map((p) => {
        const path = p.paths[0]
        return (
          <Row
            key={p.user.id}
            person={p}
            title={`Open ${path}`}
            onClick={() => {
              openFile(path)
              onClose?.()
            }}
            where={
              <>
                <FileText size={11} /> {stripExt(basename(path))}
                {dirname(path) && <span className="faint"> · {dirname(path)}</span>}
                {p.paths.length > 1 && <span className="faint"> · +{p.paths.length - 1} more</span>}
              </>
            }
          />
        )
      })}
    </>
  )
}

// The header button: the people in this note (or, when it is just you here,
// a quiet count of who is elsewhere), and what you are following.
export function PeopleButton({ collab }) {
  const [anchor, setAnchor] = useState(null)
  const close = useCallback(() => setAnchor(null), [])
  const { here, elsewhere, followed, stopFollowing } = collab
  if (!here.length && !elsewhere.length) return null
  const total = here.length + elsewhere.length
  return (
    <>
      {followed && (
        <span className="follow-chip" style={{ '--c': followed.user.color }} title="Your view goes where their cursor goes">
          Following {followed.user.name}
          <button aria-label="Stop following" onClick={stopFollowing}>
            <X />
          </button>
        </span>
      )}
      <button
        className={`people-btn ${anchor ? 'open' : ''}`}
        title={`${total} other ${total === 1 ? 'person' : 'people'} in this workspace — who is where`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {here.length ? <AvatarStack users={here.map((p) => p.user)} size={22} /> : <Users />}
        {!here.length && <span className="people-count">{elsewhere.length}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close}>
          <PeopleList collab={collab} onClose={close} />
        </Popover>
      )}
    </>
  )
}

// The status bar's version: everyone, by the file they have open. It has no
// note in front of it to point into, so rows open the file.
export function WorkspacePeople({ people }) {
  const [anchor, setAnchor] = useState(null)
  const close = useCallback(() => setAnchor(null), [])
  if (!people.length) return null
  const collab = { here: [], elsewhere: people, followed: null, jump() {}, follow() {} }
  return (
    <>
      <button className="status-item" title={people.map((p) => p.user.name).join(', ')} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <AvatarStack users={people.map((p) => p.user)} size={16} max={5} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close}>
          <PeopleList collab={collab} onClose={close} />
        </Popover>
      )}
    </>
  )
}

// A caret you cannot see is a person you have lost: those scrolled off above or
// below are marked at the edge, and clicking one takes you there.
export function OffscreenCursors({ collab, view, scrollEl }) {
  const [edge, setEdge] = useState({ up: [], down: [] })
  const { here, jump } = collab
  const raf = useRef(0)

  const measure = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const next = { up: [], down: [] }
      if (view && scrollEl) {
        const s = scrollEl.getBoundingClientRect()
        for (const p of here) {
          if (p.index == null) continue
          const block = view.lineBlockAt(Math.min(p.index, view.state.doc.length))
          const top = view.documentTop + block.top * view.scaleY
          if (top + block.height * view.scaleY < s.top + 4) next.up.push(p)
          else if (top > s.bottom - 4) next.down.push(p)
        }
      }
      setEdge((cur) => {
        const same = (a, b) => a.length === b.length && a.every((p, i) => p.user.id === b[i].user.id)
        return same(cur.up, next.up) && same(cur.down, next.down) ? cur : next
      })
    })
  }, [here, view, scrollEl])

  useEffect(() => {
    measure()
    if (!scrollEl) return undefined
    scrollEl.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(scrollEl)
    return () => {
      scrollEl.removeEventListener('scroll', measure)
      ro.disconnect()
      cancelAnimationFrame(raf.current)
    }
  }, [measure, scrollEl])

  const chip = (p, Arrow) => (
    <button key={p.user.id} className="cursor-chip" style={{ '--c': p.user.color }} onClick={() => jump(p)} title={`${p.user.name} — ${placeText(p)}. Click to go there`}>
      <Avatar name={p.user.name} color={p.user.color} size={16} />
      <span className="truncate">{p.user.name}</span>
      <Arrow />
    </button>
  )
  if (!edge.up.length && !edge.down.length) return null
  return (
    <>
      {edge.up.length > 0 && <div className="cursor-chips up">{edge.up.map((p) => chip(p, ArrowUp))}</div>}
      {edge.down.length > 0 && <div className="cursor-chips down">{edge.down.map((p) => chip(p, ArrowDown))}</div>}
    </>
  )
}
