// The app's background: a colour, a gradient or your own picture on one fixed
// layer behind everything (styles/wallpaper.css draws it from the variables
// below). Preferences keep a small description; everything the layer needs is
// worked out here. No DOM is touched until applyWallpaper runs.

export const DEFAULT_WALLPAPER = {
  kind: 'none', // none | colour | gradient | own (a picture from this device)
  value: '', // colour and own: a hex colour (own: the picture's average); gradient: a preset id
  blur: 0, // px, pictures only
  dim: 35, // % of the theme's own background laid over the picture
  panelOpacity: 60, // % — how solid the panels (sidebar, bars, notes, tasks, calendar) stay, within the floor below
  fit: 'cover', // cover | contain | tile
  position: 'center', // top | center | bottom: which part of a cropped picture stays in view
}

export const PANEL_MIN = 35
// Everything that carries text (the notes, the Tasks and Calendar pages, the sidebar, the bars) is covered by at
// least this much of the theme's own background, the dim counted. With the secondary text colours that
// styles/wallpaper.css lifts over a picture, that keeps body text at WCAG AA and secondary text at 3:1 even over
// a pure white picture in a dark theme or a pure black one in a light theme.
const PLATE_COVER = 0.8
// the least solid those may be, given the dim
export const plateFloor = (dim) => Math.max(0, Math.round(100 * (1 - (1 - PLATE_COVER) / (1 - dim / 100))))

export const COLOURS = ['#0f172a', '#1e293b', '#3b0764', '#064e3b', '#7f1d1d', '#78350f', '#e2e8f0', '#fef3c7', '#dbeafe', '#fce7f3']

export const GRADIENTS = [
  { id: 'dusk', name: 'Dusk', color: '#1b1035', image: 'radial-gradient(at 15% 10%, #7c3aed 0, transparent 55%), radial-gradient(at 85% 85%, #f97316 0, transparent 50%)' },
  { id: 'aurora', name: 'Aurora', color: '#06201f', image: 'radial-gradient(at 20% 15%, #10b981 0, transparent 55%), radial-gradient(at 80% 25%, #3b82f6 0, transparent 50%), radial-gradient(at 50% 100%, #8b5cf6 0, transparent 55%)' },
  { id: 'ocean', name: 'Ocean', color: '#06283d', image: 'linear-gradient(160deg, #0ea5e9 0%, #1e3a8a 55%, #0f172a 100%)' },
  { id: 'ember', name: 'Ember', color: '#2a0a0a', image: 'radial-gradient(at 80% 10%, #f59e0b 0, transparent 50%), radial-gradient(at 10% 90%, #dc2626 0, transparent 55%)' },
  { id: 'meadow', name: 'Meadow', color: '#10281a', image: 'linear-gradient(150deg, #bef264 0%, #22c55e 45%, #065f46 100%)' },
  { id: 'orchid', name: 'Orchid', color: '#2a0f2e', image: 'radial-gradient(at 0% 0%, #f0abfc 0, transparent 55%), radial-gradient(at 100% 100%, #6366f1 0, transparent 55%)' },
  { id: 'slate', name: 'Slate', color: '#1e2530', image: 'linear-gradient(135deg, #475569 0%, #1e293b 55%, #0f172a 100%)' },
  { id: 'peach', name: 'Peach', color: '#fff1e6', image: 'radial-gradient(at 20% 20%, #fdba74 0, transparent 55%), radial-gradient(at 85% 80%, #fda4af 0, transparent 55%)' },
  { id: 'mist', name: 'Mist', color: '#e8eef5', image: 'linear-gradient(160deg, #e0f2fe 0%, #c7d2fe 60%, #f5d0fe 100%)' },
  { id: 'sand', name: 'Sand', color: '#f4ead7', image: 'linear-gradient(150deg, #fde68a 0%, #fbcfe8 100%)' },
]

// ---------- what is stored ----------

const HEX = /^#[0-9a-f]{6}$/i
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback)
const clamp = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback)
const is = (re, v) => typeof v === 'string' && re.test(v)

// Whatever was stored — nothing, an older shape, something hand-edited or synced
// from another version — becomes a complete, in-range description. (Photos from
// online sources were dropped: a background stored as one becomes none.)
export function normalizeWallpaper(raw) {
  const w = raw && typeof raw === 'object' ? raw : {}
  let kind = pick(w.kind, ['none', 'colour', 'gradient', 'own'], 'none')
  let value = ''
  if (kind === 'colour' || kind === 'own') value = is(HEX, w.value) ? w.value.toLowerCase() : ''
  if (kind === 'gradient') value = GRADIENTS.some((g) => g.id === w.value) ? w.value : ''
  if (kind !== 'none' && !value) kind = 'none'
  const d = DEFAULT_WALLPAPER
  return {
    kind,
    value,
    blur: clamp(w.blur, 0, 40, d.blur),
    dim: clamp(w.dim, 0, 80, d.dim),
    panelOpacity: clamp(w.panelOpacity, PANEL_MIN, 100, d.panelOpacity),
    fit: pick(w.fit, ['cover', 'contain', 'tile'], d.fit),
    position: pick(w.position, ['top', 'center', 'bottom'], d.position),
  }
}

// ---------- what the layer needs ----------

export const isPhoto = (w) => w.kind === 'own'

// The CSS variables that describe the background, or null for none. `own` is the
// picture kept on this device ({ url }), if it has been loaded.
export function wallpaperVars(w, own = null) {
  let image = 'none'
  let color = 'transparent'
  if (w.kind === 'colour') color = w.value
  else if (w.kind === 'gradient') {
    const g = GRADIENTS.find((x) => x.id === w.value)
    if (!g) return null
    image = g.image
    color = g.color
  } else if (w.kind === 'own') {
    color = w.value
    if (own) image = `url(${JSON.stringify(own.url)})`
  } else return null
  return {
    '--wp-image': image,
    '--wp-color': color,
    '--wp-blur': `${isPhoto(w) ? w.blur : 0}px`,
    '--wp-dim': `${w.dim}%`,
    // the Panel setting, never below the floor: for the frame (sidebar, bars) and for the pages (notes, tasks, calendar)
    '--wp-panel': `${Math.max(w.panelOpacity, plateFloor(w.dim))}%`,
    '--wp-pane': `${Math.max(w.panelOpacity, plateFloor(w.dim))}%`,
    '--wp-size': { cover: 'cover', contain: 'contain', tile: 'auto' }[w.fit],
    '--wp-repeat': w.fit === 'tile' ? 'repeat' : 'no-repeat',
    '--wp-pos': `center ${w.position}`,
  }
}

let ownImage = null // { url, color }: the picture kept on this device, once loaded
const ownListeners = new Set()
export function setOwnImage(o) {
  ownImage = o
  for (const fn of ownListeners) fn()
}
export const getOwnImage = () => ownImage
// for useSyncExternalStore: the settings show the picture as soon as it has been read
export const subscribeOwnImage = (fn) => (ownListeners.add(fn), () => ownListeners.delete(fn))

let applied = ''
// Forgets what the first paint reads, and that the page already shows what it shows: the next apply writes it again.
export function clearWallpaperCache() {
  applied = ''
  try {
    localStorage.removeItem('obi:wp')
  } catch {}
}
// Puts the background on the page. Also keeps what the first paint needs in
// localStorage, so the next load starts with the background already there.
export function applyWallpaper(w) {
  const vars = wallpaperVars(w, ownImage)
  const key = JSON.stringify(vars)
  if (key === applied) return
  applied = key
  const root = document.documentElement
  for (let i = root.style.length - 1; i >= 0; i--) if (root.style[i].startsWith('--wp-')) root.style.removeProperty(root.style[i])
  if (vars) {
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    root.dataset.wallpaper = ''
  } else delete root.dataset.wallpaper
  try {
    // an object URL does not survive a reload, so a device picture is remembered as its average colour
    if (vars) localStorage.setItem('obi:wp', JSON.stringify(w.kind === 'own' ? { ...vars, '--wp-image': 'none' } : vars))
    else localStorage.removeItem('obi:wp')
  } catch {}
}
