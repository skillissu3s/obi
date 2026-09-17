// Thin reactive wrapper around a board DocHandle (Y.Map of elements).
import { normalizeLinear, isLinear } from '@shared/boardgeom.js'

export const newElementId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
export const newSeed = () => Math.floor(Math.random() * 2 ** 31)

export function createBoardStore(handle) {
  const listeners = new Set()
  let snapshot = null
  let version = 0

  const build = () => {
    const list = [...handle.ymap.values()].sort((a, b) => (a.z || 0) - (b.z || 0) || (a.id < b.id ? -1 : 1))
    snapshot = { list, byId: new Map(list.map((e) => [e.id, e])), version }
    return snapshot
  }

  const onChange = () => {
    version++
    snapshot = null
    for (const fn of [...listeners]) fn()
  }
  const off = handle.on('change', onChange)
  const offReset = handle.on('reset', onChange)

  const store = {
    handle,
    get readOnly() {
      return handle.role === 'viewer'
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getSnapshot() {
      return snapshot || build()
    },
    get(id) {
      return store.getSnapshot().byId.get(id)
    },
    maxZ() {
      const l = store.getSnapshot().list
      return l.length ? l[l.length - 1].z || 0 : 0
    },
    minZ() {
      const l = store.getSnapshot().list
      return l.length ? l[0].z || 0 : 0
    },
    transact(fn) {
      if (store.readOnly) return
      handle.ydoc.transact(fn, handle.localOrigin)
    },
    add(els) {
      const list = Array.isArray(els) ? els : [els]
      store.transact(() => {
        for (const el of list) handle.ymap.set(el.id, clean(el))
      })
    },
    // patches: [[id, patch], ...] — patches merge into the current element
    update(patches) {
      store.transact(() => {
        for (const [id, patch] of patches) {
          const cur = handle.ymap.get(id)
          if (!cur) continue
          let next = { ...cur, ...patch }
          if (isLinear(next) && patch.points) {
            const n = normalizeLinear(next)
            // keep note-anchored lines where they are when their origin shifts
            if (next.dy != null) n.dy = next.dy + (n.y - next.y)
            next = n
          }
          handle.ymap.set(id, clean(next))
        }
      })
    },
    // bookkeeping writes (anchor upkeep) that should not become undo steps
    silentUpdate(patches) {
      if (store.readOnly) return
      handle.ydoc.transact(() => {
        for (const [id, patch] of patches) {
          const cur = handle.ymap.get(id)
          if (cur) handle.ymap.set(id, clean({ ...cur, ...patch }))
        }
      }, 'anchors')
    },
    replace(el) {
      store.transact(() => handle.ymap.set(el.id, clean(el)))
    },
    remove(ids) {
      const set = new Set(ids)
      store.transact(() => {
        for (const id of set) handle.ymap.delete(id)
        // drop bindings that pointed at removed elements
        for (const [id, el] of handle.ymap.entries()) {
          if (set.has(id)) continue
          if ((el.start?.id && set.has(el.start.id)) || (el.end?.id && set.has(el.end.id))) {
            const next = { ...el }
            if (el.start?.id && set.has(el.start.id)) delete next.start
            if (el.end?.id && set.has(el.end.id)) delete next.end
            handle.ymap.set(id, next)
          }
        }
      })
    },
    undo() {
      handle.undoManager.undo()
    },
    redo() {
      handle.undoManager.redo()
    },
    canUndo() {
      return handle.undoManager.undoStack.length > 0
    },
    canRedo() {
      return handle.undoManager.redoStack.length > 0
    },
    // start a new undo step (call at the beginning of each gesture)
    checkpoint() {
      handle.undoManager.stopCapturing()
    },
    // ----- presence -----
    setPresence(patch) {
      const cur = handle.awareness.getLocalState() || {}
      handle.awareness.setLocalState({ ...cur, canvas: { ...(cur.canvas || {}), ...patch } })
    },
    peers() {
      const out = []
      const me = handle.ydoc.clientID
      for (const [id, st] of handle.awareness.getStates()) {
        if (id === me || !st?.canvas || !st.user) continue
        out.push({ clientId: id, user: st.user, ...st.canvas })
      }
      return out
    },
    onPresence(fn) {
      handle.awareness.on('change', fn)
      return () => handle.awareness.off('change', fn)
    },
    destroy() {
      off()
      offReset()
      listeners.clear()
    },
  }
  return store
}

// Drop undefined/transient keys (anything starting with "_") before it reaches the CRDT.
function clean(el) {
  const out = {}
  for (const [k, v] of Object.entries(el)) {
    if (v === undefined || k.startsWith('_')) continue
    out[k] = v
  }
  return out
}
