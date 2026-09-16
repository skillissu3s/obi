// Registry of connected sockets per user, for push notifications.
export const userSockets = new Map()

export function registerSocket(sock) {
  let set = userSockets.get(sock.user.id)
  if (!set) userSockets.set(sock.user.id, (set = new Set()))
  set.add(sock)
}

export function unregisterSocket(sock) {
  const set = userSockets.get(sock.user.id)
  if (!set) return
  set.delete(sock)
  if (!set.size) userSockets.delete(sock.user.id)
}

export function notifyUser(userId, msg) {
  const set = userSockets.get(userId)
  if (set) for (const s of set) s.sendJSON(msg)
}

export function disconnectUser(userId) {
  const set = userSockets.get(userId)
  if (set) for (const s of set) s.close(4001, 'Session ended')
}

export function onlineUserIds() {
  return new Set(userSockets.keys())
}
