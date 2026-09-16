import { create } from 'zustand'
import { api } from '../lib/api.js'
import { debounce } from '../lib/util.js'

// Full colour themes. `dark`/`light` are only used to draw the preview swatches —
// the real colours live in base.css under [data-palette='…'].
export const PALETTES = [
  { id: 'sumi', name: 'Sumi', note: 'Warm ink & paper', dark: ['#121211', '#ebe7df', '#2f9e78'], light: ['#f6f4ed', '#201d18', '#2f9e78'] },
  { id: 'graphite', name: 'Graphite', note: 'Neutral monochrome', dark: ['#131314', '#e8e8ea', '#8ea2c0'], light: ['#f3f3f5', '#1b1b1e', '#4a648c'] },
  { id: 'midnight', name: 'Midnight', note: 'Deep blue & azure', dark: ['#0d1117', '#e3e8ef', '#4c9aff'], light: ['#edf1f7', '#17202b', '#2f6fd0'] },
  { id: 'nordic', name: 'Nordic', note: 'Cool slate & frost', dark: ['#1a1f26', '#e6ebf2', '#74b6c7'], light: ['#eaeef4', '#1f2733', '#3d8a9e'] },
  { id: 'forest', name: 'Forest', note: 'Pine & amber', dark: ['#0f1411', '#e4ebe4', '#d79a3f'], light: ['#ecf1e9', '#1a201a', '#97671f'] },
  { id: 'ember', name: 'Ember', note: 'Plum & rose', dark: ['#170f12', '#f0e6e6', '#e0607e'], light: ['#f7edef', '#231a1c', '#c04466'] },
  { id: 'mocha', name: 'Mocha', note: 'Coffee & caramel', dark: ['#171310', '#ece2d6', '#c98a4b'], light: ['#f2ebe0', '#221c14', '#9a6528'] },
  { id: 'nebula', name: 'Nebula', note: 'Violet & lilac', dark: ['#131019', '#e9e6f2', '#a78bfa'], light: ['#f2effa', '#1d1926', '#7c5cd6'] },
]

export const ACCENTS = [
  { name: 'Jade', value: '#2f9e78' },
  { name: 'Persimmon', value: '#d1703f' },
  { name: 'Ochre', value: '#c0913a' },
  { name: 'Clay', value: '#b8604f' },
  { name: 'Teal', value: '#2a93a3' },
  { name: 'Indigo', value: '#5566cf' },
  { name: 'Plum', value: '#96549e' },
  { name: 'Graphite', value: '#7c776d' },
]

const PREFS_VERSION = 2
// accents that used to be defaults — cleared once so the palette's own accent shows through
const LEGACY_ACCENTS = new Set(['#8b7cf6', '#4f8cff', '#14b8a6', '#3ecf8e', '#f5a524', '#f26b5b', '#ec5fa8', '#9aa0ab', '#2f9e78'])

export const DEFAULT_PREFS = {
  prefsVersion: PREFS_VERSION,
  theme: 'dark',
  palette: 'sumi',
  accent: null, // null = use the palette's own accent
  fontSize: 16,
  uiScale: 'default',
  editorFont: 'sans',
  readableWidth: true,
  lineHeight: 1.7,
  defaultMode: 'live',
  spellcheck: true,
  lineNumbers: false,
  inlineTitle: true,
  foldHeadings: true,
  strikeDone: true,
  vimMode: false,
  confirmDelete: true,
  sortBy: 'name',
  graph: { showTags: false, showOrphans: true, showUnresolved: false, showAttachments: false, colorFolders: true, repel: 140, linkDistance: 70, nodeSize: 1, labels: 1 },
  bookmarks: {},
}

let LS = {}
try {
  LS = JSON.parse(localStorage.getItem('obi:prefs') || '{}')
} catch {}
// one-off migration from the older colour sets
function migrate(p) {
  if (!p || p.prefsVersion >= PREFS_VERSION) return p
  if (p.accent && LEGACY_ACCENTS.has(String(p.accent).toLowerCase())) p.accent = null
  p.prefsVersion = PREFS_VERSION
  return p
}
migrate(LS)

const saveRemote = debounce((prefs) => {
  api.updateMe({ settings: { prefs } }).catch(() => {})
}, 1200)

export const usePrefs = create((set, get) => ({
  ...DEFAULT_PREFS,
  ...LS,
  graph: { ...DEFAULT_PREFS.graph, ...(LS.graph || {}) },
  set(patch, { remote = true } = {}) {
    set(patch)
    const all = snapshot(get())
    try {
      localStorage.setItem('obi:prefs', JSON.stringify(all))
    } catch {}
    applyPrefs(all)
    if (remote) saveRemote(all)
  },
  hydrate(remotePrefs) {
    if (!remotePrefs) return
    const incoming = migrate({ ...remotePrefs })
    const merged = { ...snapshot(get()), ...incoming, graph: { ...DEFAULT_PREFS.graph, ...(remotePrefs.graph || {}) } }
    set(merged)
    try {
      localStorage.setItem('obi:prefs', JSON.stringify(merged))
    } catch {}
    applyPrefs(merged)
  },
}))

function snapshot(state) {
  const out = {}
  for (const k of Object.keys(DEFAULT_PREFS)) out[k] = state[k]
  return out
}

let mq
let lastTheme = null
export function applyPrefs(p = snapshot(usePrefs.getState())) {
  const root = document.documentElement
  let theme = p.theme
  if (theme === 'system') {
    mq = mq || matchMedia('(prefers-color-scheme: light)')
    theme = mq.matches ? 'light' : 'dark'
    mq.onchange = () => applyPrefs()
  }
  root.dataset.theme = theme
  root.dataset.palette = PALETTES.some((x) => x.id === p.palette) ? p.palette : 'sumi'
  if (p.accent) root.style.setProperty('--accent-user', p.accent)
  else root.style.removeProperty('--accent-user')
  root.style.setProperty('--editor-font-size', `${p.fontSize}px`)
  root.style.setProperty('--editor-line-height', String(p.lineHeight))
  root.dataset.editorFont = p.editorFont
  root.dataset.uiScale = p.uiScale
  const meta = document.querySelector('meta[name="theme-color"]')
  const pal = PALETTES.find((x) => x.id === root.dataset.palette) || PALETTES[0]
  if (meta) meta.content = theme === 'light' ? pal.light[0] : pal.dark[0]
  if (lastTheme !== theme) {
    lastTheme = theme
    window.dispatchEvent(new CustomEvent('obi:theme', { detail: { theme } }))
  }
}
