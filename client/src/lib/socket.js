import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { merge3, applyToYText } from '@shared/textdiff.js'
import { isBoardPath, serializeBoard, mergeBoards, parseBoard, diffElements } from '@shared/board.js'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const KEEP_WARM_MS = 25000

function lighten(hex) {
  return hex + '33'
}

class Emitter {
  constructor() {
    this._l = new Map()
  }
  on(type, fn) {
    if (!this._l.has(type)) this._l.set(type, new Set())
    this._l.get(type).add(fn)
    return () => this._l.get(type)?.delete(fn)
  }
  emit(type, ...args) {
    const set = this._l.get(type)
    if (set) for (const fn of [...set]) fn(...args)
    const any = this._l.get('*')
    if (any && type !== '*') for (const fn of [...any]) fn(type, ...args)
  }
}

export const docKey = (ws, path, kind = 'text') => (kind === 'layer' ? `${ws}:${path}\u0000layer` : `${ws}:${path}`)

// kind 'text' = note (or whiteboard file, by extension); kind 'layer' = the canvas layer of a note
export class DocHandle extends Emitter {
  constructor(conn, ws, path, kind = 'text') {
    super()
    this.conn = conn
    this.ws = ws
    this.path = path
    this.kind = kind
    this.isBoard = kind === 'layer' || isBoardPath(path)
    this.key = docKey(ws, path, kind)
    this.localOrigin = { local: true }
    this.refs = 0
    this.epoch = null
    this.role = null
    this.joined = false
    this.synced = false
    this.error = null
    this.baseText = null
    this.pendingMerge = null
    this.generation = 0
    this.releaseTimer = null
    this.status = 'loading'
    this._createDoc()
  }

  _createDoc() {
    this.ydoc = new Y.Doc()
    if (this.isBoard) {
      this.ymap = this.ydoc.getMap('elements')
      this.undoManager = new Y.UndoManager(this.ymap, { trackedOrigins: new Set([this.localOrigin]), captureTimeout: 400 })
      this.ymap.observe((ev) => this.emit('change', ev))
    } else {
      this.ytext = this.ydoc.getText('content')
      this.undoManager = new Y.UndoManager(this.ytext)
      this.ytext.observe(() => this.emit('change'))
    }
    this.awareness = new awarenessProtocol.Awareness(this.ydoc)
    const u = this.conn.user
    if (u) this.awareness.setLocalStateField('user', { name: u.displayName, color: u.color, colorLight: lighten(u.color), id: u.id })
    this.ydoc.on('update', (update, origin) => {
      if (origin === this || !this.joined) return
      const enc = this._header(MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      this.conn.sendBinary(encoding.toUint8Array(enc))
    })
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin !== 'local' || !this.joined) return
      const changed = added.concat(updated, removed)
      const enc = this._header(MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      this.conn.sendBinary(encoding.toUint8Array(enc))
    })
  }

  _header(type) {
    const enc = encoding.createEncoder()
    encoding.writeVarString(enc, this.key)
    encoding.writeVarUint(enc, type)
    return enc
  }

  get text() {
    return this.isBoard ? serializeBoard([...this.ymap.values()]) : this.ytext.toString()
  }

  get elements() {
    return this.isBoard ? [...this.ymap.values()] : []
  }

  get readOnly() {
    return this.role === 'viewer'
  }

  setStatus(s) {
    this.status = s
    this.emit('status', s)
  }

  join() {
    if (this.conn.connected) this.conn.sendJSON({ t: 'join', ws: this.ws, path: this.path, kind: this.kind })
  }

  onJoined(msg) {
    this.role = msg.role
    this.error = null
    if (this.epoch && this.epoch !== msg.epoch) {
      // The server rebuilt the document (restart/idle unload). Start a fresh CRDT and rebase local edits.
      const local = this.text
      const base = this.baseText ?? local
      this.pendingMerge = local !== base ? { base, local } : null
      this.undoManager.destroy()
      this.awareness.destroy()
      this.ydoc.destroy()
      this._createDoc()
      this.synced = false
      this.generation++
      this.emit('reset')
    }
    this.epoch = msg.epoch
    this.joined = true
    const enc = this._header(MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, this.ydoc)
    this.conn.sendBinary(encoding.toUint8Array(enc))
    // announce our awareness state
    const a = this._header(MSG_AWARENESS)
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]))
    this.conn.sendBinary(encoding.toUint8Array(a))
    this.emit('role', this.role)
  }

  onMessage(type, decoder) {
    if (type === MSG_SYNC) {
      const enc = this._header(MSG_SYNC)
      const base = encoding.length(enc)
      const msgType = syncProtocol.readSyncMessage(decoder, enc, this.ydoc, this)
      if (encoding.length(enc) > base) this.conn.sendBinary(encoding.toUint8Array(enc))
      if (msgType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true
        if (this.pendingMerge) {
          const { base: b, local } = this.pendingMerge
          this.pendingMerge = null
          if (this.role !== 'viewer') {
            if (this.isBoard) this._mergeBoard(b, local)
            else applyToYText(this.ytext, merge3(b, local, this.text), 'merge')
          }
        }
        this.setStatus('ready')
        this.emit('synced')
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this)
    }
  }

  // re-apply offline board edits on top of a rebuilt server document
  _mergeBoard(base, local) {
    const merged = mergeBoards(base, local, this.text)
    if (merged == null) return
    const { set, del } = diffElements(this.elements, parseBoard(merged))
    if (!set.length && !del.length) return
    this.ydoc.transact(() => {
      for (const id of del) this.ymap.delete(id)
      for (const el of set) this.ymap.set(el.id, el)
    }, 'merge')
  }

  onDisconnect() {
    if (this.joined) this.baseText = this.text
    this.joined = false
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.ydoc.clientID)
    if (others.length) awarenessProtocol.removeAwarenessStates(this.awareness, others, 'offline')
    if (this.status === 'ready') this.emit('offline')
  }

  onEvicted(msg) {
    this.joined = false
    if (msg.reason === 'moved') {
      this.emit('moved', msg.to)
    } else if (msg.reason === 'deleted') {
      this.setStatus('deleted')
      this.emit('deleted')
    } else if (msg.reason === 'access') {
      this.error = 'You no longer have access to this note'
      this.setStatus('error')
    } else {
      // server shutting down — rejoin shortly
      this.baseText = this.text
      setTimeout(() => this.refs > 0 && this.join(), 1500)
    }
  }

  onError(msg) {
    this.error = msg.error
    this.setStatus(msg.code === 404 ? 'missing' : 'error')
  }

  whenReady() {
    if (this.status === 'ready') return Promise.resolve(this)
    return new Promise((resolve, reject) => {
      const off = this.on('status', (s) => {
        if (s === 'ready') {
          off()
          resolve(this)
        } else if (s === 'error' || s === 'missing' || s === 'deleted') {
          off()
          reject(new Error(this.error || s))
        }
      })
    })
  }

  destroy() {
    this.joined = false
    this.undoManager.destroy()
    this.awareness.destroy()
    this.ydoc.destroy()
    this.emit('destroyed')
  }
}

class Connection extends Emitter {
  constructor() {
    super()
    this.ws = null
    this.connected = false
    this.docs = new Map()
    this.subs = new Map() // wsId -> refcount
    this.retry = 0
    this.user = null
    this.stopped = true
    this.state = 'idle'
  }

  start(user) {
    this.user = user
    this.stopped = false
    if (!this.ws) this._connect()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    if (this.ws) this.ws.close()
    this.ws = null
    for (const d of this.docs.values()) d.destroy()
    this.docs.clear()
    this.subs.clear()
  }

  setUser(user) {
    this.user = user
    for (const d of this.docs.values()) {
      d.awareness.setLocalStateField('user', { name: user.displayName, color: user.color, colorLight: lighten(user.color), id: user.id })
    }
  }

  _setState(s) {
    this.state = s
    this.emit('connection', s)
  }

  _connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this._setState(this.retry ? 'reconnecting' : 'connecting')
    ws.onopen = () => {
      this.connected = true
      this.retry = 0
      this._setState('online')
      for (const id of this.subs.keys()) this.sendJSON({ t: 'sub', ws: id })
      for (const d of this.docs.values()) if (d.refs > 0 || d.releaseTimer) d.join()
      this.emit('open')
    }
    ws.onclose = (ev) => {
      const wasConnected = this.connected
      this.connected = false
      if (this.ws === ws) this.ws = null
      for (const d of this.docs.values()) d.onDisconnect()
      if (this.stopped) return
      this._setState('offline')
      if (ev.code === 4001) {
        window.dispatchEvent(new CustomEvent('obi:unauthorized'))
        return
      }
      const delay = Math.min(10000, 400 * 2 ** this.retry) + Math.random() * 300
      this.retry++
      this.reconnectTimer = setTimeout(() => this._connect(), wasConnected ? 300 : delay)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        this._onJSON(msg)
      } else {
        const decoder = decoding.createDecoder(new Uint8Array(ev.data))
        const key = decoding.readVarString(decoder)
        const type = decoding.readVarUint(decoder)
        const d = this.docs.get(key)
        if (d) d.onMessage(type, decoder)
      }
    }
  }

  _onJSON(msg) {
    if (msg.doc) {
      const d = this.docs.get(msg.doc)
      if (d) {
        if (msg.t === 'joined') return d.onJoined(msg)
        if (msg.t === 'evicted') return d.onEvicted(msg)
        if (msg.t === 'error') return d.onError(msg)
      }
    }
    this.emit(msg.t, msg)
  }

  sendJSON(msg) {
    if (this.ws && this.connected) this.ws.send(JSON.stringify(msg))
  }

  sendBinary(buf) {
    if (this.ws && this.connected) this.ws.send(buf)
  }

  subscribe(wsId) {
    const n = this.subs.get(wsId) || 0
    this.subs.set(wsId, n + 1)
    if (n === 0) this.sendJSON({ t: 'sub', ws: wsId })
    return () => {
      const c = this.subs.get(wsId) || 0
      if (c <= 1) {
        this.subs.delete(wsId)
        this.sendJSON({ t: 'unsub', ws: wsId })
      } else this.subs.set(wsId, c - 1)
    }
  }

  openDoc(ws, path, kind = 'text') {
    const key = docKey(ws, path, kind)
    let d = this.docs.get(key)
    if (!d || d.status === 'deleted') {
      if (d) this._drop(d)
      d = new DocHandle(this, ws, path, kind)
      this.docs.set(key, d)
      d.join()
    } else if (d.status === 'error' || d.status === 'missing') {
      d.setStatus('loading')
      d.join()
    }
    clearTimeout(d.releaseTimer)
    d.releaseTimer = null
    d.refs++
    return d
  }

  releaseDoc(d) {
    d.refs--
    if (d.refs > 0) return
    clearTimeout(d.releaseTimer)
    d.releaseTimer = setTimeout(() => {
      if (d.refs > 0) return
      this._drop(d)
    }, KEEP_WARM_MS)
  }

  _drop(d) {
    clearTimeout(d.releaseTimer)
    if (this.docs.get(d.key) === d) this.docs.delete(d.key)
    this.sendJSON({ t: 'leave', doc: d.key })
    d.destroy()
  }

  // Is there any doc with local edits not yet confirmed while offline?
  hasUnsyncedChanges() {
    if (this.connected) return false
    for (const d of this.docs.values()) if (d.baseText != null && d.baseText !== d.text) return true
    return false
  }
}

export const conn = new Connection()

window.addEventListener('beforeunload', (e) => {
  if (conn.hasUnsyncedChanges()) {
    e.preventDefault()
    e.returnValue = ''
  }
})
