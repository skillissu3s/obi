import { create } from 'zustand'

let seq = Date.now()
const newTabId = () => `t${(seq++).toString(36)}`

const PERSIST_KINDS = new Set(['note', 'graph', 'tasks'])
const isMobile = () => window.matchMedia('(max-width: 768px)').matches

function emptyPane(id = 'main') {
  return { id, tabs: [], active: null }
}

export const useLayout = create((set, get) => ({
  wsId: null,
  panes: [emptyPane()],
  activePane: 'main',
  left: !isMobile(),
  right: !isMobile() && window.innerWidth > 1280,
  leftTab: 'files',
  rightTab: 'outline',
  focus: false,
  leftWidth: Number(localStorage.getItem('obi:leftWidth')) || 272,
  rightWidth: Number(localStorage.getItem('obi:rightWidth')) || 300,

  // ----- persistence -----
  loadFor(wsId) {
    const cur = get()
    if (cur.wsId) persist(cur, true)
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem(`obi:layout:${wsId}`) || 'null')
    } catch {}
    if (saved?.panes?.length) {
      const panes = saved.panes.map((p) => ({ ...p, tabs: p.tabs.filter((t) => PERSIST_KINDS.has(t.kind)).map((t) => ({ ...t, back: [], fwd: [], line: undefined })) }))
      for (const p of panes) if (!p.tabs.some((t) => t.id === p.active)) p.active = p.tabs[0]?.id || null
      const nonEmpty = panes.filter((p, i) => p.tabs.length || i === 0)
      set({ wsId, panes: nonEmpty, activePane: nonEmpty.some((p) => p.id === saved.activePane) ? saved.activePane : nonEmpty[0].id })
    } else {
      set({ wsId, panes: [emptyPane()], activePane: 'main' })
    }
  },

  // ----- selectors -----
  activeTab() {
    const s = get()
    const pane = s.panes.find((p) => p.id === s.activePane) || s.panes[0]
    return pane?.tabs.find((t) => t.id === pane.active) || null
  },

  // ----- tabs -----
  openNote(ws, path, opts = {}) {
    const s = get()
    const paneId = opts.pane || s.activePane
    const panes = s.panes.map((p) => ({ ...p, tabs: [...p.tabs] }))
    let pane = panes.find((p) => p.id === paneId) || panes[0]
    const existing = pane.tabs.find((t) => t.kind === 'note' && t.ws === ws && t.path === path)
    if (existing && !opts.newTab) {
      const idx = pane.tabs.indexOf(existing)
      pane.tabs[idx] = { ...existing, line: opts.line, focusTitle: opts.focusTitle, nonce: Date.now() }
      pane.active = existing.id
    } else {
      const current = pane.tabs.find((t) => t.id === pane.active)
      if (!opts.newTab && current && (current.kind === 'note' || current.kind === 'home') && !current.pinned) {
        const idx = pane.tabs.indexOf(current)
        const back = current.kind === 'note' ? [...(current.back || []), { ws: current.ws, path: current.path }].slice(-50) : current.back || []
        pane.tabs[idx] = { ...current, kind: 'note', ws, path, back, fwd: [], line: opts.line, mode: opts.mode, focusTitle: opts.focusTitle, nonce: Date.now() }
      } else {
        const tab = { id: newTabId(), kind: 'note', ws, path, back: [], fwd: [], line: opts.line, mode: opts.mode, focusTitle: opts.focusTitle }
        const idx = current ? pane.tabs.indexOf(current) + 1 : pane.tabs.length
        pane.tabs.splice(idx, 0, tab)
        pane.active = tab.id
      }
    }
    set({ panes, activePane: pane.id })
    persist(get())
    if (isMobile()) set({ left: false, right: false })
  },

  openView(kind, opts = {}) {
    const s = get()
    const panes = s.panes.map((p) => ({ ...p, tabs: [...p.tabs] }))
    const pane = panes.find((p) => p.id === (opts.pane || s.activePane)) || panes[0]
    const existing = pane.tabs.find((t) => t.kind === kind)
    if (existing) pane.active = existing.id
    else {
      const tab = { id: newTabId(), kind, ...opts.props }
      const current = pane.tabs.find((t) => t.id === pane.active)
      if (current?.kind === 'home') {
        pane.tabs[pane.tabs.indexOf(current)] = tab
      } else pane.tabs.push(tab)
      pane.active = tab.id
    }
    set({ panes, activePane: pane.id })
    persist(get())
    if (isMobile()) set({ left: false, right: false })
  },

  newTab() {
    const s = get()
    const panes = s.panes.map((p) => ({ ...p, tabs: [...p.tabs] }))
    const pane = panes.find((p) => p.id === s.activePane) || panes[0]
    const tab = { id: newTabId(), kind: 'home' }
    pane.tabs.push(tab)
    pane.active = tab.id
    set({ panes })
  },

  setActive(paneId, tabId) {
    set({ panes: get().panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)), activePane: paneId })
    persist(get())
  },

  focusPane(paneId) {
    if (get().activePane !== paneId) set({ activePane: paneId })
  },

  updateTab(tabId, patch) {
    set({ panes: get().panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) })) })
    persist(get())
  },

  closeTab(paneId, tabId) {
    const s = get()
    let panes = s.panes.map((p) => {
      if (p.id !== paneId) return p
      const idx = p.tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return p
      const tabs = p.tabs.filter((t) => t.id !== tabId)
      let active = p.active
      if (active === tabId) active = tabs[Math.min(idx, tabs.length - 1)]?.id || null
      return { ...p, tabs, active }
    })
    let activePane = s.activePane
    if (panes.length > 1) {
      const empty = panes.find((p) => p.id === paneId && !p.tabs.length)
      if (empty) {
        panes = panes.filter((p) => p !== empty)
        if (activePane === paneId) activePane = panes[0].id
      }
    }
    set({ panes, activePane })
    persist(get())
  },

  closeOthers(paneId, tabId) {
    set({ panes: get().panes.map((p) => (p.id === paneId ? { ...p, tabs: p.tabs.filter((t) => t.id === tabId || t.pinned), active: tabId } : p)) })
    persist(get())
  },

  reorderTab(paneId, fromIdx, toIdx) {
    set({
      panes: get().panes.map((p) => {
        if (p.id !== paneId) return p
        const tabs = [...p.tabs]
        const [t] = tabs.splice(fromIdx, 1)
        tabs.splice(toIdx, 0, t)
        return { ...p, tabs }
      }),
    })
    persist(get())
  },

  moveTabToPane(fromPane, tabId, toPane) {
    const s = get()
    const tab = s.panes.find((p) => p.id === fromPane)?.tabs.find((t) => t.id === tabId)
    if (!tab || fromPane === toPane) return
    let panes = s.panes.map((p) => {
      if (p.id === fromPane) {
        const tabs = p.tabs.filter((t) => t.id !== tabId)
        return { ...p, tabs, active: p.active === tabId ? tabs[0]?.id || null : p.active }
      }
      if (p.id === toPane) return { ...p, tabs: [...p.tabs, tab], active: tab.id }
      return p
    })
    if (panes.length > 1) panes = panes.filter((p) => p.tabs.length || p.id === toPane)
    set({ panes, activePane: toPane })
    persist(get())
  },

  splitRight(tab) {
    const s = get()
    const source = tab || s.activeTab()
    const copy = source ? { ...source, id: newTabId(), back: [], fwd: [] } : { id: newTabId(), kind: 'home' }
    if (s.panes.length >= 2) {
      const other = s.panes.find((p) => p.id !== s.activePane)
      set({ panes: s.panes.map((p) => (p.id === other.id ? { ...p, tabs: [...p.tabs, copy], active: copy.id } : p)), activePane: other.id })
    } else {
      const pane = { id: `pane-${newTabId()}`, tabs: [copy], active: copy.id }
      set({ panes: [...s.panes, pane], activePane: pane.id })
    }
    persist(get())
  },

  navigate(tabId, dir) {
    const s = get()
    const panes = s.panes.map((p) => ({
      ...p,
      tabs: p.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== 'note') return t
        const from = dir < 0 ? t.back || [] : t.fwd || []
        if (!from.length) return t
        const target = from[from.length - 1]
        const rest = from.slice(0, -1)
        const cur = { ws: t.ws, path: t.path }
        return dir < 0
          ? { ...t, ...target, back: rest, fwd: [...(t.fwd || []), cur], line: undefined, nonce: Date.now() }
          : { ...t, ...target, fwd: rest, back: [...(t.back || []), cur], line: undefined, nonce: Date.now() }
      }),
    }))
    set({ panes })
    persist(get())
  },

  renamePaths(ws, from, to) {
    const mapPath = (p) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
    const fix = (h) => (h.ws === ws ? { ...h, path: mapPath(h.path) } : h)
    set({
      panes: get().panes.map((p) => ({
        ...p,
        tabs: p.tabs.map((t) => (t.kind === 'note' && t.ws === ws ? { ...t, path: mapPath(t.path), back: (t.back || []).map(fix), fwd: (t.fwd || []).map(fix) } : t)),
      })),
    })
    persist(get())
  },

  closePaths(ws, path) {
    for (const p of get().panes) {
      for (const t of p.tabs) {
        if (t.kind === 'note' && t.ws === ws && (t.path === path || t.path.startsWith(path + '/'))) get().closeTab(p.id, t.id)
      }
    }
  },

  // ----- chrome -----
  toggleLeft(force) {
    set({ left: force ?? !get().left })
  },
  toggleRight(force) {
    set({ right: force ?? !get().right })
  },
  setLeftTab(leftTab) {
    set({ leftTab, left: true })
  },
  setRightTab(rightTab) {
    set({ rightTab, right: true })
  },
  toggleFocus(force) {
    set({ focus: force ?? !get().focus })
  },
  setWidths(patch) {
    set(patch)
    if (patch.leftWidth) localStorage.setItem('obi:leftWidth', patch.leftWidth)
    if (patch.rightWidth) localStorage.setItem('obi:rightWidth', patch.rightWidth)
  },
}))

let persistTimer
function persist(state, immediate = false) {
  if (!state.wsId) return
  clearTimeout(persistTimer)
  const wsId = state.wsId
  const data = {
    activePane: state.activePane,
    panes: state.panes.map((p) => ({
      id: p.id,
      active: p.active,
      tabs: p.tabs.filter((t) => PERSIST_KINDS.has(t.kind)).map(({ id, kind, ws, path, mode, pinned }) => ({ id, kind, ws, path, mode, pinned })),
    })),
  }
  const write = () => {
    try {
      localStorage.setItem(`obi:layout:${wsId}`, JSON.stringify(data))
    } catch {}
  }
  if (immediate) write()
  else persistTimer = setTimeout(write, 200)
}
