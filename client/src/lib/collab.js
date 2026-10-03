// Who is where: the people sharing a workspace right now, and — for the note in
// front — where each of them is in it.
//
// Two sources, both already on the wire:
//  • the server's presence map (path → people who have that file open), for
//    everyone, everywhere in the workspace;
//  • the note's awareness (Yjs), for the people in this note: their editor's
//    caret, which exists only while they are in the text.
import * as Y from 'yjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { useApp } from '../store/app.js'

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/

// the character offset of someone's caret in this note, or null
function caretIndex(handle, cursor) {
  if (!cursor?.head || !handle.ytext) return null
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.head), handle.ydoc)
    return abs && abs.type === handle.ytext ? abs.index : null
  } catch {
    return null
  }
}

// the line a caret is on and the heading it sits under
function placeOf(view, index) {
  if (!view || index == null) return {}
  const doc = view.state.doc
  const line = doc.lineAt(Math.min(index, doc.length)).number
  let heading = null
  for (let n = line; n >= 1 && !heading; n--) heading = HEADING.exec(doc.line(n).text)?.[1] || null
  return { line, heading }
}

// 'center' to go to someone; 'nearest' to keep one in view, with room around the
// caret so its name flag isn't cut off at the edge
export function scrollToCaret(view, index, y = 'center') {
  view.dispatch({ effects: EditorView.scrollIntoView(Math.min(index, view.state.doc.length), { y, yMargin: y === 'nearest' ? 96 : 5 }) })
}

/**
 * Everyone else in the workspace, split into those in this note (`here`, with
 * where their caret is) and those in other files (`elsewhere`), and the means
 * to jump to someone or follow them.
 *
 * `handle` is this note's document and `view` its editor; either may be null
 * (a whiteboard has no text to point into). `foreign`: the note belongs to
 * another workspace than the one open, whose presence is not what we hold.
 */
export function useCollaborators({ path, handle, view, foreign = false }) {
  const workspacePresence = useApp((s) => s.presence)
  const presence = foreign ? null : workspacePresence
  const me = useApp((s) => s.user?.id)

  // awareness changes with every caret move: settle it before re-reading
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!handle) return undefined
    let timer = 0
    const changed = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = 0
          setTick((n) => n + 1)
        }, 150)
    }
    const awareness = handle.awareness
    awareness.on('change', changed)
    return () => {
      awareness.off('change', changed)
      clearTimeout(timer)
    }
  }, [handle, handle?.generation])

  const { here, elsewhere } = useMemo(() => {
    const byId = new Map()
    // everyone the server says has this file open …
    for (const u of presence?.[path] || []) if (u.id !== me) byId.set(u.id, { user: u, index: null })
    // … and where the carets are, for those whose awareness has arrived
    if (handle) {
      const own = handle.ydoc.clientID
      for (const [clientId, st] of handle.awareness.getStates()) {
        if (clientId === own || !st?.user || st.user.id === me) continue
        const index = caretIndex(handle, st.cursor)
        const prev = byId.get(st.user.id)
        // one person with the note open twice: the editor they are typing in wins
        if (prev?.index != null && index == null) continue
        byId.set(st.user.id, { user: { id: st.user.id, name: st.user.name, color: st.user.color }, index })
      }
    }
    const here = [...byId.values()].map((p) => ({ ...p, ...placeOf(view, p.index) }))
    const other = new Map()
    for (const [p, users] of Object.entries(presence || {})) {
      if (p === path) continue
      for (const u of users) {
        if (u.id === me || byId.has(u.id)) continue
        if (!other.has(u.id)) other.set(u.id, { user: u, paths: [] })
        other.get(u.id).paths.push(p)
      }
    }
    return { here, elsewhere: [...other.values()] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, me, path, handle, view, tick])

  // ----- following someone: the view goes where their caret goes -----
  const [followId, setFollowId] = useState(null)
  const lastSeen = useRef(null)
  const followed = followId ? here.find((p) => p.user.id === followId) : null
  useEffect(() => {
    if (!followId) return
    // gone from the note: stop following
    if (!followed) return setFollowId(null)
    if (view && followed.index != null && followed.index !== lastSeen.current) {
      lastSeen.current = followed.index
      scrollToCaret(view, followed.index, 'nearest')
    }
  }, [followId, followed, view])

  const jump = useCallback(
    (person) => {
      if (view && person.index != null) scrollToCaret(view, person.index)
    },
    [view],
  )
  const follow = useCallback(
    (person) => {
      lastSeen.current = null
      setFollowId((id) => (id === person.user.id ? null : person.user.id))
    },
    [],
  )

  return { here, elsewhere, followed, jump, follow, stopFollowing: () => setFollowId(null) }
}
