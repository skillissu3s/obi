import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Command, FileText, FilePlus, Layers, Cloud, FolderGit2, CornerDownLeft, ArrowUp, ArrowDown, Copy, Globe, X, Shapes, Link2 } from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { useUI } from '../store/ui.js'
import { buildCommands } from '../lib/commands.js'
import { fuzzyFilter, hotkeyLabel, timeAgo } from '../lib/util.js'
import * as A from '../lib/actions.js'
import { WsIcon } from './ui.jsx'
import { basename, stripExt, dirname, isNote } from '@shared/paths.js'
import { isBoardPath } from '@shared/board.js'
import { getActiveEditorView } from '../lib/commands.js'

function Highlight({ text, indices }) {
  if (!indices?.length) return text
  const set = new Set(indices)
  return [...text].map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : ch))
}

export function CommandPalette() {
  const palette = useUI((s) => s.palette)
  const close = useUI((s) => s.closePalette)
  const [query, setQuery] = useState('')
  const [hl, setHl] = useState(0)
  const listRef = useRef(null)
  const app = useApp()
  const mode = palette?.mode || 'commands'
  // palettes opened with a `resolve` callback (pickers) report a dismissal as null
  const dismiss = () => {
    palette?.resolve?.(null)
    close()
  }

  useEffect(() => {
    setQuery(palette?.query || '')
    setHl(0)
  }, [palette])

  const items = useMemo(() => {
    if (!palette) return []
    if (mode === 'commands') {
      const cmds = buildCommands().filter((c) => !c.hidden)
      return fuzzyFilter(cmds, query, (c) => `${c.group} ${c.name}`, 60).map(({ item, indices }) => ({
        key: item.id,
        icon: item.icon,
        title: item.name,
        sub: item.group,
        hint: item.hotkey ? hotkeyLabel(item.hotkey) : null,
        indices: null,
        run: item.run,
      }))
    }
    if (mode === 'workspaces') {
      const list = app.workspaces
      const res = fuzzyFilter(list, query, (w) => w.name, 40).map(({ item, indices }) => ({
        key: item.id,
        node: (
          <>
            <WsIcon ws={item} size={22} />
            <div className="pi-main">
              <div className="pi-title">
                <Highlight text={item.name} indices={indices} />
              </div>
              <div className="pi-sub">{item.type === 'github' ? `GitHub · ${item.github?.label}` : `Online${item.memberCount > 1 ? ` · ${item.memberCount} members` : ''}`}</div>
            </div>
            {item.id === app.wsId && <span className="badge accent">current</span>}
          </>
        ),
        run: () => A.switchWorkspace(item.id),
      }))
      res.push({ key: '__new', icon: Layers, title: 'Create new workspace…', run: () => useUI.getState().openModal('new-workspace') })
      return res
    }
    if (mode === 'templates') {
      const tpls = A.templateFiles()
      return fuzzyFilter(tpls, query, (p) => p, 40).map(({ item, indices }) => ({
        key: item,
        icon: FileText,
        title: stripExt(basename(item)),
        sub: dirname(item),
        run: () => {
          const view = getActiveEditorView()
          if (!view) return
          const pos = view.state.selection.main
          A.insertTemplateInto(view, item, pos.from, pos.to, useLayout.getState().activeTab()?.path)
        },
      }))
    }
    if (mode === 'link') {
      const q = query.trim()
      const out = []
      if (/^(https?:\/\/|www\.)\S+$/i.test(q)) {
        const url = q.startsWith('www.') ? `https://${q}` : q
        out.push({ key: '__url', icon: Globe, title: `Link to ${url}`, sub: 'Web page', run: () => palette.resolve({ url }) })
      }
      if (palette.allowRemove) out.push({ key: '__remove', icon: X, title: 'Remove link', sub: 'Unlink this element', run: () => palette.resolve({ remove: true }) })
      const files = app.tree.filter((e) => e.type === 'file' && (isNote(e.path) || isBoardPath(e.path)))
      for (const { item, indices } of fuzzyFilter(files, q, (e) => stripExt(e.path), 50)) {
        const name = stripExt(basename(item.path))
        const prefixLen = stripExt(item.path).length - name.length
        out.push({
          key: item.path,
          icon: isBoardPath(item.path) ? Shapes : FileText,
          title: name,
          titleIndices: q ? indices.filter((i) => i >= prefixLen).map((i) => i - prefixLen) : [],
          sub: dirname(item.path),
          run: () => palette.resolve({ path: item.path }),
        })
      }
      if (q && !out.some((o) => o.key === '__url') && !files.some((n) => stripExt(basename(n.path)).toLowerCase() === q.toLowerCase())) {
        out.push({
          key: '__create',
          icon: FilePlus,
          title: `Create note “${q}”`,
          sub: 'New note, linked here',
          run: async () => {
            const path = await A.createNote({ title: q, open: false })
            palette.resolve(path ? { path } : null)
          },
        })
      }
      return out
    }
    // files — recently edited first, so an empty query is already useful
    const notes = app.tree.filter((e) => e.type === 'file' && (isNote(e.path) || isBoardPath(e.path))).sort((a, b) => b.mtime - a.mtime)
    const scored = fuzzyFilter(notes, query, (e) => stripExt(e.path), 50).map(({ item, indices }) => {
      const name = stripExt(basename(item.path))
      const folder = dirname(item.path)
      const prefixLen = stripExt(item.path).length - name.length
      return {
        key: item.path,
        icon: isBoardPath(item.path) ? Shapes : FileText,
        title: name,
        titleIndices: query ? indices.filter((i) => i >= prefixLen).map((i) => i - prefixLen) : [],
        sub: folder,
        hint: timeAgo(item.mtime),
        run: (e) => useLayout.getState().openNote(app.wsId, item.path, { newTab: e?.metaKey || e?.ctrlKey }),
      }
    })
    if (query.trim() && !notes.some((n) => stripExt(basename(n.path)).toLowerCase() === query.trim().toLowerCase())) {
      scored.push({ key: '__create', icon: FilePlus, title: `Create “${query.trim()}”`, sub: 'New note', run: () => A.createNote({ title: query.trim() }) })
    }
    return scored
  }, [palette, query, mode, app.workspaces, app.tree, app.wsId])

  useEffect(() => {
    const el = listRef.current?.children[hl]
    el?.scrollIntoView({ block: 'nearest' })
  }, [hl])

  useEffect(() => {
    if (!palette) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        palette?.resolve?.(null)
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [palette, close])

  if (!palette) return null

  const placeholder =
    mode === 'commands'
      ? 'Type a command…'
      : mode === 'workspaces'
        ? 'Switch workspace…'
        : mode === 'templates'
          ? 'Insert template…'
          : mode === 'link'
            ? palette.placeholder || 'Link a note, or paste a web address…'
            : 'Search notes by name…'

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setHl((h) => (h + 1) % Math.max(items.length, 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setHl((h) => (h - 1 + items.length) % Math.max(items.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[hl]
      if (item) {
        close()
        item.run(e)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    }
  }

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div className="palette">
        <div className="palette-input">
          {mode === 'commands' ? <Command /> : mode === 'link' ? <Link2 /> : <Search />}
          <input autoFocus value={query} placeholder={placeholder} onChange={(e) => { setQuery(e.target.value); setHl(0) }} onKeyDown={onKeyDown} />
          {mode !== 'commands' && <span className="badge">{mode === 'link' ? 'link' : mode}</span>}
        </div>
        <div className="palette-list" ref={listRef}>
          {!items.length && <div className="empty">Nothing found</div>}
          {items.map((item, i) => (
            <div
              key={item.key}
              className={`palette-item ${i === hl ? 'hl' : ''}`}
              onMouseEnter={() => setHl(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                close()
                item.run(e)
              }}
            >
              {item.node || (
                <>
                  {item.icon && <item.icon />}
                  <div className="pi-main">
                    <div className="pi-title">
                      <Highlight text={item.title} indices={item.titleIndices} />
                    </div>
                    {item.sub && <div className="pi-sub">{item.sub}</div>}
                  </div>
                  {item.hint && <span className="pi-hint faint" style={{ fontSize: 11.5 }}>{item.hint}</span>}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <ArrowUp size={11} />
            <ArrowDown size={11} /> navigate
          </span>
          <span>
            <CornerDownLeft size={11} /> open
          </span>
          {mode === 'files' && <span>⌘/Ctrl + Enter · new tab</span>}
          <span style={{ marginLeft: 'auto' }}>esc to close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
