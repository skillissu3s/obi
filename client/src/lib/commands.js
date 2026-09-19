import {
  FilePlus, FolderPlus, CalendarDays, Search, Network, ListChecks, Settings, PanelLeft, PanelRight, Eye, Code2, Sun, Moon,
  Maximize2, SplitSquareHorizontal, X, RefreshCw, Share2, Globe, History, Pencil, Trash2, Copy, Link2, Star, Shuffle,
  Download, Upload, LogOut, ShieldCheck, Command, FolderInput, Keyboard, Plus, LayoutGrid, BookOpen, Undo2, Redo2,
  Bold, Italic, Quote, IndentIncrease, IndentDecrease, Hash, Users, Layers, Palette, Shapes, PencilRuler, PanelLeftOpen,
  Printer,
} from 'lucide-react'
import { indentMore, indentLess, undo, redo } from '@codemirror/commands'
import { yUndoManagerKeymap } from 'y-codemirror.next'
import { openSearchPanel } from '@codemirror/search'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs, PALETTES } from '../store/prefs.js'
import { useUI, toast, confirmDialog } from '../store/ui.js'
import { navigate } from './router.js'
import { isDesktop } from './desktop.js'
import { api } from './api.js'
import { conn } from './socket.js'
import * as A from './actions.js'
import { toggleWrap, insertLink, toggleTask, setHeading, toggleQuote } from '../editor/commands.js'
import { editorCtx } from '../editor/livePreview.js'
import { dirname, isNote, stripExt, basename } from '@shared/paths.js'

function insertWhiteboard() {
  const v = activeView
  if (!v) return
  const sel = v.state.selection.main
  v.state.facet(editorCtx).insertWhiteboard?.(v, sel.from, sel.to)
}

const yUndoCmd = yUndoManagerKeymap[0]?.run
const yRedoCmd = yUndoManagerKeymap[1]?.run

let activeView = null
export const setActiveEditorView = (v) => {
  activeView = v
}
export const getActiveEditorView = () => activeView

const ed = (fn) => () => {
  const v = activeView
  if (!v) return
  fn(v)
  v.focus()
}

function activeNote() {
  const tab = useLayout.getState().activeTab()
  return tab?.kind === 'note' ? tab : null
}

function currentFolder() {
  const s = useApp.getState()
  const configured = s.workspaces.find((w) => w.id === s.wsId)?.settings?.newNoteFolder
  if (configured) return configured
  if (s.selectedPath) {
    const e = s.treeMap.get(s.selectedPath)
    if (e) return e.type === 'folder' ? e.path : dirname(e.path)
  }
  const tab = activeNote()
  return tab && tab.ws === s.wsId ? dirname(tab.path) : ''
}

export function buildCommands() {
  const layout = useLayout.getState()
  const app = useApp.getState()
  const prefs = usePrefs.getState()
  const ui = useUI.getState()
  const note = activeNote()
  const ws = app.workspaces.find((w) => w.id === app.wsId)

  const cmds = [
    { id: 'new-note', name: 'New note', icon: FilePlus, hotkey: 'Mod+N', alt: 'Alt+N', group: 'File', run: () => A.createNote({ folder: currentFolder() }) },
    { id: 'new-note-tab', name: 'New note in new tab', icon: FilePlus, group: 'File', run: () => A.createNote({ folder: currentFolder(), newTab: true }) },
    { id: 'new-folder', name: 'New folder', icon: FolderPlus, group: 'File', run: () => A.createFolder(currentFolder()) },
    { id: 'new-whiteboard', name: 'New whiteboard', icon: Shapes, hotkey: 'Alt+B', group: 'File', run: () => A.createWhiteboard({ folder: currentFolder() }) },
    { id: 'insert-whiteboard', name: 'Insert a new whiteboard into this note', icon: Shapes, group: 'Editor', hidden: !activeView, run: () => insertWhiteboard() },
    { id: 'canvas-tools', name: 'Toggle canvas tools on notes', icon: PencilRuler, hotkey: 'Alt+C', group: 'View', run: () => window.dispatchEvent(new CustomEvent('obi:canvas-bar')) },
    { id: 'new-board', name: 'New board (Kanban)', icon: LayoutGrid, group: 'File', run: async () => {
        const { emptyBoardContent } = await import('./kanban.js')
        A.createNote({ folder: currentFolder(), title: 'Board', content: emptyBoardContent() })
      } },
    { id: 'daily-note', name: "Open today's daily note", icon: CalendarDays, hotkey: 'Mod+D', group: 'File', run: () => A.openDailyNote() },
    { id: 'quick-switch', name: 'Quick switcher: open note', icon: Search, hotkey: 'Mod+O', group: 'Navigate', run: () => ui.openPalette('files') },
    { id: 'command-palette', name: 'Command palette', icon: Command, hotkey: 'Mod+K', group: 'Navigate', run: () => ui.openPalette('commands') },
    { id: 'search', name: 'Search in all notes', icon: Search, hotkey: 'Mod+Shift+F', group: 'Navigate', run: () => layout.setLeftTab('search') },
    { id: 'search-note', name: 'Find in current note', icon: Search, hotkey: 'Mod+F', group: 'Navigate', run: ed((v) => openSearchPanel(v)) },
    { id: 'graph', name: 'Open graph view', icon: Network, hotkey: 'Mod+G', group: 'Navigate', run: () => layout.openView('graph') },
    { id: 'tasks', name: 'Open tasks', icon: ListChecks, group: 'Navigate', run: () => layout.openView('tasks') },
    { id: 'random-note', name: 'Open random note', icon: Shuffle, group: 'Navigate', run: () => {
        const notes = app.tree.filter((e) => e.type === 'file' && isNote(e.path))
        if (notes.length) layout.openNote(app.wsId, notes[Math.floor(Math.random() * notes.length)].path)
      } },
    { id: 'toggle-left', name: 'Toggle left sidebar', icon: PanelLeft, hotkey: 'Mod+\\', group: 'View', run: () => layout.toggleLeft() },
    { id: 'toggle-right', name: 'Toggle right sidebar', icon: PanelRight, hotkey: 'Mod+Shift+\\', group: 'View', run: () => layout.toggleRight() },
    { id: 'toggle-mode', name: 'Toggle reading / editing view', icon: Eye, hotkey: 'Mod+E', group: 'View', run: () => {
        const t = activeNote()
        if (!t) return
        const cur = t.mode || prefs.defaultMode
        layout.updateTab(t.id, { mode: cur === 'read' ? 'live' : 'read' })
      } },
    { id: 'toggle-source', name: 'Toggle markdown source view', icon: Code2, group: 'View', run: () => {
        const t = activeNote()
        if (!t) return
        const cur = t.mode || prefs.defaultMode
        layout.updateTab(t.id, { mode: cur === 'source' ? 'live' : 'source' })
      } },
    // Ctrl/⌘ P would print the live editor, which only renders the lines on
    // screen — so take it over and print the note the way it reads.
    { id: 'print-note', name: 'Print / save as PDF', icon: Printer, hotkey: 'Mod+P', group: 'View', run: () => {
        const t = activeNote()
        if (!t) return window.print()
        layout.updateTab(t.id, { mode: 'read' })
        setTimeout(() => window.print(), 450)
      } },
    { id: 'focus-mode', name: 'Toggle focus mode', icon: Maximize2, hotkey: 'Mod+Shift+Enter', group: 'View', run: () => layout.toggleFocus() },
    { id: 'split-right', name: 'Split right', icon: SplitSquareHorizontal, group: 'View', run: () => layout.splitRight() },
    { id: 'close-tab', name: 'Close tab', icon: X, hotkey: 'Alt+W', group: 'View', run: () => {
        const l = useLayout.getState()
        const pane = l.panes.find((p) => p.id === l.activePane)
        if (pane?.active) l.closeTab(pane.id, pane.active)
      } },
    { id: 'new-tab', name: 'New tab', icon: Plus, hotkey: 'Alt+T', group: 'View', run: () => layout.newTab() },
    { id: 'theme', name: `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme`, icon: document.documentElement.dataset.theme === 'dark' ? Sun : Moon, group: 'View', run: () => prefs.set({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'readable-width', name: prefs.readableWidth ? 'Use full width' : 'Use readable line width', icon: BookOpen, group: 'View', run: () => prefs.set({ readableWidth: !prefs.readableWidth }) },
    ...PALETTES.map((p) => ({
      id: `palette-${p.id}`,
      name: `Colour theme: ${p.name}${prefs.palette === p.id ? ' ✓' : ''}`,
      icon: Palette,
      group: 'Theme',
      run: () => prefs.set({ palette: p.id }),
    })),
    { id: 'settings', name: 'Open settings', icon: Settings, hotkey: 'Mod+,', group: 'App', run: () => ui.openModal('settings') },
    { id: 'workspace-settings', name: 'Workspace settings', icon: Layers, group: 'App', run: () => ui.openModal('settings', { section: 'workspace' }) },
    { id: 'new-workspace', name: isDesktop ? 'Add a vault' : 'Create new workspace', icon: Plus, group: 'App', run: () => ui.openModal('new-workspace') },
    { id: 'switch-workspace', name: 'Switch workspace…', icon: Layers, hotkey: 'Mod+Shift+O', group: 'App', run: () => ui.openPalette('workspaces') },
    { id: 'shortcuts', name: 'Keyboard shortcuts', icon: Keyboard, group: 'App', run: () => ui.openModal('shortcuts') },
    { id: 'export', name: 'Export workspace as .zip', icon: Download, group: 'App', run: () => A.exportWorkspace() },
    { id: 'import', name: 'Import files or .zip…', icon: Upload, group: 'App', run: () => ui.openModal('import') },
    { id: 'logout', name: 'Sign out', icon: LogOut, group: 'App', run: async () => {
        if (!(await confirmDialog({ title: 'Sign out?', confirmText: 'Sign out' }))) return
        await api.logout()
        conn.stop()
        useApp.setState({ user: null })
        navigate('/login')
      } },
  ]

  if (ws?.type === 'github') {
    cmds.push({ id: 'sync', name: 'Sync with GitHub now', icon: RefreshCw, hotkey: 'Mod+S', group: 'App', run: () => A.syncNow() })
  }
  if (app.user?.isAdmin) cmds.push({ id: 'admin', name: 'Open admin console', icon: ShieldCheck, group: 'App', run: () => navigate('/admin') })

  if (note) {
    const bookmarked = A.isBookmarked(note.path, note.ws)
    cmds.push(
      { id: 'rename', name: 'Rename note…', icon: Pencil, hotkey: 'F2', group: 'Note', run: () => A.renameEntry(note.path) },
      { id: 'move', name: 'Move note to folder…', icon: FolderInput, group: 'Note', run: () => ui.openModal('move', { path: note.path }) },
      { id: 'delete', name: 'Delete note', icon: Trash2, group: 'Note', run: () => A.deleteEntry(note.path) },
      { id: 'duplicate', name: 'Duplicate note', icon: Copy, group: 'Note', run: () => A.duplicateNote(note.path) },
      { id: 'bookmark', name: bookmarked ? 'Remove bookmark' : 'Bookmark this note', icon: Star, group: 'Note', run: () => A.toggleBookmark(note.path, note.ws) },
      { id: 'copy-link', name: 'Copy link to note', icon: Link2, group: 'Note', run: () => A.copyNoteLink(note.ws, note.path) },
      { id: 'share', name: 'Share & publish note…', icon: Share2, group: 'Note', run: () => ui.openModal('share', { ws: note.ws, path: note.path }) },
      { id: 'history', name: 'Version history', icon: History, group: 'Note', run: () => ui.openModal('history', { ws: note.ws, path: note.path }) },
      { id: 'reveal', name: 'Reveal note in file explorer', icon: PanelLeft, group: 'Note', run: () => {
          useApp.getState().revealPath(note.path)
          layout.setLeftTab('files')
        } },
      { id: 'insert-template', name: 'Insert template…', icon: Copy, group: 'Note', run: () => ui.openPalette('templates') },
      // editor commands
      { id: 'bold', name: 'Format: bold', icon: Bold, hotkey: 'Mod+B', group: 'Format', run: ed(toggleWrap('**')) },
      { id: 'italic', name: 'Format: italic', icon: Italic, hotkey: 'Mod+I', group: 'Format', run: ed(toggleWrap('*')) },
      { id: 'highlight', name: 'Format: highlight', icon: Pencil, group: 'Format', run: ed(toggleWrap('==')) },
      { id: 'link', name: 'Insert link', icon: Link2, hotkey: 'Mod+K', group: 'Format', run: ed(insertLink) },
      { id: 'toggle-task', name: 'Toggle checkbox', icon: ListChecks, hotkey: 'Mod+Enter', group: 'Format', run: ed(toggleTask) },
      { id: 'h1', name: 'Format: heading 1', icon: Hash, group: 'Format', run: ed(setHeading(1)) },
      { id: 'h2', name: 'Format: heading 2', icon: Hash, group: 'Format', run: ed(setHeading(2)) },
      { id: 'quote', name: 'Format: quote', icon: Quote, group: 'Format', run: ed(toggleQuote) },
      { id: 'indent', name: 'Indent', icon: IndentIncrease, group: 'Format', run: ed(indentMore) },
      { id: 'outdent', name: 'Outdent', icon: IndentDecrease, group: 'Format', run: ed(indentLess) },
      { id: 'undo', name: 'Undo', icon: Undo2, group: 'Format', run: ed((v) => undo(v) || yUndoCmd?.(v)) },
      { id: 'redo', name: 'Redo', icon: Redo2, group: 'Format', run: ed((v) => redo(v) || yRedoCmd?.(v)) },
    )
  }

  for (const w of app.workspaces) {
    if (w.id === app.wsId) continue
    cmds.push({ id: `ws-${w.id}`, name: `Open workspace: ${w.name}`, icon: Layers, group: 'Workspaces', hidden: true, run: () => A.switchWorkspace(w.id) })
  }
  return cmds
}

export function runCommand(id) {
  const cmd = buildCommands().find((c) => c.id === id)
  if (cmd) cmd.run()
  return !!cmd
}

// ---------- global hotkeys ----------
import { matchHotkey } from './util.js'

export function installHotkeys() {
  const handler = (e) => {
    const target = e.target
    const inField = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    const inEditor = target instanceof HTMLElement && target.closest('.cm-editor')
    const ui = useUI.getState()
    if (e.key === 'Escape') {
      const l = useLayout.getState()
      if (l.focus) {
        l.toggleFocus(false)
        return
      }
    }
    if (ui.palette || ui.modal || ui.dialog) return
    for (const cmd of buildCommands()) {
      const combos = [cmd.hotkey, cmd.alt].filter(Boolean)
      for (const combo of combos) {
        if (!matchHotkey(e, combo)) continue
        // let the editor keep its own formatting shortcuts
        if (inEditor && ['bold', 'italic', 'link', 'toggle-task', 'undo', 'redo', 'search-note'].includes(cmd.id)) return
        if (inField && !combo.startsWith('Mod') && !combo.startsWith('Alt')) return
        e.preventDefault()
        e.stopPropagation()
        cmd.run()
        return
      }
    }
  }
  window.addEventListener('keydown', handler)
  const onCommand = (e) => runCommand(e.detail.id)
  window.addEventListener('obi:command', onCommand)
  return () => {
    window.removeEventListener('keydown', handler)
    window.removeEventListener('obi:command', onCommand)
  }
}
