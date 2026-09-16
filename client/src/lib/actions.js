import { api } from './api.js'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { toast, confirmDialog, promptDialog, useUI } from '../store/ui.js'
import { basename, dirname, stripExt, joinPath, isNote, safeName, extname } from '@shared/paths.js'
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
  try {
    await api.writeNote(s.wsId, path, `# ${stripExt(basename(path))}\n\n`, { mustNotExist: true })
    app().addEntry(path)
  } catch (e) {
    if (e.status !== 409) {
      toast.error(e)
      return
    }
  }
  openPath(ws, path, opts)
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

export async function createNote({ folder = '', title, content, open = true, newTab = false } = {}) {
  const s = app()
  const base = title ? safeName(title) : 'Untitled'
  const path = uniquePath(joinPath(folder, `${base}.md`))
  try {
    await api.writeNote(s.wsId, path, content ?? '', { mustNotExist: true })
    s.addEntry(path)
    if (open) layout().openNote(s.wsId, path, { newTab, focusTitle: !title })
    return path
  } catch (e) {
    toast.error(e)
    return null
  }
}

export async function createFolder(parent = '') {
  const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmText: 'Create' })
  if (!name) return
  const path = uniquePath(joinPath(parent, safeName(name)))
  try {
    await api.createFolder(app().wsId, path)
    app().addEntry(path, 'folder')
    app().setExpanded(path, true)
  } catch (e) {
    toast.error(e)
  }
}

export async function renameEntry(path) {
  const entry = app().treeMap.get(path)
  const isFile = entry?.type === 'file'
  const current = basename(path)
  const name = await promptDialog({ title: `Rename ${isFile ? 'note' : 'folder'}`, value: isFile && isNote(path) ? stripExt(current) : current, selectBase: true, confirmText: 'Rename' })
  if (!name) return
  const clean = safeName(name)
  if (!clean) return
  const target = joinPath(dirname(path), isFile && isNote(path) && !clean.endsWith('.md') ? `${clean}.md` : clean)
  if (target === path) return
  try {
    await api.move(app().wsId, path, target)
    layout().renamePaths(app().wsId, path, target)
    app().refreshTree()
  } catch (e) {
    toast.error(e)
  }
}

export async function moveEntry(path, destFolder) {
  const target = joinPath(destFolder, basename(path))
  if (target === path) return
  try {
    await api.move(app().wsId, path, target)
    layout().renamePaths(app().wsId, path, target)
    app().refreshTree()
  } catch (e) {
    toast.error(e)
  }
}

export async function deleteEntry(path) {
  const entry = app().treeMap.get(path)
  const isFolder = entry?.type === 'folder'
  const ws = app().workspaces.find((w) => w.id === app().wsId)
  if (usePrefs.getState().confirmDelete) {
    const ok = await confirmDialog({
      title: `Delete “${basename(path)}”?`,
      message: isFolder
        ? 'This deletes the folder and everything inside it.'
        : ws?.type === 'github'
          ? 'The file is deleted and the change is pushed to GitHub (it stays in the repository history).'
          : 'You can restore it from Trash in workspace settings.',
      danger: true,
      confirmText: 'Delete',
    })
    if (!ok) return
  }
  try {
    await api.remove(app().wsId, path)
    layout().closePaths(app().wsId, path)
    app().refreshTree()
    toast.success(`Deleted ${basename(path)}`)
  } catch (e) {
    toast.error(e)
  }
}

export async function duplicateNote(path) {
  try {
    const { content } = await api.readNote(app().wsId, path)
    const target = uniquePath(`${stripExt(path)} copy.md`)
    await api.writeNote(app().wsId, target, content, { mustNotExist: true })
    app().addEntry(target)
    layout().openNote(app().wsId, target)
  } catch (e) {
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

export async function openDailyNote(date = new Date(), { newTab } = {}) {
  const s = app()
  const settings = wsSettings()
  const path = dailyNotePath(date, settings)
  if (!s.treeMap.has(path)) {
    let content = `# ${formatDate(date, 'dddd, D MMMM YYYY')}\n\n`
    const tpl = settings.dailyTemplate
    if (tpl && s.treeMap.has(tpl)) {
      try {
        content = applyTemplate(await fetchNote(s.wsId, tpl), { date, title: formatDate(date, settings.dailyFormat || 'YYYY-MM-DD') })
      } catch {}
    }
    try {
      await api.writeNote(s.wsId, path, content, { ifMissing: true })
      s.addEntry(path)
    } catch (e) {
      toast.error(e)
      return
    }
  }
  layout().openNote(s.wsId, path, { newTab })
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

export function exportWorkspace() {
  downloadUrl(api.exportUrl(app().wsId))
  toast.info('Preparing download…')
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

export { isoDate, conn, useUI }
