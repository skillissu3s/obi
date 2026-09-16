import { WebSocketServer } from 'ws'
import * as decoding from 'lib0/decoding'
import { userFromCookieHeader } from './auth.js'
import { workspaceRole, noteRole } from './access.js'
import { getRuntime, peekRuntime } from './runtime.js'
import { registerSocket, unregisterSocket } from './hub.js'
import { publicUser } from './users.js'
import { normalizePath } from '../shared/paths.js'
import { IS_PROD } from './config.js'

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname !== '/ws') return socket.destroy()
    const origin = req.headers.origin
    if (origin) {
      let host
      try {
        host = new URL(origin).host
      } catch {
        host = ''
      }
      const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean).flatMap((h) => String(h).split(','))
      if (!allowed.map((h) => h.trim()).includes(host) && IS_PROD) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        return socket.destroy()
      }
    }
    const user = userFromCookieHeader(req.headers.cookie)
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user))
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, 30000)
  heartbeat.unref()
  return wss
}

function onConnection(ws, user) {
  ws.isAlive = true
  const sock = {
    ws,
    user,
    docs: new Map(),
    wanted: new Set(),
    subs: new Set(),
    sendJSON(msg) {
      if (ws.readyState === 1) ws.send(JSON.stringify(msg))
    },
    sendBinary(buf) {
      if (ws.readyState === 1) ws.send(buf)
    },
    close(code, reason) {
      ws.close(code, reason)
    },
  }
  registerSocket(sock)
  sock.sendJSON({ t: 'hello', user: publicUser(user) })

  ws.on('pong', () => (ws.isAlive = true))
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      try {
        const buf = data instanceof Buffer ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)])
        const decoder = decoding.createDecoder(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        const key = decoding.readVarString(decoder)
        const doc = sock.docs.get(key)
        if (!doc || doc.destroyed) return
        const type = decoding.readVarUint(decoder)
        doc.handleMessage(sock, decoder, type)
      } catch (e) {
        console.error('[ws binary]', e.message)
      }
      return
    }
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    handleJSON(sock, msg).catch((e) => {
      sock.sendJSON({ t: 'error', doc: msg.doc, ws: msg.ws, error: e.message || 'Error' })
    })
  })
  ws.on('close', () => {
    for (const doc of sock.docs.values()) doc.removeConn(sock)
    sock.docs.clear()
    for (const id of sock.subs) peekRuntime(id)?.subscribers.delete(sock)
    sock.subs.clear()
    unregisterSocket(sock)
  })
}

async function handleJSON(sock, msg) {
  switch (msg.t) {
    case 'ping':
      return sock.sendJSON({ t: 'pong' })
    case 'sub': {
      if (!workspaceRole(sock.user.id, msg.ws)) throw new Error('Workspace not found')
      const rt = await getRuntime(msg.ws)
      rt.subscribers.add(sock)
      sock.subs.add(msg.ws)
      return sock.sendJSON({ t: 'subbed', ws: msg.ws, presence: rt.presence(), sync: rt.type === 'github' ? rt.syncStatus() : null })
    }
    case 'unsub': {
      peekRuntime(msg.ws)?.subscribers.delete(sock)
      sock.subs.delete(msg.ws)
      return
    }
    case 'join': {
      const path = normalizePath(msg.path)
      if (!path) throw new Error('Invalid path')
      const key = `${msg.ws}:${path}`
      const role = noteRole(sock.user.id, msg.ws, path)
      if (!role) return sock.sendJSON({ t: 'error', doc: key, error: 'Note not found or access denied', code: 404 })
      sock.wanted.add(key)
      const rt = await getRuntime(msg.ws)
      let doc
      try {
        doc = await rt.openDoc(path)
      } catch (e) {
        sock.wanted.delete(key)
        return sock.sendJSON({ t: 'error', doc: key, error: e.message, code: e.status || 500 })
      }
      if (!sock.wanted.has(key)) return
      const prev = sock.docs.get(key)
      if (prev) prev.removeConn(sock)
      sock.docs.set(key, doc)
      doc.addConn(sock, role)
      return
    }
    case 'leave': {
      sock.wanted.delete(msg.doc)
      const doc = sock.docs.get(msg.doc)
      if (doc) {
        sock.docs.delete(msg.doc)
        doc.removeConn(sock)
      }
      return
    }
  }
}
