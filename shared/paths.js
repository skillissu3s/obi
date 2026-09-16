// POSIX-style workspace path helpers shared by server and client.

export function normalizePath(p) {
  if (typeof p !== 'string') return null
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  if (!p) return ''
  const parts = p.split('/')
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return null
    if (part.includes('\0')) return null
  }
  return parts.join('/')
}

export const basename = (p) => p.slice(p.lastIndexOf('/') + 1)
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const extname = (p) => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}
export const stripExt = (p) => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? p.slice(0, p.length - (b.length - i)) : p
}
export const isNote = (p) => extname(p) === 'md'
export const noteTitle = (p) => stripExt(basename(p))
export const joinPath = (...parts) => parts.filter(Boolean).join('/')

export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'])
export const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm'])
export const VIDEO_EXT = new Set(['mp4', 'mov', 'mkv', 'ogv'])

export function isHiddenPath(p) {
  return p.split('/').some((s) => s.startsWith('.'))
}

// Sanitise a user supplied file/folder name
export function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#^\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}
