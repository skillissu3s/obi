// Projects: the boards of the workspace (notes in the Obsidian Kanban format, see
// shared/kanban.js). New tasks go to one — the Inbox unless another is picked —
// rather than into a daily note.
import { useMemo } from 'react'
import { DEFAULT_LABELS, isBoardMeta, laneOfTask, newProjectContent } from '@shared/kanban.js'
import { isOpen, splitTags } from '@shared/tasks.js'
import { basename, joinPath, stripExt } from '@shared/paths.js'
import { useApp } from '../store/app.js'
import { usePlanner } from '../store/planner.js'
import { usePrefs } from '../store/prefs.js'
import { useUI, confirmDialog } from '../store/ui.js'
import { isDesktop } from './desktop.js'
import { colorFor } from './util.js'
import { colorHex } from './colors.js'
import * as A from './actions.js'

export const PROJECTS_FOLDER = 'Projects'
export const INBOX_NAME = 'Inbox'

/** Where new projects go, and the Inbox: the workspace's settings, or Projects/ and Projects/Inbox.md */
export const projectsFolder = (settings = A.wsSettings()) => String(settings?.projectsFolder || PROJECTS_FOLDER).replace(/^\/+|\/+$/g, '')
export const inboxPath = (settings = A.wsSettings()) => joinPath(projectsFolder(settings), `${INBOX_NAME}.md`)

export const projectName = (path) => stripExt(basename(path))
/** A project's colour: the one picked for it, else one its name gives it */
export const projectColor = (path, notes = useApp.getState().notes) => colorHex(notes.get(path)?.board?.color) || colorFor(projectName(path).toLowerCase())

/** Is the note at `path` a project? */
export const isProject = (path, notes = useApp.getState().notes) => isBoardMeta(notes.get(path))

// The heading of a board's archive (after "***"): its cards are put away, not open work
const archiveLine = (meta) => {
  const h2 = (meta.headings || []).filter((h) => h.level === 2)
  const last = h2[h2.length - 1]
  return last && /^archive$/i.test(last.text.trim()) && h2.length > 1 ? last.line : Infinity
}

/** Is this task of a board put away in its archive? */
export function isArchived(task, notes = useApp.getState().notes) {
  const meta = notes.get(task.path)
  return isBoardMeta(meta) && task.line > archiveLine(meta)
}

/** The project and list a task is in, or null for a task in an ordinary note */
export function placeOf(task, notes = useApp.getState().notes) {
  const meta = notes.get(task.path)
  if (!isBoardMeta(meta)) return null
  return { project: projectName(task.path), list: laneOfTask(meta, task.line) }
}

/**
 * How a task of a board looks there, for when it is seen away from it (All tasks, the
 * calendar): its cover's colour, if it has one, and the colour of a label of the board
 * (null for a tag the board doesn't have).
 */
export function cardLook(task, notes = useApp.getState().notes) {
  const meta = notes.get(task.path)
  const board = isBoardMeta(meta) ? meta.board || {} : null
  const labels = board?.labels || DEFAULT_LABELS
  return {
    cover: (!task.indent && board?.covers?.[splitTags(task.text).title.trim().toLowerCase()]) || null,
    labelColor: (tag) => (board && labels[String(tag).toLowerCase()]) || null,
  }
}

/** The lists of a project, from its index entry */
export function listsOf(path, notes = useApp.getState().notes) {
  const meta = notes.get(path)
  if (!isBoardMeta(meta)) return []
  const stop = archiveLine(meta)
  return (meta.headings || []).filter((h) => h.level === 2 && h.line < stop).map((h) => h.text.trim())
}

/**
 * The workspace's projects: { path, name, color, open, total } — `open` counts the
 * cards (top-level tasks) not done. In the order they were dragged into (`order`, a
 * list of paths), if they were; the rest by name after them, the Inbox first.
 */
export function projectsOf(notes, order = []) {
  const out = []
  const inbox = inboxPath()
  for (const [path, meta] of notes) {
    if (!isBoardMeta(meta)) continue
    const stop = archiveLine(meta)
    const cards = (meta.tasks || []).filter((t) => t.parent == null && t.line < stop)
    out.push({ path, name: projectName(path), color: projectColor(path, notes), open: cards.filter((t) => isOpen(t.status)).length, total: cards.length, inbox: path === inbox })
  }
  const at = new Map(order.map((p, i) => [p, i]))
  const rank = (p) => at.get(p.path) ?? Infinity
  return out.sort((a, b) => rank(a) - rank(b) || Number(b.inbox) - Number(a.inbox) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

const NO_ORDER = []
export function useProjects() {
  const version = useApp((s) => s.version)
  const notes = useApp((s) => s.notes)
  const ws = useApp((s) => s.wsId)
  const order = usePrefs((s) => s.boardOrder?.[ws]) || NO_ORDER
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => projectsOf(notes, order), [notes, version, order])
}

/** Keeps the boards of the workspace in this order (paths), for this person */
export function setBoardOrder(paths) {
  const ws = useApp.getState().wsId
  const all = usePrefs.getState().boardOrder || {}
  usePrefs.getState().set({ boardOrder: { ...all, [ws]: paths } })
}

/** Makes a project — the default lists and their rules — and opens it */
export async function createProject(name, { open = true, newTab = false } = {}) {
  const title = String(name || '').trim()
  if (!title) return null
  return A.createNote({ folder: projectsFolder(), title, content: newProjectContent(), open, newTab })
}

/**
 * The calendar and the task pages show a whole workspace, so they are shared by
 * sharing the workspace: its members see and change everything in it with you,
 * live. A private workspace (GitHub, a folder on this computer) can't have
 * members; one project board can still be shared from its own Share button.
 */
export async function shareWorkspace(what) {
  const s = useApp.getState()
  const ws = s.workspaces.find((w) => w.id === s.wsId)
  if (ws?.type === 'online' && !isDesktop) return useUI.getState().openModal('settings', { section: 'members' })
  const where = ws?.type === 'github' ? 'GitHub' : 'this computer'
  const ok = await confirmDialog({
    title: 'Share with a team',
    message: `The ${what} shows everything in a workspace, so it is shared by adding people to the workspace. “${ws?.name || 'This workspace'}” is private, kept in ${where}. Make an online workspace for your team to plan together, or share one project board from its Share button.`,
    confirmText: isDesktop ? 'OK' : 'Make an online workspace',
  })
  if (ok && !isDesktop) useUI.getState().openModal('new-workspace')
}

/** The project new tasks go to: the one last picked, while it is still there, else the Inbox */
export function taskTarget() {
  const picked = usePlanner.getState().project
  return picked && isProject(picked) ? picked : inboxPath()
}
