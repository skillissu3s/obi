import { create } from 'zustand'
import { api } from '../lib/api.js'
import { conn } from '../lib/socket.js'
import { LinkResolver } from '@shared/parse.js'
import { isNote, basename, dirname } from '@shared/paths.js'
import { useLayout } from './layout.js'
import { usePrefs } from './prefs.js'
import { toast } from './ui.js'

export const useApp = create((set, get) => ({
  user: null,
  booting: true,
  workspaces: [],
  wsId: null,
  tree: [],
  treeMap: new Map(),
  notes: new Map(),
  resolver: new LinkResolver(),
  version: 0, // bumps whenever tree or index changes
  loadingWs: false,
  wsError: null,
  initError: null,
  sync: null,
  presence: {},
  connection: 'idle',
  shared: [],
  expanded: new Set(),
  selectedPath: null,

  setUser(user) {
    set({ user })
    if (user) {
      conn.setUser(user)
      usePrefs.getState().hydrate(user.settings?.prefs)
    }
  },

  currentWorkspace() {
    const s = get()
    return s.workspaces.find((w) => w.id === s.wsId) || null
  },

  async loadWorkspaces() {
    const { workspaces } = await api.workspaces()
    set({ workspaces })
    return workspaces
  },

  async loadShared() {
    try {
      const { notes } = await api.shared()
      set({ shared: notes })
    } catch {}
  },

  async openWorkspace(id) {
    const s = get()
    if (s.wsId === id && !s.wsError) return
    if (s.wsId && s.wsId !== id) unsub?.()
    let expanded = new Set()
    try {
      expanded = new Set(JSON.parse(localStorage.getItem(`obi:expanded:${id}`) || '[]'))
    } catch {}
    set({ wsId: id, tree: [], treeMap: new Map(), notes: new Map(), resolver: new LinkResolver(), loadingWs: true, wsError: null, initError: null, presence: {}, sync: null, expanded, version: get().version + 1 })
    localStorage.setItem('obi:lastWs', id)
    useLayout.getState().loadFor(id)
    unsub = conn.subscribe(id)
    try {
      const [t, i] = await Promise.all([api.tree(id), api.index(id)])
      if (get().wsId !== id) return
      get().applyTree(t.entries)
      get().applyIndex(i.notes)
      set({ loadingWs: false, sync: t.sync, initError: t.initError })
    } catch (e) {
      if (get().wsId !== id) return
      set({ loadingWs: false, wsError: e.message })
    }
  },

  async refreshTree() {
    const id = get().wsId
    if (!id) return
    try {
      const t = await api.tree(id)
      if (get().wsId !== id) return
      get().applyTree(t.entries)
      set({ initError: t.initError, sync: t.sync ?? get().sync })
    } catch {}
  },

  async refreshIndex() {
    const id = get().wsId
    if (!id) return
    try {
      const i = await api.index(id)
      if (get().wsId === id) get().applyIndex(i.notes)
    } catch {}
  },

  applyTree(entries) {
    const treeMap = new Map(entries.map((e) => [e.path, e]))
    const resolver = new LinkResolver(entries.filter((e) => e.type === 'file').map((e) => e.path))
    set({ tree: entries, treeMap, resolver, version: get().version + 1 })
  },

  applyIndex(list) {
    set({ notes: new Map(list.map((n) => [n.path, n])), version: get().version + 1 })
  },

  updateNoteIndex(path, meta) {
    const notes = get().notes
    if (meta) notes.set(path, meta)
    else notes.delete(path)
    set({ version: get().version + 1 })
  },

  // optimistic insert (server event will confirm)
  addEntry(path, type = 'file') {
    const s = get()
    if (s.treeMap.has(path)) return
    const entries = [...s.tree, { path, type, size: 0, mtime: Date.now() }]
    let d = dirname(path)
    while (d && !s.treeMap.has(d)) {
      entries.push({ path: d, type: 'folder', size: 0, mtime: Date.now() })
      d = dirname(d)
    }
    get().applyTree(entries)
  },

  setExpanded(path, open) {
    const s = get()
    const expanded = new Set(s.expanded)
    if (open) expanded.add(path)
    else expanded.delete(path)
    set({ expanded })
    localStorage.setItem(`obi:expanded:${s.wsId}`, JSON.stringify([...expanded]))
  },

  revealPath(path) {
    const s = get()
    const expanded = new Set(s.expanded)
    let d = dirname(path)
    while (d) {
      expanded.add(d)
      d = dirname(d)
    }
    set({ expanded, selectedPath: path })
    localStorage.setItem(`obi:expanded:${s.wsId}`, JSON.stringify([...expanded]))
  },

  collapseAll() {
    set({ expanded: new Set() })
    localStorage.setItem(`obi:expanded:${get().wsId}`, '[]')
  },

  setWorkspaceSync(wsId, sync) {
    if (get().wsId === wsId) set({ sync })
  },
}))

let unsub = null

// ---------- connection events ----------
let treeTimer
export function bindConnectionEvents() {
  conn.on('connection', (state) => useApp.setState({ connection: state }))
  let opened = false
  conn.on('open', () => {
    // resync state that may have changed while offline
    const first = !opened
    opened = true
    if (first) return
    const s = useApp.getState()
    if (s.wsId) {
      s.refreshTree()
      s.refreshIndex()
    }
  })
  conn.on('tree', (m) => {
    if (m.ws !== useApp.getState().wsId) return
    clearTimeout(treeTimer)
    treeTimer = setTimeout(() => useApp.getState().refreshTree(), 60)
  })
  conn.on('index', (m) => {
    if (m.ws !== useApp.getState().wsId) return
    useApp.getState().updateNoteIndex(m.path, m.meta)
  })
  conn.on('reindex', (m) => {
    if (m.ws === useApp.getState().wsId) useApp.getState().refreshIndex()
  })
  conn.on('sync', (m) => useApp.getState().setWorkspaceSync(m.ws, m.status))
  conn.on('subbed', (m) => {
    if (m.ws !== useApp.getState().wsId) return
    useApp.setState({ presence: m.presence || {} })
    if (m.sync) useApp.setState({ sync: m.sync })
  })
  conn.on('presence', (m) => {
    if (m.ws === useApp.getState().wsId) useApp.setState({ presence: m.docs })
  })
  conn.on('moved', (m) => {
    useLayout.getState().renamePaths(m.ws, m.from, m.to)
    const s = useApp.getState()
    if (m.ws === s.wsId) {
      const expanded = new Set([...s.expanded].map((p) => (p === m.from ? m.to : p.startsWith(m.from + '/') ? m.to + p.slice(m.from.length) : p)))
      useApp.setState({ expanded })
      const prefs = usePrefs.getState()
      const bm = prefs.bookmarks[m.ws]
      if (bm?.some((p) => p === m.from || p.startsWith(m.from + '/'))) {
        prefs.set({ bookmarks: { ...prefs.bookmarks, [m.ws]: bm.map((p) => (p === m.from ? m.to : p.startsWith(m.from + '/') ? m.to + p.slice(m.from.length) : p)) } })
      }
    }
  })
  conn.on('deleted', (m) => {
    useLayout.getState().closePaths(m.ws, m.path)
  })
  conn.on('workspaces', async (m) => {
    const list = await useApp.getState().loadWorkspaces()
    if (m.invitedTo) toast.info(`${m.invitedTo.by} added you to “${m.invitedTo.name}”`)
    const s = useApp.getState()
    if (s.wsId && !list.some((w) => w.id === s.wsId)) {
      toast.info('You no longer have access to that workspace')
      const next = list[0]
      if (next) s.openWorkspace(next.id)
    }
  })
  conn.on('shared', (m) => {
    useApp.getState().loadShared()
    if (m.note) toast.info(`${m.note.by} shared “${basename(m.note.path).replace(/\.md$/, '')}” with you`)
  })
  conn.on('conflicts', (m) => {
    if (m.ws !== useApp.getState().wsId) return
    toast.info(`Merged remote changes. ${m.conflicts.length} conflicting note${m.conflicts.length > 1 ? 's were' : ' was'} saved as a “conflict” copy.`, { timeout: 9000 })
  })
}

export const noteList = () => {
  const { tree } = useApp.getState()
  return tree.filter((e) => e.type === 'file' && isNote(e.path))
}
