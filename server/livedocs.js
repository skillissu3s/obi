import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { newId } from './security.js'
import { applyToYText } from '../shared/textdiff.js'
import { parseBoard, serializeBoard, diffElements } from '../shared/board.js'

export const MSG_SYNC = 0
export const MSG_AWARENESS = 1

const SAVE_DEBOUNCE = 800
const SAVE_MAX_WAIT = 4000
const IDLE_DESTROY = 45000

function header(key, type) {
  const enc = encoding.createEncoder()
  encoding.writeVarString(enc, key)
  encoding.writeVarUint(enc, type)
  return enc
}

// kind 'text' = a markdown note (Y.Text), kind 'board' = a whiteboard or a note's canvas layer (Y.Map of elements)
export class LiveDoc {
  constructor(runtime, path, text, { kind = 'text', layer = false, registry = runtime.docs, key } = {}) {
    this.runtime = runtime
    this.path = path
    this.kind = kind
    this.layer = layer
    this.registry = registry
    this.key = key || `${runtime.id}:${path}`
    this.epoch = newId(10)
    this.ydoc = new Y.Doc({ gc: true })
    if (kind === 'board') {
      // throws BoardParseError for unreadable files — the caller refuses to open (and never overwrites) them
      const elements = parseBoard(text)
      this.ymap = this.ydoc.getMap('elements')
      this.ydoc.transact(() => {
        for (const el of elements) this.ymap.set(el.id, el)
      })
      this.savedText = serializeBoard(elements)
    } else {
      this.ytext = this.ydoc.getText('content')
      if (text) this.ytext.insert(0, text)
      this.savedText = text
    }
    this.awareness = new awarenessProtocol.Awareness(this.ydoc)
    this.awareness.setLocalState(null)
    this.conns = new Map() // socket -> { role, clientIds: Set<number> }
    this.saveTimer = null
    this.firstPendingAt = 0
    this.destroyTimer = null
    this.lastEditor = null
    this.destroyed = false

    this.ydoc.on('update', (update, origin) => {
      const enc = header(this.key, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      const msg = encoding.toUint8Array(enc)
      for (const sock of this.conns.keys()) if (sock !== origin) sock.sendBinary(msg)
      if (origin && origin.user) this.lastEditor = origin.user.id
      if (origin !== 'external') this.scheduleSave()
    })

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed)
      if (origin && this.conns.has(origin)) {
        const c = this.conns.get(origin)
        added.forEach((id) => c.clientIds.add(id))
        removed.forEach((id) => c.clientIds.delete(id))
      }
      const enc = header(this.key, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      const msg = encoding.toUint8Array(enc)
      for (const sock of this.conns.keys()) sock.sendBinary(msg)
    })
  }

  get text() {
    return this.kind === 'board' ? serializeBoard([...this.ymap.values()]) : this.ytext.toString()
  }

  get isEmpty() {
    return this.kind === 'board' ? this.ymap.size === 0 : this.ytext.length === 0
  }

  addConn(sock, role) {
    clearTimeout(this.destroyTimer)
    this.destroyTimer = null
    this.conns.set(sock, { role, clientIds: new Set() })
    sock.sendJSON({ t: 'joined', doc: this.key, epoch: this.epoch, role })
    // server sync step 1
    const enc = header(this.key, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, this.ydoc)
    sock.sendBinary(encoding.toUint8Array(enc))
    const states = [...this.awareness.getStates().keys()]
    if (states.length) {
      const a = header(this.key, MSG_AWARENESS)
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states))
      sock.sendBinary(encoding.toUint8Array(a))
    }
    this.runtime.presenceChanged()
  }

  setRole(sock, role) {
    const c = this.conns.get(sock)
    if (c) c.role = role
  }

  removeConn(sock) {
    const c = this.conns.get(sock)
    if (!c) return
    this.conns.delete(sock)
    if (c.clientIds.size) awarenessProtocol.removeAwarenessStates(this.awareness, [...c.clientIds], null)
    this.runtime.presenceChanged()
    if (this.conns.size === 0 && !this.destroyed) {
      this.destroyTimer = setTimeout(() => this.destroy(), IDLE_DESTROY)
    }
  }

  handleMessage(sock, decoder, type) {
    const conn = this.conns.get(sock)
    if (!conn) return
    if (type === MSG_SYNC) {
      const syncType = decoding.peekVarUint(decoder)
      if (conn.role === 'viewer' && syncType !== syncProtocol.messageYjsSyncStep1) return
      const enc = header(this.key, MSG_SYNC)
      const base = encoding.length(enc)
      syncProtocol.readSyncMessage(decoder, enc, this.ydoc, sock)
      if (encoding.length(enc) > base) sock.sendBinary(encoding.toUint8Array(enc))
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), sock)
    }
  }

  scheduleSave() {
    const t = Date.now()
    if (!this.firstPendingAt) this.firstPendingAt = t
    clearTimeout(this.saveTimer)
    const wait = t - this.firstPendingAt > SAVE_MAX_WAIT ? 0 : SAVE_DEBOUNCE
    this.saveTimer = setTimeout(() => this.runtime.saveFromDoc(this).catch((e) => console.error('[doc save]', e)), wait)
  }

  // Called by runtime (under lock) to persist
  takePending() {
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.firstPendingAt = 0
    const text = this.text
    if (text === this.savedText) return null
    this.savedText = text
    return text
  }

  // Replace content coming from outside the doc (git pull, rename link updates, task toggles…)
  applyExternal(text) {
    if (this.kind === 'board') {
      let next
      try {
        next = parseBoard(text)
      } catch {
        return // leave the live board alone if the incoming file is unreadable
      }
      const { set, del } = diffElements([...this.ymap.values()], next)
      if (set.length || del.length) {
        this.ydoc.transact(() => {
          for (const id of del) this.ymap.delete(id)
          for (const el of set) this.ymap.set(el.id, el)
        }, 'external')
      }
      this.savedText = serializeBoard(next)
      return
    }
    applyToYText(this.ytext, text, 'external')
    this.savedText = text
  }

  // Notify connected clients and drop the doc (file moved/deleted)
  evict(reason, extra = {}) {
    for (const sock of this.conns.keys()) sock.sendJSON({ t: 'evicted', doc: this.key, reason, ...extra })
    for (const sock of [...this.conns.keys()]) sock.docs?.delete(this.key)
    this.conns.clear()
    this.dispose()
  }

  async destroy() {
    if (this.destroyed || this.conns.size) return
    try {
      await this.runtime.saveFromDoc(this)
    } catch (e) {
      console.error('[doc destroy save]', e)
    }
    if (this.conns.size) return
    this.dispose()
  }

  dispose() {
    if (this.destroyed) return
    this.destroyed = true
    clearTimeout(this.saveTimer)
    clearTimeout(this.destroyTimer)
    if (this.registry.get(this.path) === this) this.registry.delete(this.path)
    this.awareness.destroy()
    this.ydoc.destroy()
    this.runtime.presenceChanged()
  }
}
