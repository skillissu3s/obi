import { useSyncExternalStore } from 'react'

const listeners = new Set()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  notify()
}

const subscribe = (cb) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useLocation() {
  const path = useSyncExternalStore(subscribe, () => location.pathname)
  const search = useSyncExternalStore(subscribe, () => location.search)
  return { path, search }
}

export function notePathFromUrl(pathname) {
  const m = /^\/w\/([^/]+)(?:\/(.*))?$/.exec(pathname)
  if (!m) return null
  let path = m[2] || ''
  try {
    path = decodeURIComponent(path)
  } catch {}
  return { ws: m[1], path }
}

export function urlForNote(ws, path) {
  return `/w/${ws}${path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''}`
}
