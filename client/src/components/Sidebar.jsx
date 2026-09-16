import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  ChevronRight, FileText, Folder, FolderOpen, FilePlus, FolderPlus, Search, Hash, Star, Share2, Users, ChevronDown,
  MoreHorizontal, Pencil, Trash2, Copy, FolderInput, SplitSquareHorizontal, Link2, History, ListFilter, X, Image, File,
  SortAsc, PanelLeftClose, Layers, Plus, Settings2, Cloud, FolderGit2, LogOut, CheckCircle2, Globe,
} from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { useUI, toast } from '../store/ui.js'
import { api } from '../lib/api.js'
import * as A from '../lib/actions.js'
import { WsIcon, menuFromElement, Avatar } from './ui.jsx'
import { basename, dirname, stripExt, isNote, extname, joinPath, IMAGE_EXT } from '@shared/paths.js'
import { debounce, timeAgo, fuzzyFilter } from '../lib/util.js'

const ROW_H = 28

// ---------------- File tree ----------------

function buildTree(entries, sortBy) {
  const root = { path: '', type: 'folder', children: [], name: '' }
  const map = new Map([['', root]])
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  for (const e of sorted) {
    const node = { ...e, name: basename(e.path), children: e.type === 'folder' ? [] : null }
    map.set(e.path, node)
    const parent = map.get(dirname(e.path)) || root
    if (parent.children) parent.children.push(node)
  }
  const cmp = (a, b) => {
    if ((a.type === 'folder') !== (b.type === 'folder')) return a.type === 'folder' ? -1 : 1
    if (sortBy === 'modified') return b.mtime - a.mtime
    if (sortBy === 'created') return b.mtime - a.mtime
    if (sortBy === 'name-desc') return b.name.localeCompare(a.name, undefined, { numeric: true })
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  }
  const sortRec = (n) => {
    if (!n.children) return
    n.children.sort(cmp)
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root
}

function flatten(node, expanded, depth = 0, out = []) {
  for (const child of node.children || []) {
    out.push({ node: child, depth })
    if (child.type === 'folder' && expanded.has(child.path)) flatten(child, expanded, depth + 1, out)
  }
  return out
}

function fileIcon(path) {
  if (isNote(path)) return FileText
  if (IMAGE_EXT.has(extname(path))) return Image
  return File
}

export function FileTree() {
  const tree = useApp((s) => s.tree)
  const expanded = useApp((s) => s.expanded)
  const selected = useApp((s) => s.selectedPath)
  const wsId = useApp((s) => s.wsId)
  const presence = useApp((s) => s.presence)
  const prefs = usePrefs()
  const activeTab = useLayout((s) => s.panes.find((p) => p.id === s.activePane)?.tabs.find((t) => t.id === s.panes.find((q) => q.id === s.activePane).active))
  const activePath = activeTab?.kind === 'note' && activeTab.ws === wsId ? activeTab.path : null
  const [renaming, setRenaming] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const dragRef = useRef(null)
  const scrollRef = useRef(null)

  const me = useApp((s) => s.user?.id)
  const rootNode = useMemo(() => buildTree(tree, prefs.sortBy), [tree, prefs.sortBy])
  const rows = useMemo(() => flatten(rootNode, expanded), [rootNode, expanded])

  useEffect(() => {
    if (!activePath || !scrollRef.current) return
    const idx = rows.findIndex((r) => r.node.path === activePath)
    if (idx < 0) return
    const el = scrollRef.current
    const top = idx * ROW_H
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2)
  }, [activePath, rows.length])

  const onRowClick = (node, e) => {
    useApp.setState({ selectedPath: node.path })
    if (node.type === 'folder') {
      useApp.getState().setExpanded(node.path, !expanded.has(node.path))
    } else if (isNote(node.path)) {
      useLayout.getState().openNote(wsId, node.path, { newTab: e.metaKey || e.ctrlKey })
    } else {
      window.open(api.fileUrl(wsId, node.path), '_blank', 'noopener')
    }
  }

  const contextMenu = (e, node) => {
    const isFolder = node.type === 'folder'
    const folder = isFolder ? node.path : dirname(node.path)
    useUI.getState().showContextMenu(e, [
      isFolder && { label: 'New note here', icon: FilePlus, run: () => A.createNote({ folder }) },
      isFolder && { label: 'New folder', icon: FolderPlus, run: () => A.createFolder(folder) },
      !isFolder && isNote(node.path) && { label: 'Open in new tab', icon: FileText, run: () => useLayout.getState().openNote(wsId, node.path, { newTab: true }) },
      !isFolder && isNote(node.path) && { label: 'Open to the right', icon: SplitSquareHorizontal, run: () => useLayout.getState().splitRight({ kind: 'note', ws: wsId, path: node.path }) },
      'divider',
      { label: 'Rename…', icon: Pencil, run: () => setRenaming(node.path) },
      { label: 'Move to…', icon: FolderInput, run: () => useUI.getState().openModal('move', { path: node.path }) },
      !isFolder && isNote(node.path) && { label: 'Duplicate', icon: Copy, run: () => A.duplicateNote(node.path) },
      !isFolder && isNote(node.path) && { label: 'Copy link', icon: Link2, run: () => A.copyNoteLink(wsId, node.path) },
      !isFolder && isNote(node.path) && { label: A.isBookmarked(node.path) ? 'Remove bookmark' : 'Bookmark', icon: Star, run: () => A.toggleBookmark(node.path) },
      !isFolder && isNote(node.path) && { label: 'Share & publish…', icon: Share2, run: () => useUI.getState().openModal('share', { ws: wsId, path: node.path }) },
      !isFolder && isNote(node.path) && { label: 'Version history', icon: History, run: () => useUI.getState().openModal('history', { ws: wsId, path: node.path }) },
      'divider',
      { label: `Delete ${isFolder ? 'folder' : 'file'}`, icon: Trash2, danger: true, run: () => A.deleteEntry(node.path) },
    ])
  }

  const onDrop = async (e, node) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const dest = node ? (node.type === 'folder' ? node.path : dirname(node.path)) : ''
    const files = [...(e.dataTransfer?.files || [])]
    if (files.length) {
      await A.importFiles(files, dest)
      return
    }
    const path = dragRef.current || e.dataTransfer.getData('text/obi-path')
    dragRef.current = null
    if (!path) return
    if (dest === dirname(path) || path === dest || dest.startsWith(path + '/')) return
    A.moveEntry(path, dest)
  }

  return (
    <div
      className="sidebar-scroll"
      ref={scrollRef}
      onDragOver={(e) => {
        e.preventDefault()
        setDropTarget('')
      }}
      onDrop={(e) => onDrop(e, null)}
      onClick={(e) => {
        if (e.target === e.currentTarget) useApp.setState({ selectedPath: null })
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) contextMenu(e, { type: 'folder', path: '' })
      }}
    >
      {rows.length === 0 && (
        <div className="empty">
          <FileText />
          <div>No notes yet</div>
          <button className="btn btn-sm" onClick={() => A.createNote({})}>
            <FilePlus /> New note
          </button>
        </div>
      )}
      {rows.map(({ node, depth }) => {
        const Icon = node.type === 'folder' ? (expanded.has(node.path) ? FolderOpen : Folder) : fileIcon(node.path)
        const viewers = (presence[node.path] || []).filter((u) => u.id !== me)
        return (
          <div
            key={node.path}
            className={`tree-row ${activePath === node.path ? 'active' : ''} ${selected === node.path ? 'selected' : ''} ${dropTarget === node.path ? 'drop-target' : ''}`}
            style={{ paddingLeft: 4 + depth * 13 }}
            draggable={!renaming}
            onDragStart={(e) => {
              dragRef.current = node.path
              e.dataTransfer.setData('text/obi-path', node.path)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              dragRef.current = null
              setDropTarget(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropTarget(node.type === 'folder' ? node.path : dirname(node.path))
            }}
            onDrop={(e) => onDrop(e, node)}
            onClick={(e) => onRowClick(node, e)}
            onAuxClick={(e) => {
              if (e.button === 1 && node.type === 'file' && isNote(node.path)) {
                e.preventDefault()
                useLayout.getState().openNote(wsId, node.path, { newTab: true })
              }
            }}
            onContextMenu={(e) => contextMenu(e, node)}
            title={node.path}
          >
            {node.type === 'folder' ? (
              <span className={`chev ${expanded.has(node.path) ? 'open' : ''}`}>
                <ChevronRight />
              </span>
            ) : (
              <span style={{ width: 4 }} />
            )}
            <Icon className="file-icon" />
            {renaming === node.path ? (
              <input
                className="tree-rename"
                defaultValue={isNote(node.path) ? stripExt(node.name) : node.name}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  setRenaming(null)
                  const cur = isNote(node.path) ? stripExt(node.name) : node.name
                  if (v && v !== cur) {
                    const target = joinPath(dirname(node.path), isNote(node.path) ? `${v}.md` : v)
                    api
                      .move(wsId, node.path, target)
                      .then(() => {
                        useLayout.getState().renamePaths(wsId, node.path, target)
                        useApp.getState().refreshTree()
                      })
                      .catch(toast.error)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <span className="tree-name">{isNote(node.path) ? stripExt(node.name) : node.name}</span>
            )}
            {viewers.length > 0 && (
              <span className="presence-dots">
                {viewers.slice(0, 3).map((u) => (
                  <span key={u.id} className="presence-dot" style={{ background: u.color }} title={`${u.name} is here`} />
                ))}
              </span>
            )}
            {node.type === 'file' && !isNote(node.path) && <span className="tree-ext">{extname(node.path)}</span>}
            <span className="row-actions">
              {node.type === 'folder' && (
                <button
                  className="icon-btn sm"
                  title="New note"
                  onClick={(e) => {
                    e.stopPropagation()
                    useApp.getState().setExpanded(node.path, true)
                    A.createNote({ folder: node.path })
                  }}
                >
                  <FilePlus />
                </button>
              )}
              <button
                className="icon-btn sm"
                onClick={(e) => {
                  e.stopPropagation()
                  contextMenu(e, node)
                }}
              >
                <MoreHorizontal />
              </button>
            </span>
          </div>
        )
      })}
      <div style={{ height: 40 }} />
    </div>
  )
}

// ---------------- Search ----------------

export function SearchPanel() {
  const wsId = useApp((s) => s.wsId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [took, setTook] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const run = useMemo(
    () =>
      debounce(async (q) => {
        if (!q.trim()) {
          setResults(null)
          setBusy(false)
          return
        }
        abortRef.current?.abort()
        const ac = new AbortController()
        abortRef.current = ac
        try {
          const r = await api.search(wsId, q, { signal: ac.signal })
          setResults(r.results)
          setTook(r.took)
        } catch (e) {
          if (e.name !== 'AbortError') toast.error(e)
        } finally {
          setBusy(false)
        }
      }, 180),
    [wsId],
  )

  useEffect(() => {
    const onSearch = (e) => {
      setQuery(e.detail.query)
      setBusy(true)
      run(e.detail.query)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    window.addEventListener('obi:search', onSearch)
    setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.removeEventListener('obi:search', onSearch)
  }, [run])

  const onChange = (v) => {
    setQuery(v)
    setBusy(!!v.trim())
    run(v)
  }

  const total = results?.reduce((n, r) => n + Math.max(1, r.matches.length), 0) || 0

  return (
    <>
      <div className="search-box">
        <Search />
        <input
          ref={inputRef}
          className="input"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange('')
          }}
        />
      </div>
      {results && (
        <div className="search-meta">
          <span>
            {results.length} note{results.length === 1 ? '' : 's'} · {total} match{total === 1 ? '' : 'es'}
          </span>
          <span>{busy ? '…' : `${took}ms`}</span>
        </div>
      )}
      <div className="sidebar-scroll">
        {!results && (
          <div className="empty" style={{ textAlign: 'left', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Search tips</div>
            <div>
              <span className="code-inline">tag:idea</span> notes with a tag
            </div>
            <div>
              <span className="code-inline">path:work/</span> inside a folder
            </div>
            <div>
              <span className="code-inline">file:meeting</span> by note title
            </div>
            <div>
              <span className="code-inline">"exact phrase"</span> and <span className="code-inline">-exclude</span>
            </div>
          </div>
        )}
        {results?.length === 0 && <div className="empty">No matches</div>}
        {results?.map((r) => (
          <div className="search-result" key={r.path}>
            <div className="search-result-title" onClick={(e) => useLayout.getState().openNote(wsId, r.path, { newTab: e.metaKey || e.ctrlKey })}>
              <FileText />
              <span className="truncate">{stripExt(basename(r.path))}</span>
              <span className="search-result-path truncate">{dirname(r.path)}</span>
            </div>
            {r.matches.map((m, i) => (
              <div key={i} className="search-match" onClick={() => useLayout.getState().openNote(wsId, r.path, { line: m.line })}>
                <Highlighted text={m.text} ranges={m.ranges} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function Highlighted({ text, ranges }) {
  if (!ranges?.length) return text
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const parts = []
  let pos = 0
  for (const [a, b] of sorted) {
    if (a < pos) continue
    parts.push(text.slice(pos, a))
    parts.push(<mark key={a}>{text.slice(a, b)}</mark>)
    pos = b
  }
  parts.push(text.slice(pos))
  return parts
}

// ---------------- Tags ----------------

export function TagsPanel() {
  const version = useApp((s) => s.version)
  const [collapsed, setCollapsed] = useState(new Set())
  const tags = useMemo(() => A.tagCounts(), [version])
  const [filter, setFilter] = useState('')

  const tree = useMemo(() => {
    const roots = new Map()
    for (const { tag, count } of tags) {
      const parts = tag.split('/')
      let prefix = ''
      let level = roots
      parts.forEach((part, i) => {
        prefix = prefix ? `${prefix}/${part}` : part
        if (!level.has(prefix)) level.set(prefix, { tag: prefix, name: part, count: 0, children: new Map(), depth: i })
        const node = level.get(prefix)
        if (i === parts.length - 1) node.count += count
        level = node.children
      })
    }
    const flat = []
    const walk = (map, depth) => {
      for (const node of [...map.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        flat.push({ ...node, depth })
        if (node.children.size && !collapsed.has(node.tag)) walk(node.children, depth + 1)
      }
    }
    walk(roots, 0)
    return flat.filter((n) => !filter || n.tag.toLowerCase().includes(filter.toLowerCase()))
  }, [tags, collapsed, filter])

  const total = tags.length
  return (
    <>
      {total > 12 && (
        <div className="search-box">
          <Search />
          <input className="input" placeholder="Filter tags" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <div className="sidebar-scroll">
        {!total && <div className="empty"><Hash />No tags yet. Add #tags to your notes.</div>}
        {tree.map((node) => (
          <div key={node.tag} className="tag-row" style={{ paddingLeft: 8 + node.depth * 12 }} onClick={() => A.openTagSearch(node.tag)}>
            {node.children.size ? (
              <span
                className={`chev ${collapsed.has(node.tag) ? '' : 'open'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  const next = new Set(collapsed)
                  next.has(node.tag) ? next.delete(node.tag) : next.add(node.tag)
                  setCollapsed(next)
                }}
                style={{ width: 14 }}
              >
                <ChevronRight />
              </span>
            ) : (
              <Hash />
            )}
            <span className="truncate">{node.name}</span>
            {node.count > 0 && <span className="count">{node.count}</span>}
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------- Bookmarks + shared ----------------

export function BookmarksPanel() {
  const wsId = useApp((s) => s.wsId)
  const prefs = usePrefs()
  const treeMap = useApp((s) => s.treeMap)
  const list = (prefs.bookmarks[wsId] || []).filter((p) => treeMap.has(p))
  const shared = useApp((s) => s.shared)
  const recent = A.recentNotes(12)

  return (
    <div className="sidebar-scroll">
      <div className="sidebar-section-title">
        <Star size={12} /> Bookmarks
      </div>
      {!list.length && <div className="faint" style={{ padding: '4px 10px', fontSize: 12 }}>Star notes to pin them here.</div>}
      {list.map((p) => (
        <div key={p} className="tree-row" onClick={(e) => useLayout.getState().openNote(wsId, p, { newTab: e.metaKey || e.ctrlKey })} onContextMenu={(e) => useUI.getState().showContextMenu(e, [{ label: 'Remove bookmark', icon: X, run: () => A.toggleBookmark(p) }])}>
          <FileText className="file-icon" />
          <span className="tree-name">{stripExt(basename(p))}</span>
        </div>
      ))}

      {shared.length > 0 && (
        <>
          <div className="sidebar-section-title">
            <Share2 size={12} /> Shared with me
          </div>
          {shared.map((s) => (
            <div key={`${s.ws}:${s.path}`} className="tree-row" title={`${s.workspaceName} · shared by ${s.sharedBy || 'someone'}`} onClick={() => useLayout.getState().openNote(s.ws, s.path)}>
              <FileText className="file-icon" />
              <span className="tree-name">{stripExt(basename(s.path))}</span>
              <span className="tree-ext">{s.role === 'editor' ? 'edit' : 'view'}</span>
            </div>
          ))}
        </>
      )}

      <div className="sidebar-section-title">
        <History size={12} /> Recent
      </div>
      {recent.map((e) => (
        <div key={e.path} className="tree-row" onClick={(ev) => useLayout.getState().openNote(wsId, e.path, { newTab: ev.metaKey || ev.ctrlKey })}>
          <FileText className="file-icon" />
          <span className="tree-name">{stripExt(basename(e.path))}</span>
          <span className="tree-ext" style={{ background: 'none' }}>{timeAgo(e.mtime)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------- Sidebar shell ----------------

export function Sidebar() {
  const leftTab = useLayout((s) => s.leftTab)
  const width = useLayout((s) => s.leftWidth)
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const prefs = usePrefs()
  const ws = workspaces.find((w) => w.id === wsId)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => useLayout.getState().setWidths({ leftWidth: Math.max(200, Math.min(460, e.clientX - 48)) })
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  const tabs = [
    { id: 'files', icon: FileText, title: 'Files' },
    { id: 'search', icon: Search, title: 'Search (Ctrl/⌘ Shift F)' },
    { id: 'tags', icon: Hash, title: 'Tags' },
    { id: 'bookmarks', icon: Star, title: 'Bookmarks & recent' },
  ]

  const sortMenu = (e) => {
    const options = [
      { id: 'name', label: 'Name (A → Z)' },
      { id: 'name-desc', label: 'Name (Z → A)' },
      { id: 'modified', label: 'Recently modified' },
    ]
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), options.map((o) => ({ label: o.label, icon: prefs.sortBy === o.id ? CheckCircle2 : undefined, run: () => prefs.set({ sortBy: o.id }) })))
  }

  return (
    <div className="sidebar left" style={{ width }}>
      <div className="sidebar-header">
        <button className="ws-switcher" onClick={() => useUI.getState().openPalette('workspaces')} title="Switch workspace">
          <WsIcon ws={ws} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ws-name truncate">{ws?.name || 'Workspace'}</div>
            <div className="ws-sub truncate">
              {ws?.type === 'github' ? (
                <>
                  <FolderGit2 size={11} /> {ws.github?.label}
                </>
              ) : (
                <>
                  <Cloud size={11} /> Online{ws?.memberCount > 1 ? ` · ${ws.memberCount} members` : ''}
                </>
              )}
            </div>
          </div>
          <ChevronDown size={14} style={{ color: 'var(--text-3)' }} />
        </button>
      </div>
      <div className="sidebar-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`icon-btn ${leftTab === t.id ? 'active' : ''}`} title={t.title} onClick={() => useLayout.getState().setLeftTab(t.id)}>
            <t.icon />
          </button>
        ))}
      </div>
      {leftTab === 'files' && (
        <div className="sidebar-toolbar">
          <span className="title">Files</span>
          <button className="icon-btn sm" title="New note" onClick={() => A.createNote({ folder: '' })}>
            <FilePlus />
          </button>
          <button className="icon-btn sm" title="New folder" onClick={() => A.createFolder('')}>
            <FolderPlus />
          </button>
          <button className="icon-btn sm" title="Sort" onClick={sortMenu}>
            <SortAsc />
          </button>
          <button className="icon-btn sm" title="Collapse all" onClick={() => useApp.getState().collapseAll()}>
            <PanelLeftClose />
          </button>
        </div>
      )}
      {leftTab === 'files' && <FileTree />}
      {leftTab === 'search' && <SearchPanel />}
      {leftTab === 'tags' && <TagsPanel />}
      {leftTab === 'bookmarks' && <BookmarksPanel />}
      <div className={`resizer ${dragging ? 'dragging' : ''}`} onMouseDown={() => setDragging(true)} />
    </div>
  )
}
