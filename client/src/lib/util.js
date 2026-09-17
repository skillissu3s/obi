// ---------- fuzzy matching ----------
export function fuzzyScore(query, text) {
  if (!query) return { score: 1, indices: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) {
    const indices = Array.from({ length: q.length }, (_, i) => direct + i)
    const atWord = direct === 0 || /[\s/_\-.]/.test(t[direct - 1])
    return { score: 1000 - direct * 2 - (t.length - q.length) * 0.5 + (atWord ? 300 : 0), indices }
  }
  let ti = 0
  let score = 0
  let streak = 0
  const indices = []
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    if (c === ' ') continue
    let found = -1
    while (ti < t.length) {
      if (t[ti] === c) {
        found = ti
        break
      }
      ti++
    }
    if (found < 0) return null
    indices.push(found)
    const atWord = found === 0 || /[\s/_\-.]/.test(t[found - 1])
    streak = indices.length > 1 && indices[indices.length - 2] === found - 1 ? streak + 1 : 0
    score += 10 + streak * 8 + (atWord ? 20 : 0)
    ti++
  }
  return { score: score - t.length * 0.2, indices }
}

export function fuzzyFilter(items, query, getText, limit = 100) {
  if (!query) return items.slice(0, limit).map((item) => ({ item, score: 0, indices: [] }))
  const out = []
  for (const item of items) {
    const r = fuzzyScore(query, getText(item))
    if (r) out.push({ item, ...r })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

// ---------- dates ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (n, l = 2) => String(n).padStart(l, '0')

export function formatDate(date, fmt = 'YYYY-MM-DD') {
  const d = date instanceof Date ? date : new Date(date)
  const map = {
    YYYY: d.getFullYear(),
    YY: String(d.getFullYear()).slice(2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: d.getMonth() + 1,
    DD: pad(d.getDate()),
    D: d.getDate(),
    dddd: DAYS[d.getDay()],
    ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  }
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss/g, (m, lit) => (lit != null ? lit : String(map[m])))
}

export function isoDate(d = new Date()) {
  return formatDate(d, 'YYYY-MM-DD')
}

export function timeAgo(ts) {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// ---------- misc ----------
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const modKey = isMac ? '⌘' : 'Ctrl'

export function hotkeyLabel(combo) {
  return combo
    .split('+')
    .map((k) => (k === 'Mod' ? modKey : k === 'Shift' ? (isMac ? '⇧' : 'Shift') : k === 'Alt' ? (isMac ? '⌥' : 'Alt') : k))
    .join(isMac ? '' : '+')
}

export function matchHotkey(e, combo) {
  const parts = combo.split('+')
  const key = parts.pop()
  const mod = parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  const modPressed = isMac ? e.metaKey : e.ctrlKey
  if (mod !== modPressed || shift !== e.shiftKey || alt !== e.altKey) return false
  if (!isMac && e.metaKey) return false
  const k = key.length === 1 ? key.toLowerCase() : key
  const ek = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (ek === k) return true
  // Alt on mac changes e.key; fall back to code
  if (key.length === 1 && e.code === `Key${key.toUpperCase()}`) return true
  if (key === '\\' && e.code === 'Backslash') return true
  return false
}

export function debounce(fn, ms) {
  let t
  const d = (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
  d.cancel = () => clearTimeout(t)
  return d
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
  return Promise.resolve()
}

export function colorFor(str) {
  const palette = ['#2f9e78', '#d1703f', '#c0913a', '#2a93a3', '#b8604f', '#5566cf', '#96549e', '#7f9a44', '#c26a8a', '#4f8f6d']
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

export function readingTime(words) {
  const m = Math.max(1, Math.round(words / 230))
  return `${m} min read`
}

export function countWords(text) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return m ? m.length : 0
}

export function downloadUrl(url) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Markdown line -> readable one-liner (search hits, mention snippets, previews).
export function plainSnippet(text, max = 160) {
  return String(text || '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/-]\]\s*)?/, '')
    .replace(/^\s*>+\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
