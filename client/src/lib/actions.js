import { api } from './api.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { toast, confirmDialog, promptDialog, useUI } from '../store/ui.js'
import { basename, dirname, stripExt, joinPath, isNote, safeName, extname } from '@shared/paths.js'
import { isBoardPath, emptyBoard } from '@shared/board.js'
import { formatDate, isoDate, downloadUrl, copyText } from './util.js'
import { fetchNote } from './render.js'
import { conn } from './socket.js'

export const app = () => useApp.getState()
export const layout = () => useLayout.getState()

export function wsSettings(wsId) {
  const s = app()
  const w = s.workspaces.find((x) => x.id === (wsId || s.wsId))
  return w?.settings || {}
}

export function uniquePath(path) {
  const { treeMap } = app()
  if (!treeMap.has(path)) return path
  const ext = extname(path)
  const base = ext ? stripExt(path) : path
  for (let i = 1; i < 999; i++) {
    const cand = ext ? `${base} ${i}.${ext}` : `${base} ${i}`
    if (!treeMap.has(cand)) return cand
  }
  return `${base} ${Date.now()}${ext ? '.' + ext : ''}`
}

export function openPath(ws, path, opts = {}) {
  layout().openNote(ws || app().wsId, path, opts)
}

// Follow a [[wiki link]] or relative markdown link, creating the note when missing.
export async function openLink(ws, fromPath, linkText, opts = {}) {
  const s = app()
  const raw = String(linkText || '')
  const hashIdx = raw.search(/[#^]/)
  const target = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).split('|')[0].trim()
  const subpath = hashIdx >= 0 ? raw.slice(hashIdx) : ''
  if (!target && subpath) {
    scrollToHeading(subpath)
    return
  }
  const resolved = ws === s.wsId ? s.resolver.resolve(decodeTarget(target), fromPath, opts.md ? 'md' : 'wiki') : null
  if (resolved) {
    openPath(ws, resolved, { ...opts, heading: subpath })
    if (subpath) setTimeout(() => scrollToHeading(subpath), 220)
    return
  }
  if (ws !== s.wsId) {
    toast.info('That link points to a note in another workspace')
    return
  }
  // create the missing note next to the current one (Obsidian behaviour)
  const folder = wsSettings().newNoteFolder || dirname(fromPath || '')
  const name = decodeTarget(target).endsWith('.md') ? decodeTarget(target) : `${decodeTarget(target)}.md`
  const path = name.includes('/') ? name : joinPath(folder, name)
  app().addEntry(path)
  app().setPending(ws, path, 'creating')
  openPath(ws, path, opts)
  try {
    await api.writeNote(s.wsId, path, `# ${stripExt(basename(path))}\n\n`, { mustNotExist: true })
    app().clearPending(ws, path)
  } catch (e) {
    app().clearPending(ws, path)
    if (e.status !== 409) {
      app().removeEntry(path)
      layout().closePaths(ws, path)
      toast.error(e)
    }
  }
}

const decodeTarget = (t) => {
  try {
    return decodeURIComponent(t)
  } catch {
    return t
  }
}

export function scrollToHeading(subpath) {
  window.dispatchEvent(new CustomEvent('obi:scroll-to', { detail: { subpath } }))
}

// Creates the note optimistically: it shows up in the tree and opens straight away,
// marked as pending until the server confirms it.
export async function createNote({ folder = '', title, content, open = true, newTab = false } = {}) {
  const s = app()
  const ws = s.wsId
  const base = title ? safeName(title) : 'Untitled'
  const path = uniquePath(joinPath(folder, `${base}.md`))
  s.addEntry(path)
  s.setPending(ws, path, 'creating')
  if (open) layout().openNote(ws, path, { newTab })
  try {
    await api.writeNote(ws, path, content ?? '', { mustNotExist: true })
    app().clearPending(ws, path)
    if (open && !title) layout().updateTab(layout().panes.flatMap((p) => p.tabs).find((t) => t.kind === 'note' && t.ws === ws && t.path === path)?.id, { focusTitle: true })
    return path
  } catch (e) {
    app().clearPending(ws, path)
    app().removeEntry(path)
    layout().closePaths(ws, path)
    toast.error(e)
    return null
  }
}

// A new whiteboard file, created optimistically like notes.
export async function createWhiteboard({ folder = '', title, open = true, newTab = false } = {}) {
  const s = app()
  const ws = s.wsId
  const base = title ? safeName(title) : `Whiteboard ${formatDate(new Date(), 'YYYY-MM-DD HHmm')}`
  const path = uniquePath(joinPath(folder, `${base}.board`))
  s.addEntry(path)
  s.setPending(ws, path, 'creating')
  if (open) layout().openNote(ws, path, { newTab })
  try {
    await api.writeNote(ws, path, emptyBoard(), { mustNotExist: true })
    app().clearPending(ws, path)
    return path
  } catch (e) {
    app().clearPending(ws, path)
    app().removeEntry(path)
    layout().closePaths(ws, path)
    toast.error(e)
    return null
  }
}

export async function createFolder(parent = '') {
  const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmText: 'Create' })
  if (!name) return
  const s = app()
  const ws = s.wsId
  const path = uniquePath(joinPath(parent, safeName(name)))
  s.addEntry(path, 'folder')
  s.setPending(ws, path, 'creating')
  s.setExpanded(path, true)
  try {
    await api.createFolder(ws, path)
    app().clearPending(ws, path)
  } catch (e) {
    app().clearPending(ws, path)
    app().removeEntry(path)
    toast.error(e)
  }
}

export async function renameEntry(path) {
  const entry = app().treeMap.get(path)
  const isFile = entry?.type === 'file'
  const current = basename(path)
  const board = isFile && isBoardPath(path)
  const kind = !isFile ? 'folder' : board ? 'whiteboard' : isNote(path) ? 'note' : 'file'
  const name = await promptDialog({ title: `Rename ${kind}`, value: isFile && (isNote(path) || board) ? stripExt(current) : current, selectBase: true, confirmText: 'Rename' })
  if (!name) return
  const clean = safeName(name)
  if (!clean) return
  const ext = board ? '.board' : isFile && isNote(path) ? '.md' : ''
  const target = joinPath(dirname(path), ext && !clean.toLowerCase().endsWith(ext) ? `${clean}${ext}` : clean)
  return moveTo(path, target)
}

export async function moveEntry(path, destFolder) {
  return moveTo(path, joinPath(destFolder, basename(path)))
}

// Dragging in the tree is easy to do by accident, so a move says what it did
// and offers the way back.
export async function moveEntryWithUndo(path, destFolder) {
  const from = dirname(path)
  const target = await moveEntry(path, destFolder)
  if (!target) return null
  toast.success(`Moved ${basename(path)} to ${destFolder || 'the vault root'}`, {
    timeout: 7000,
    action: { label: 'Undo', run: () => moveEntry(target, from) },
  })
  return target
}

export async function moveTo(path, target) {
  if (target === path) return
  const ws = app().wsId
  app().setPending(ws, path, 'renaming')
  try {
    await api.move(ws, path, target)
    app().clearPending(ws, path)
    layout().renamePaths(ws, path, target)
    app().refreshTree()
    return target
  } catch (e) {
    app().clearPending(ws, path)
    toast.error(e)
    return null
  }
}

export async function deleteEntry(path) {
  const entry = app().treeMap.get(path)
  const isFolder = entry?.type === 'folder'
  const ws = app().workspaces.find((w) => w.id === app().wsId)
  const online = ws?.type === 'online'
  if (usePrefs.getState().confirmDelete) {
    const ok = await confirmDialog({
      title: `Delete “${basename(path)}”?`,
      message: isFolder
        ? 'This deletes the folder and everything inside it.'
        : online
          ? 'You can undo this, or restore it later from Trash in workspace settings.'
          : 'The file is deleted and the change is pushed to GitHub (it stays in the repository history).',
      danger: true,
      confirmText: 'Delete',
    })
    if (!ok) return
  }
  const wsId = app().wsId
  // keep a copy so the undo button can put a file back in a GitHub workspace
  let snapshot = null
  if (!isFolder && !online && (isNote(path) || isBoardPath(path))) {
    try {
      snapshot = (await api.readNote(wsId, path)).content
    } catch {}
  }
  app().setPending(wsId, path, 'deleting')
  try {
    await api.remove(wsId, path)
    app().clearPending(wsId, path)
    layout().closePaths(wsId, path)
    app().refreshTree()
    const undoable = online || snapshot != null
    toast.success(`Deleted ${basename(path)}`, {
      timeout: undoable ? 9000 : 3500,
      action: undoable ? { label: 'Undo', run: () => undoDelete(wsId, path, snapshot, online) } : undefined,
    })
  } catch (e) {
    app().clearPending(wsId, path)
    toast.error(e)
  }
}

// Online workspaces restore from trash (canvas layer and all); GitHub workspaces
// get the file written back from the copy taken just before the delete.
async function undoDelete(wsId, path, snapshot, online) {
  try {
    if (online) {
      const { items } = await api.trash(wsId)
      const item = items.filter((i) => i.path === path).sort((a, b) => b.deletedAt - a.deletedAt)[0]
      if (!item) throw new Error('It is no longer in the trash')
      const r = await api.restoreTrash(wsId, item.id)
      app().refreshTree()
      app().refreshIndex()
      if (r?.path && (isNote(r.path) || isBoardPath(r.path))) layout().openNote(wsId, r.path)
      toast.success(`Restored ${basename(r?.path || path)}`)
      return
    }
    if (snapshot == null) return
    await api.writeNote(wsId, path, snapshot, { mustNotExist: true })
    app().refreshTree()
    app().refreshIndex()
    layout().openNote(wsId, path)
    toast.success(`Restored ${basename(path)}`)
  } catch (e) {
    toast.error(e)
  }
}

export async function duplicateNote(path) {
  const ws = app().wsId
  const target = uniquePath(`${stripExt(path)} copy.md`)
  app().addEntry(target)
  app().setPending(ws, target, 'creating')
  layout().openNote(ws, target)
  try {
    const { content } = await api.readNote(ws, path)
    await api.writeNote(ws, target, content, { mustNotExist: true })
    app().clearPending(ws, target)
  } catch (e) {
    app().clearPending(ws, target)
    app().removeEntry(target)
    layout().closePaths(ws, target)
    toast.error(e)
  }
}

// Duplicate a note or a whiteboard.
export async function duplicateFile(path) {
  if (isNote(path)) return duplicateNote(path)
  const ws = app().wsId
  const ext = extname(path)
  const target = uniquePath(`${stripExt(path)} copy.${ext}`)
  app().addEntry(target)
  app().setPending(ws, target, 'creating')
  try {
    const { content } = await api.readNote(ws, path)
    await api.writeNote(ws, target, content, { mustNotExist: true })
    app().clearPending(ws, target)
    layout().openNote(ws, target)
  } catch (e) {
    app().clearPending(ws, target)
    app().removeEntry(target)
    toast.error(e)
  }
}

export async function uploadFiles(files, { folder } = {}) {
  const s = app()
  const dest = folder ?? wsSettings().attachmentsFolder ?? 'attachments'
  const out = []
  for (const file of files) {
    const stamp = formatDate(new Date(), 'YYYYMMDDHHmmss')
    const clean = safeName(file.name) || 'file'
    const name = /^image\.(png|jpe?g|gif|webp)$/i.test(file.name) || !file.name ? `Pasted image ${stamp}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` : clean
    try {
      const buf = await file.arrayBuffer()
      const { path } = await api.upload(s.wsId, joinPath(dest, name), buf)
      out.push(path)
      s.addEntry(path)
    } catch (e) {
      toast.error(`${file.name}: ${e.message}`)
    }
  }
  return out
}

export function dailyNotePath(date = new Date(), settings = wsSettings()) {
  const folder = settings.dailyFolder ?? 'Daily'
  const fmt = settings.dailyFormat || 'YYYY-MM-DD'
  return joinPath(folder, `${formatDate(date, fmt)}.md`)
}

export async function openDailyNote(date = new Date(), { newTab, announce = false } = {}) {
  const s = app()
  const ws = s.wsId
  const settings = wsSettings()
  const path = dailyNotePath(date, settings)
  if (s.treeMap.has(path)) {
    layout().openNote(ws, path, { newTab })
    return
  }
  // create it optimistically — the tab opens now and fills in when the server confirms
  s.addEntry(path)
  s.setPending(ws, path, 'creating')
  layout().openNote(ws, path, { newTab })
  let content = `# ${formatDate(date, 'dddd, D MMMM YYYY')}\n\n`
  const tpl = settings.dailyTemplate
  if (tpl && s.treeMap.has(tpl)) {
    try {
      content = applyTemplate(await fetchNote(ws, tpl), { date, title: formatDate(date, settings.dailyFormat || 'YYYY-MM-DD') })
    } catch {}
  }
  try {
    await api.writeNote(ws, path, content, { ifMissing: true })
    app().clearPending(ws, path)
    // Browsing the calendar shouldn't quietly leave a note behind for every day
    // you looked at, so say a day was started and offer to take it back.
    if (announce) {
      toast.success(`Started ${formatDate(date, 'ddd D MMM')}`, {
        timeout: 7000,
        action: { label: 'Undo', run: () => discardEmptyDaily(ws, path, content) },
      })
    }
  } catch (e) {
    app().clearPending(ws, path)
    app().removeEntry(path)
    layout().closePaths(ws, path)
    toast.error(e)
  }
}

// Only removes the day again if nothing was written into it.
async function discardEmptyDaily(ws, path, created) {
  try {
    const { content } = await api.readNote(ws, path)
    if (content.trim() !== created.trim()) return toast.info('That day has notes in it now, so it stays')
    layout().closePaths(ws, path)
    await api.remove(ws, path)
    app().removeEntry(path)
    app().refreshTree()
  } catch (e) {
    toast.error(e)
  }
}

export function applyTemplate(text, { date = new Date(), title = '' } = {}) {
  return String(text)
    .replace(/\{\{\s*date\s*(?::\s*([^}]+))?\}\}/gi, (_, f) => formatDate(date, (f || 'YYYY-MM-DD').trim()))
    .replace(/\{\{\s*time\s*(?::\s*([^}]+))?\}\}/gi, (_, f) => formatDate(date, (f || 'HH:mm').trim()))
    .replace(/\{\{\s*title\s*\}\}/gi, title)
    .replace(/\{\{\s*yesterday\s*\}\}/gi, formatDate(new Date(date.getTime() - 86400000), 'YYYY-MM-DD'))
    .replace(/\{\{\s*tomorrow\s*\}\}/gi, formatDate(new Date(date.getTime() + 86400000), 'YYYY-MM-DD'))
}

export function templateFiles() {
  const s = app()
  const folder = wsSettings().templatesFolder ?? 'Templates'
  if (!folder) return []
  return s.tree.filter((e) => e.type === 'file' && isNote(e.path) && (e.path === folder || e.path.startsWith(folder + '/'))).map((e) => e.path)
}

export async function insertTemplateInto(view, templatePath, from, to, notePath = '') {
  try {
    const content = applyTemplate(await fetchNote(app().wsId, templatePath), { title: notePath ? stripExt(basename(notePath)) : '' })
    view.dispatch({ changes: { from, to: to ?? from, insert: content }, selection: { anchor: from + content.length } })
  } catch (e) {
    toast.error(e)
  }
}

export function toggleBookmark(path, ws = app().wsId) {
  const prefs = usePrefs.getState()
  const list = prefs.bookmarks[ws] || []
  const next = list.includes(path) ? list.filter((p) => p !== path) : [...list, path]
  prefs.set({ bookmarks: { ...prefs.bookmarks, [ws]: next } })
  toast.success(list.includes(path) ? 'Removed from bookmarks' : 'Bookmarked')
}

export function isBookmarked(path, ws = app().wsId) {
  return (usePrefs.getState().bookmarks[ws] || []).includes(path)
}

export async function syncNow() {
  const s = app()
  const w = s.workspaces.find((x) => x.id === s.wsId)
  if (w?.type !== 'github') return
  try {
    useApp.setState({ sync: { ...(s.sync || {}), state: 'syncing' } })
    const { sync } = await api.sync(s.wsId)
    useApp.setState({ sync })
    if (sync.state === 'error') toast.error(sync.error)
  } catch (e) {
    toast.error(e)
  }
}

export function openTagSearch(tag) {
  layout().setLeftTab('search')
  window.dispatchEvent(new CustomEvent('obi:search', { detail: { query: `tag:${tag}` } }))
}

export function copyNoteLink(ws, path) {
  copyText(`${location.origin}/w/${ws}/${path.split('/').map(encodeURIComponent).join('/')}`)
  toast.success('Link copied')
}

// streams straight to disk, so we only hold the button busy long enough to acknowledge the click
export async function exportWorkspace() {
  downloadUrl(api.exportUrl(app().wsId))
  await new Promise((r) => setTimeout(r, 900))
  toast.success('Download started')
}

export async function importFiles(files, folder = '') {
  const s = app()
  let count = 0
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      try {
        const r = await api.importZip(s.wsId, await file.arrayBuffer(), folder)
        count += r.imported
      } catch (e) {
        toast.error(e)
      }
    } else {
      const rel = file.webkitRelativePath || file.name
      const path = uniquePath(joinPath(folder, rel.split('/').map(safeName).filter(Boolean).join('/')))
      try {
        await api.upload(s.wsId, path, await file.arrayBuffer(), false)
        count++
      } catch (e) {
        toast.error(e)
      }
    }
  }
  s.refreshTree()
  s.refreshIndex()
  if (count) toast.success(`Imported ${count} file${count === 1 ? '' : 's'}`)
  return count
}

export async function switchWorkspace(id) {
  if (app().wsId === id) return
  await app().openWorkspace(id)
}

export function noteTitleOf(path) {
  return stripExt(basename(path))
}

// Build the context object handed to editor extensions
export function buildEditorCtx(ws, path) {
  return {
    ws,
    path,
    // links only resolve inside the workspace the note belongs to
    resolve: (target) => (ws === app().wsId ? app().resolver.resolve(decodeTarget(target), path, 'wiki') : null),
    linkTextFor: (p) => {
      const text = app().resolver.linkTextFor(p)
      return isNote(p) ? stripExt(text) : text
    },
    fileUrl: (p) => api.fileUrl(ws, p),
    files: () => app().tree.filter((e) => e.type === 'file'),
    aliases: () => {
      const out = []
      for (const [p, meta] of app().notes) for (const a of meta.aliases || []) out.push({ alias: a, path: p })
      return out
    },
    tags: () => tagCounts(),
    headings: (p) => app().notes.get(p)?.headings || [],
    templates: () => templateFiles(),
    insertTemplate: (view, tpl, from, to) => insertTemplateInto(view, tpl, from, to, path),
    openPath: (p, opts = {}) => {
      if (opts.link != null) openLink(ws, path, opts.link, { newTab: opts.newTab, md: opts.md })
      else if (p) openPath(ws, p, opts)
    },
    openTag: (tag) => openTagSearch(tag),
    upload: (files) => uploadFiles(files),
    // create a whiteboard next to the note and embed it where the cursor is
    insertWhiteboard: async (view, from, to = from) => {
      if (from !== to) view.dispatch({ changes: { from, to, insert: '' } })
      const board = await createWhiteboard({ folder: dirname(path), title: `${stripExt(basename(path))} sketch`, open: false })
      if (!board) return
      const link = app().resolver.linkTextFor(board)
      const pos = Math.min(from, view.state.doc.length)
      const line = view.state.doc.lineAt(pos)
      const text = `${line.text.slice(0, pos - line.from).trim() ? '\n' : ''}![[${link}]]\n`
      view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
      view.focus()
    },
  }
}

export function tagCounts() {
  const counts = new Map()
  for (const meta of app().notes.values()) {
    for (const tag of meta.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
      const parts = tag.split('/')
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/')
        if (!counts.has(parent)) counts.set(parent, 0)
      }
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function recentNotes(limit = 8) {
  const s = app()
  return s.tree
    .filter((e) => e.type === 'file' && isNote(e.path))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
}

export function allTasks() {
  const s = app()
  const out = []
  for (const [path, meta] of s.notes) for (const task of meta.tasks || []) out.push({ ...task, path })
  return out
}

export function workspaceStats() {
  const s = app()
  let words = 0
  let tasks = 0
  let done = 0
  for (const meta of s.notes.values()) {
    words += meta.words || 0
    for (const t of meta.tasks || []) {
      tasks++
      if (t.checked) done++
    }
  }
  return {
    notes: s.notes.size,
    files: s.tree.filter((e) => e.type === 'file').length,
    words,
    tags: tagCounts().length,
    tasks,
    done,
  }
}

// Pick a note/whiteboard or a web address. Resolves { path } | { url } | { remove } | null.
export function pickLink(opts = {}) {
  return new Promise((resolve) => {
    let done = false
    useUI.getState().openPalette('link', {
      ...opts,
      resolve: (v) => {
        if (done) return
        done = true
        resolve(v)
      },
    })
  })
}

export { isoDate, conn, useUI }
