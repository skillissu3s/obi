import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Cloud, FolderGit2, Check, ArrowRight, ArrowLeft, Loader2, Globe, Copy, X, Users, Link2, ExternalLink, History,
  RotateCcw, FileText, Folder, Search, Upload, Info, Share2, Eye, Pencil,
} from 'lucide-react'
import { Modal, Spinner, Avatar, Switch, EmojiPicker } from '../ui.jsx'
import { api } from '../../lib/api.js'
import { useApp } from '../../store/app.js'
import { useUI, toast, confirmDialog } from '../../store/ui.js'
import * as A from '../../lib/actions.js'
import { timeAgo, formatDateTime, copyText, fuzzyFilter } from '../../lib/util.js'
import { basename, dirname, stripExt, joinPath } from '@shared/paths.js'
import { renderMarkdown } from '../../lib/render.js'
import DiffMatchPatch from 'diff-match-patch'

// ---------------- New workspace ----------------

export function NewWorkspaceModal() {
  const close = useUI((s) => s.closeModal)
  const [step, setStep] = useState(0)
  const [type, setType] = useState('online')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [token, setToken] = useState('')
  const [branch, setBranch] = useState('')
  const [test, setTest] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const testConnection = async () => {
    setBusy(true)
    setError('')
    setTest(null)
    try {
      const r = await api.testGithub(repoUrl, token)
      setTest(r)
      setBranch(r.defaultBranch || 'main')
      if (!name) setName(r.label?.split('/')[1] || 'Vault')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const { workspace } = await api.createWorkspace(type === 'online' ? { name, type, icon } : { name, type, icon, github: { repoUrl, token, branch } })
      await useApp.getState().loadWorkspaces()
      await useApp.getState().openWorkspace(workspace.id)
      close()
      toast.success(`Workspace “${workspace.name}” created`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New workspace"
      center
      onClose={close}
      footer={
        step === 0 ? (
          <>
            <button className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => setStep(1)}>
              Continue <ArrowRight />
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>
              <ArrowLeft /> Back
            </button>
            <button className="btn btn-primary" disabled={busy || !name || (type === 'github' && !test)} onClick={create}>
              {busy ? <Spinner size="sm" /> : 'Create workspace'}
            </button>
          </>
        )
      }
    >
      {step === 0 && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Where should these notes live?
          </p>
          <div className="type-cards">
            <button className={`type-card ${type === 'online' ? 'active' : ''}`} onClick={() => setType('online')}>
              <div className="tc-icon">
                <Cloud />
              </div>
              <h4>Online workspace</h4>
              <p>Stored on this server. Best for shared, collaborative notes.</p>
              <ul>
                <li>Share pages or the whole workspace</li>
                <li>Real-time editing with live cursors</li>
                <li>Version history & trash</li>
                <li>Publish notes to a public link</li>
              </ul>
            </button>
            <button className={`type-card ${type === 'github' ? 'active' : ''}`} onClick={() => setType('github')}>
              <div className="tc-icon">
                <FolderGit2 />
              </div>
              <h4>GitHub repository</h4>
              <p>Your notes stay in your own repo — ideal with Obsidian on desktop.</p>
              <ul>
                <li>Two-way sync with your vault</li>
                <li>Every change is a commit</li>
                <li>Full git history</li>
                <li>Private to you</li>
              </ul>
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="field">
            <label>Workspace name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'github' ? 'My vault' : 'Team notes'} autoFocus />
          </div>
          <div className="field">
            <label>Icon</label>
            <EmojiPicker value={icon} onChange={setIcon} />
          </div>
          {type === 'github' && (
            <>
              <div className="field">
                <label>Repository URL</label>
                <input className="input" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/you/notes" spellCheck={false} />
                <div className="hint">HTTPS or git@github.com:you/notes.git — both work. The repo can be empty.</div>
              </div>
              <div className="field">
                <label>Access token</label>
                <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_… or ghp_…" spellCheck={false} />
                <div className="hint">
                  GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> → select the repo → permission <b>Contents: Read and write</b>. Stored encrypted on the server.
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={testConnection} disabled={!repoUrl || busy}>
                  {busy ? <Spinner size="sm" /> : <Check />} Test connection
                </button>
                {test && (
                  <span className="badge success">
                    <Check /> Connected{test.empty ? ' · empty repo' : ''}
                  </span>
                )}
              </div>
              {test && !test.empty && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Branch</label>
                  <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)}>
                    {test.branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {error && <p className="error-text">{error}</p>}
        </>
      )}
    </Modal>
  )
}

// ---------------- Share & publish ----------------

export function ShareModal({ ws: wsId, path }) {
  const close = useUI((s) => s.closeModal)
  const workspaces = useApp((s) => s.workspaces)
  const ws = workspaces.find((w) => w.id === wsId)
  const [data, setData] = useState(null)
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('editor')
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [removing, setRemoving] = useState(null)

  const load = () => api.shares(wsId, path).then(setData).catch((e) => toast.error(e))
  useEffect(() => {
    load()
    api.users().then((r) => setUsers(r.users)).catch(() => {})
  }, [wsId, path])

  const share = async () => {
    setBusy(true)
    try {
      await api.shareNote(wsId, path, username.replace(/^@/, ''), role)
      setUsername('')
      await load()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const publicUrl = data?.published ? `${location.origin}/p/${data.published.slug}` : null

  return (
    <Modal title={`Share “${stripExt(basename(path))}”`} center onClose={close} icon={<Share2 size={18} />}>
      {ws?.type === 'online' ? (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <input className="input grow" list="obi-share-users" placeholder="Username to share with" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && share()} />
            <datalist id="obi-share-users">
              {users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.displayName}
                </option>
              ))}
            </datalist>
            <select className="select" style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button className="btn btn-primary" disabled={!username || busy} onClick={share}>
              {busy ? <Spinner size="sm" /> : null} {busy ? 'Sharing…' : 'Share'}
            </button>
          </div>
          {data?.shares?.map((s) => (
            <div className="person-row" key={s.id}>
              <Avatar name={s.displayName} color={s.color} size={30} />
              <div className="grow">
                <div style={{ fontWeight: 550 }}>{s.displayName}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  @{s.username} · {timeAgo(s.createdAt)}
                </div>
              </div>
              <span className="badge">{s.role === 'editor' ? <Pencil /> : <Eye />} {s.role === 'editor' ? 'Can edit' : 'Can view'}</span>
              <button
                className="icon-btn"
                title="Remove access"
                disabled={removing === s.id}
                onClick={async () => {
                  setRemoving(s.id)
                  try {
                    await api.unshareNote(wsId, path, s.id)
                    await load()
                  } catch (e) {
                    toast.error(e)
                  } finally {
                    setRemoving(null)
                  }
                }}
              >
                {removing === s.id ? <Spinner size="sm" /> : <X />}
              </button>
            </div>
          ))}
          {!data && (
            <div className="row faint" style={{ gap: 8, padding: '6px 0' }}>
              <Spinner size="sm" /> Loading who has access…
            </div>
          )}
          {data && !data.shares.length && <div className="hint">Not shared with anyone yet. People you share with see only this note.</div>}
          <div className="hint" style={{ marginTop: 10 }}>
            Want to share everything? Add members to the workspace in <b>Settings → Members</b>.
          </div>
        </>
      ) : (
        <div className="hint">
          This note lives in a GitHub workspace, which is private to you. Create an <b>online workspace</b> to collaborate with other people — or publish a read-only link below.
        </div>
      )}

      <div className="publish-box">
        <div className="row">
          <Globe size={16} style={{ color: publicUrl ? 'var(--success)' : 'var(--text-3)' }} />
          <div className="grow">
            <div className="setting-name">Publish to the web</div>
            <div className="setting-desc">
              {publishing ? (publicUrl ? 'Unpublishing…' : 'Publishing…') : 'Anyone with the link can read this note. It updates live.'}
            </div>
          </div>
          {publishing && <Spinner size="sm" />}
          <Switch
            checked={!!publicUrl}
            disabled={publishing}
            onChange={async (v) => {
              setPublishing(true)
              try {
                if (v) await api.publish(wsId, path)
                else await api.unpublish(wsId, path)
                await load()
                toast.success(v ? 'Published — link copied below' : 'Unpublished')
              } catch (e) {
                toast.error(e)
              } finally {
                setPublishing(false)
              }
            }}
          />
        </div>
        {publicUrl && (
          <div className="link-copy">
            <input className="input mono" readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              onClick={() => {
                copyText(publicUrl)
                toast.success('Link copied')
              }}
            >
              <Copy />
            </button>
            <a className="btn" href={publicUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </div>
        )}
      </div>

      <div className="publish-box">
        <div className="row">
          <Link2 size={16} style={{ color: 'var(--text-3)' }} />
          <div className="grow">
            <div className="setting-name">Copy internal link</div>
            <div className="setting-desc">For people who already have access.</div>
          </div>
          <button className="btn btn-sm" onClick={() => A.copyNoteLink(wsId, path)}>
            <Copy /> Copy
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Version history ----------------

const dmp = new DiffMatchPatch()

export function HistoryModal({ ws: wsId, path }) {
  const close = useUI((s) => s.closeModal)
  const [versions, setVersions] = useState(null)
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [current, setCurrent] = useState('')
  const [showDiff, setShowDiff] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.history(wsId, path).then((r) => {
      setVersions(r.versions)
      if (r.versions[0]) setSelected(r.versions[0])
    }).catch((e) => toast.error(e))
    api.readNote(wsId, path).then((r) => setCurrent(r.content)).catch(() => {})
  }, [wsId, path])

  useEffect(() => {
    if (!selected) return
    setContent('')
    api.version(wsId, path, selected.id, selected.path !== path ? selected.path : undefined).then((r) => setContent(r.content)).catch((e) => toast.error(e))
  }, [selected, wsId, path])

  const diff = useMemo(() => {
    if (!showDiff || !content) return null
    const d = dmp.diff_main(content, current)
    dmp.diff_cleanupSemantic(d)
    let added = 0
    let removed = 0
    const html = d
      .map(([op, text]) => {
        if (op === 1) added += text.length
        if (op === -1) removed += text.length
        const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
        return op === 1 ? `<ins>${esc}</ins>` : op === -1 ? `<del>${esc}</del>` : esc
      })
      .join('')
    return { html, added, removed }
  }, [content, current, showDiff])

  return (
    <Modal
      title={`History · ${stripExt(basename(path))}`}
      onClose={close}
      className="xwide"
      bodyClass=""
      icon={<History size={18} />}
      headerExtra={
        <div className="row">
          <label className="row faint" style={{ fontSize: 12, gap: 6 }}>
            <Switch checked={showDiff} onChange={setShowDiff} /> Show changes vs current
          </label>
        </div>
      }
    >
      <div className="history">
        <div className="history-list">
          {!versions && <Spinner size="sm" />}
          {versions?.length === 0 && <div className="empty">No history yet</div>}
          {versions?.map((v) => (
            <div key={v.id} className={`history-item ${selected?.id === v.id ? 'active' : ''}`} onClick={() => setSelected(v)}>
              <div className="hi-time">{timeAgo(v.createdAt)}</div>
              <div className="hi-meta">
                {formatDateTime(v.createdAt)}
                {v.author ? ` · ${v.author}` : ''}
              </div>
              {v.message && <div className="hi-meta truncate">{v.message}</div>}
            </div>
          ))}
        </div>
        <div className="history-preview">
          {!selected && <div className="empty">Select a version</div>}
          {selected && !content && <Spinner size="sm" />}
          {selected && content && (
            <>
              <div className="row" style={{ marginBottom: 14 }}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{formatDateTime(selected.createdAt)}</div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {selected.author ? `by ${selected.author} · ` : ''}
                    {selected.source === 'git' ? `commit ${String(selected.id).slice(0, 7)}` : 'snapshot'}
                    {diff && (diff.added || diff.removed
                      ? <> · <span className="diff-count add">+{diff.added}</span> <span className="diff-count del">−{diff.removed}</span> characters vs now</>
                      : ' · identical to the current note')}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: 'Restore this version?', message: 'The current content is saved to history first, so you can undo this.', confirmText: 'Restore' }))) return
                    setBusy(true)
                    try {
                      await api.restoreVersion(wsId, path, selected.id, selected.path !== path ? selected.path : undefined)
                      toast.success('Version restored')
                      close()
                    } catch (e) {
                      toast.error(e)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? <Spinner size="sm" /> : <RotateCcw />} {busy ? 'Restoring…' : 'Restore this version'}
                </button>
              </div>
              {showDiff ? <div className="diff" dangerouslySetInnerHTML={{ __html: diff?.html || '' }} /> : <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(content, { ws: wsId, path }).html }} />}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Move to folder ----------------

export function MoveModal({ path }) {
  const close = useUI((s) => s.closeModal)
  const tree = useApp((s) => s.tree)
  const [query, setQuery] = useState('')
  const folders = useMemo(() => ['', ...tree.filter((e) => e.type === 'folder').map((e) => e.path)].filter((f) => f !== path && !f.startsWith(path + '/')), [tree, path])
  const results = fuzzyFilter(folders, query, (f) => f || 'Vault root', 40)
  const currentFolder = dirname(path)
  const [sel, setSel] = useState(0)
  const listRef = useRef(null)
  const at = Math.min(sel, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' })
  }, [at, query])

  const moveTo = async (folder) => {
    close()
    await A.moveEntryWithUndo(path, folder)
  }

  return (
    <Modal title={`Move “${basename(path)}”`} center onClose={close} icon={<Folder size={18} />}>
      <div className="search-box" style={{ margin: '0 0 10px' }}>
        <Search />
        <input
          className="input"
          autoFocus
          placeholder="Search folders…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (!results.length) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((i) => (Math.min(i, results.length - 1) + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              moveTo(results[at].item)
            }
          }}
        />
      </div>
      <div style={{ maxHeight: 340, overflow: 'auto' }} ref={listRef}>
        {!results.length && <div className="empty">No folder matches “{query}”</div>}
        {results.map(({ item }, i) => (
          <button
            key={item || '/'}
            className={`ws-list-item ${item === currentFolder ? 'current' : ''} ${i === at ? 'is-sel' : ''}`}
            onMouseMove={() => setSel(i)}
            onClick={() => moveTo(item)}
          >
            <Folder size={16} style={{ color: 'var(--text-3)' }} />
            <span className="grow truncate">{item || 'Vault root'}</span>
            {item === currentFolder && <span className="badge">current</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}

// ---------------- Import ----------------

export function ImportModal() {
  const close = useUI((s) => s.closeModal)
  const [busy, setBusy] = useState(false)
  const [folder, setFolder] = useState('')
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)

  const doImport = async (files) => {
    setBusy(true)
    const n = await A.importFiles([...files], folder)
    setBusy(false)
    if (n) close()
  }

  return (
    <Modal title="Import notes" center onClose={close} icon={<Upload size={18} />}>
      <div className="field">
        <label>Destination folder (optional)</label>
        <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Leave empty for the root" />
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          doImport(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1.5px dashed ${drag ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: drag ? 'var(--accent-softer)' : 'transparent',
          borderRadius: 14,
          padding: '34px 16px',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        {busy ? (
          <Spinner />
        ) : (
          <>
            <Upload style={{ width: 26, height: 26, color: 'var(--text-3)' }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>Drop files here, or click to choose</div>
            <div className="hint" style={{ marginTop: 4 }}>
              Markdown files, images, or a .zip export of an Obsidian vault
            </div>
          </>
        )}
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => doImport(e.target.files)} />
      </div>
    </Modal>
  )
}

// ---------------- Shortcuts ----------------

export function ShortcutsModal() {
  const close = useUI((s) => s.closeModal)
  const rows = [
    ['Command palette', 'Mod K'],
    ['Quick switcher', 'Mod O'],
    ['Switch workspace', 'Mod ⇧ O'],
    ['Search all notes', 'Mod ⇧ F'],
    ['Find in note', 'Mod F'],
    ['New note', 'Mod N or Alt N'],
    ['New tab', 'Alt T'],
    ['Close tab', 'Alt W'],
    ['Daily note', 'Mod D'],
    ['Graph view', 'Mod G'],
    ['Reading view', 'Mod E'],
    ['Toggle left sidebar', 'Mod \\'],
    ['Toggle right sidebar', 'Mod ⇧ \\'],
    ['Focus mode', 'Mod ⇧ ↵'],
    ['Settings', 'Mod ,'],
    ['Bold', 'Mod B'],
    ['Italic', 'Mod I'],
    ['Highlight', 'Mod ⇧ H'],
    ['Inline code', 'Mod E (in editor)'],
    ['Insert link', 'Mod K (in editor)'],
    ['Link to note', 'Mod ⇧ K'],
    ['Toggle checkbox', 'Mod ↵'],
    ['Heading 1/2/3', 'Mod 1/2/3'],
    ['Quote', 'Mod ⇧ Q'],
    ['Code block', 'Mod ⇧ C'],
    ['Undo / redo', 'Mod Z / Mod ⇧ Z'],
    ['New whiteboard', 'Alt B'],
    ['Canvas tools on a note', 'Alt C'],
  ]
  // canvas keys work on whiteboards, and on notes once you click the canvas (outside the text)
  const canvas = [
    ['Select', 'V'],
    ['Pan', 'H · Space + drag · middle mouse'],
    ['Rectangle / ellipse / diamond', 'R / O / D'],
    ['Arrow / line', 'A / L'],
    ['Draw / highlighter', 'P / M'],
    ['Text / sticky note', 'T / N'],
    ['Image / link a page', 'I / K'],
    ['Frame (whiteboards)', 'F'],
    ['Eraser / laser pointer', 'E / X'],
    ['Keep tool selected', 'Q'],
    ['Grid & snapping', 'G'],
    ['Zoom', 'Mod + wheel · Mod + / −'],
    ['Zoom to fit / 100%', '⇧ 1 / Mod 0'],
    ['Duplicate', 'Mod D · Alt + drag'],
    ['Group / ungroup', 'Mod G / Mod ⇧ G'],
    ['Lock', 'Mod ⇧ L'],
    ['Bring forward / back', '] / [ (Mod for front / back)'],
    ['Nudge', 'Arrows (⇧ for 10px)'],
    ['Straight lines, squares', 'hold ⇧ while drawing'],
    ['Edit text or label', 'double-click · Enter'],
  ]
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
  const grid = (list) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: '10px 18px' }}>
      {list.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <span className="muted">{k}</span>
          <kbd>{v.replaceAll('Mod', mod)}</kbd>
        </div>
      ))}
    </div>
  )
  return (
    <Modal title="Keyboard shortcuts" center onClose={close} className="wide">
      {grid(rows)}
      <h3 className="shortcut-group">Whiteboards & note canvas</h3>
      {grid(canvas)}
    </Modal>
  )
}
