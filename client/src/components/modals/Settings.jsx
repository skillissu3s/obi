import { useEffect, useState } from 'react'
import {
  User, Palette, Pencil, Layers, Users, FolderGit2, Trash2, Info, LogOut, KeyRound, Monitor, Sun, Moon, RefreshCw,
  Download, Upload, Plus, Check, X, Shield, Cloud, AlertTriangle, ExternalLink, Copy, CalendarDays, FileText, Clock,
} from 'lucide-react'
import { Modal, Switch, Segmented, Spinner, Avatar, WsIcon, EmojiPicker } from '../ui.jsx'
import { usePrefs, ACCENTS, PALETTES } from '../../store/prefs.js'
import { useApp } from '../../store/app.js'
import { useUI, toast, confirmDialog } from '../../store/ui.js'
import { api } from '../../lib/api.js'
import * as A from '../../lib/actions.js'
import { navigate } from '../../lib/router.js'
import { conn } from '../../lib/socket.js'
import { timeAgo, formatBytes, copyText, modKey } from '../../lib/util.js'
import { PasswordInput } from '../../pages/Auth.jsx'
import { basename, stripExt } from '@shared/paths.js'

function Setting({ name, desc, children }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <div className="setting-name">{name}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function SettingsModal({ section: initial }) {
  const [section, setSection] = useState(initial || 'appearance')
  const close = useUI((s) => s.closeModal)
  const user = useApp((s) => s.user)
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const ws = workspaces.find((w) => w.id === wsId)
  const isOwner = ws?.role === 'owner'

  const nav = [
    { group: 'You' },
    { id: 'account', label: 'Account', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'editor', label: 'Editor', icon: Pencil },
    { group: 'Workspace' },
    { id: 'workspace', label: 'General', icon: Layers },
    ws?.type === 'github' && { id: 'github', label: 'GitHub sync', icon: FolderGit2 },
    ws?.type === 'online' && { id: 'members', label: 'Members', icon: Users },
    { id: 'notes-settings', label: 'Notes & daily', icon: CalendarDays },
    { id: 'data', label: 'Import & export', icon: Download },
    ws?.type === 'online' && { id: 'trash', label: 'Trash', icon: Trash2 },
    { group: 'App' },
    { id: 'workspaces', label: 'All workspaces', icon: Cloud },
    { id: 'about', label: 'About', icon: Info },
  ].filter(Boolean)

  return (
    <Modal title={null} onClose={close} className="xwide" bodyClass="">
      <div className="settings">
        <div className="settings-nav">
          {nav.map((n, i) =>
            n.group ? (
              <div className="nav-label" key={i}>
                {n.group}
              </div>
            ) : (
              <button key={n.id} className={section === n.id ? 'active' : ''} onClick={() => setSection(n.id)}>
                <n.icon /> {n.label}
              </button>
            ),
          )}
        </div>
        <div className="settings-body">
          {section === 'account' && <AccountSection user={user} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'editor' && <EditorSection />}
          {section === 'workspace' && <WorkspaceSection ws={ws} isOwner={isOwner} />}
          {section === 'github' && <GithubSection ws={ws} isOwner={isOwner} />}
          {section === 'members' && <MembersSection ws={ws} isOwner={isOwner} />}
          {section === 'notes-settings' && <NotesSection ws={ws} isOwner={isOwner} />}
          {section === 'data' && <DataSection ws={ws} />}
          {section === 'trash' && <TrashSection ws={ws} />}
          {section === 'workspaces' && <WorkspacesSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </Modal>
  )
}

function AccountSection({ user }) {
  const [name, setName] = useState(user?.displayName || '')
  const [pw, setPw] = useState({ current: '', next: '' })
  const [sessions, setSessions] = useState(null)
  useEffect(() => {
    api.sessions().then((r) => setSessions(r.sessions)).catch(() => {})
  }, [])

  const saveName = async () => {
    try {
      const { user: u } = await api.updateMe({ displayName: name })
      useApp.getState().setUser(u)
      toast.success('Saved')
    } catch (e) {
      toast.error(e)
    }
  }
  const changePw = async () => {
    try {
      await api.changePassword(pw.current, pw.next)
      setPw({ current: '', next: '' })
      toast.success('Password changed — other devices were signed out')
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <>
      <h2>Account</h2>
      <p className="section-sub">Your profile and security.</p>
      <div className="row" style={{ gap: 14, marginBottom: 10 }}>
        <Avatar name={user.displayName} color={user.color} size={54} />
        <div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{user.displayName}</div>
          <div className="faint">
            @{user.username} {user.isAdmin && <span className="badge accent">Admin</span>}
          </div>
        </div>
      </div>
      <Setting name="Display name" desc="Shown to collaborators on shared notes.">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
      </Setting>
      <Setting name="Cursor colour" desc="Your colour in shared documents.">
        <div className="accent-swatches">
          {['#2f9e78', '#d1703f', '#b8604f', '#c0913a', '#2a93a3', '#5566cf', '#96549e', '#7f9a44', '#c26a8a', '#7c776d'].map((c) => (
            <button
              key={c}
              className={`swatch ${user.color === c ? 'active' : ''}`}
              style={{ background: c, color: c }}
              onClick={async () => {
                const { user: u } = await api.updateMe({ color: c })
                useApp.getState().setUser(u)
              }}
            />
          ))}
        </div>
      </Setting>
      <h3>Change password</h3>
      <div className="field">
        <label>Current password</label>
        <PasswordInput value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} />
      </div>
      <div className="field">
        <label>New password</label>
        <PasswordInput value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" placeholder="At least 8 characters" />
      </div>
      <button className="btn btn-primary" disabled={!pw.current || pw.next.length < 8} onClick={changePw}>
        <KeyRound /> Update password
      </button>

      <h3>Sessions</h3>
      {!sessions && <Spinner size="sm" />}
      {sessions?.map((s) => (
        <div className="setting" key={s.id}>
          <div className="setting-text">
            <div className="setting-name">
              {s.current ? 'This device' : 'Other device'} {s.current && <span className="badge accent">current</span>}
            </div>
            <div className="setting-desc truncate">
              {s.user_agent || 'Unknown'} · {timeAgo(s.last_seen_at)} · {s.ip}
            </div>
          </div>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button
          className="btn"
          onClick={async () => {
            await api.revokeOtherSessions()
            setSessions((s) => s.filter((x) => x.current))
            toast.success('Signed out everywhere else')
          }}
        >
          Sign out other devices
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Sign out?', confirmText: 'Sign out' }))) return
            await api.logout()
            conn.stop()
            useApp.setState({ user: null })
            navigate('/login')
          }}
        >
          <LogOut /> Sign out
        </button>
      </div>
    </>
  )
}

function AppearanceSection() {
  const prefs = usePrefs()
  const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  return (
    <>
      <h2>Appearance</h2>
      <p className="section-sub">Make Obi feel like yours.</p>
      <Setting name="Mode">
        <Segmented
          value={prefs.theme}
          onChange={(v) => prefs.set({ theme: v })}
          options={[
            { value: 'dark', label: 'Dark', icon: <Moon /> },
            { value: 'light', label: 'Light', icon: <Sun /> },
            { value: 'system', label: 'System', icon: <Monitor /> },
          ]}
        />
      </Setting>

      <h3>Colour theme</h3>
      <div className="palette-grid">
        {PALETTES.map((p) => {
          const [bg, fg, accent] = p[mode]
          return (
            <button key={p.id} className={`palette-card ${prefs.palette === p.id ? 'active' : ''}`} onClick={() => prefs.set({ palette: p.id })} title={p.note}>
              <span className="palette-swatch" style={{ background: bg }}>
                <i style={{ background: fg }} />
                <i style={{ background: accent }} />
                <i style={{ background: `color-mix(in srgb, ${fg} 35%, ${bg})` }} />
              </span>
              <span className="palette-meta">
                <b>{p.name}</b>
                <em>{p.note}</em>
              </span>
              {prefs.palette === p.id && <Check className="palette-check" />}
            </button>
          )
        })}
      </div>

      <Setting name="Accent colour" desc="Overrides the accent that comes with the theme.">
        <div className="accent-swatches">
          <button
            title="Use the theme's own accent"
            className={`swatch swatch-auto ${!prefs.accent ? 'active' : ''}`}
            style={{ color: 'var(--accent)' }}
            onClick={() => prefs.set({ accent: null })}
          />
          {ACCENTS.map((a) => (
            <button key={a.value} title={a.name} className={`swatch ${prefs.accent === a.value ? 'active' : ''}`} style={{ background: a.value, color: a.value }} onClick={() => prefs.set({ accent: a.value })} />
          ))}
        </div>
      </Setting>
      <Setting name="Interface size">
        <Segmented
          value={prefs.uiScale}
          onChange={(v) => prefs.set({ uiScale: v })}
          options={[
            { value: 'small', label: 'S' },
            { value: 'default', label: 'M' },
            { value: 'large', label: 'L' },
          ]}
        />
      </Setting>
      <Setting name="Editor font">
        <Segmented
          value={prefs.editorFont}
          onChange={(v) => prefs.set({ editorFont: v })}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
        />
      </Setting>
      <Setting name="Font size" desc={`${prefs.fontSize}px`}>
        <input type="range" min="13" max="22" value={prefs.fontSize} onChange={(e) => prefs.set({ fontSize: Number(e.target.value) })} style={{ width: 200, accentColor: 'var(--accent)' }} />
      </Setting>
      <Setting name="Line height" desc={String(prefs.lineHeight)}>
        <input type="range" min="1.3" max="2.2" step="0.05" value={prefs.lineHeight} onChange={(e) => prefs.set({ lineHeight: Number(e.target.value) })} style={{ width: 200, accentColor: 'var(--accent)' }} />
      </Setting>
      <Setting name="Readable line width" desc="Keep lines comfortably short instead of full width.">
        <Switch checked={prefs.readableWidth} onChange={(v) => prefs.set({ readableWidth: v })} />
      </Setting>
      <Setting name="Strike through completed tasks">
        <Switch checked={prefs.strikeDone} onChange={(v) => prefs.set({ strikeDone: v })} />
      </Setting>
    </>
  )
}

function EditorSection() {
  const prefs = usePrefs()
  return (
    <>
      <h2>Editor</h2>
      <p className="section-sub">How writing behaves.</p>
      <Setting name="Default view" desc="Live preview renders formatting as you type; source shows raw markdown.">
        <Segmented
          value={prefs.defaultMode}
          onChange={(v) => prefs.set({ defaultMode: v })}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'source', label: 'Source' },
            { value: 'read', label: 'Reading' },
          ]}
        />
      </Setting>
      <Setting name="Show note title at top" desc="Edit the file name inline, like a document title.">
        <Switch checked={prefs.inlineTitle} onChange={(v) => prefs.set({ inlineTitle: v })} />
      </Setting>
      <Setting name="Spell check">
        <Switch checked={prefs.spellcheck} onChange={(v) => prefs.set({ spellcheck: v })} />
      </Setting>
      <Setting name="Line numbers" desc="Only shown in source view.">
        <Switch checked={prefs.lineNumbers} onChange={(v) => prefs.set({ lineNumbers: v })} />
      </Setting>
      <Setting name="Confirm before deleting" desc="Ask before deleting notes and folders.">
        <Switch checked={prefs.confirmDelete} onChange={(v) => prefs.set({ confirmDelete: v })} />
      </Setting>
    </>
  )
}

function WorkspaceSection({ ws, isOwner }) {
  const [name, setName] = useState(ws?.name || '')
  const [icon, setIcon] = useState(ws?.icon || '')
  useEffect(() => {
    setName(ws?.name || '')
    setIcon(ws?.icon || '')
  }, [ws?.id])
  if (!ws) return null

  const save = async (patch) => {
    try {
      await api.updateWorkspace(ws.id, patch)
      await useApp.getState().loadWorkspaces()
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <>
      <h2>Workspace</h2>
      <p className="section-sub">
        {ws.type === 'github' ? 'Notes live in your GitHub repository.' : 'Notes live on this server and can be shared with other people.'}
      </p>
      <div className="row" style={{ gap: 12, marginBottom: 14 }}>
        <WsIcon ws={ws} size={48} />
        <div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{ws.name}</div>
          <div className="faint">
            {ws.type === 'github' ? (
              <span className="badge">
                <FolderGit2 /> {ws.github?.label} · {ws.github?.branch}
              </span>
            ) : (
              <span className="badge accent">
                <Cloud /> Online
              </span>
            )}{' '}
            · owned by {ws.owner?.name}
          </div>
        </div>
      </div>
      <Setting name="Name">
        <input className="input" value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} onBlur={() => name !== ws.name && save({ name })} />
      </Setting>
      <Setting name="Icon">
        <div style={{ width: 260 }}>
          <EmojiPicker
            value={icon}
            onChange={(v) => {
              setIcon(v)
              save({ icon: v })
            }}
          />
        </div>
      </Setting>
      <h3>Danger zone</h3>
      {ws.role === 'owner' ? (
        <Setting name="Delete workspace" desc={ws.type === 'github' ? 'Removes the server copy and its settings. Your GitHub repository is not touched.' : 'Permanently deletes all notes in this workspace.'}>
          <button
            className="btn btn-danger"
            onClick={async () => {
              const ok = await confirmDialog({ title: `Delete “${ws.name}”?`, message: ws.type === 'github' ? 'The GitHub repository stays safe — only the copy on this server is removed.' : 'All notes in this workspace will be permanently deleted.', danger: true, confirmText: 'Delete workspace' })
              if (!ok) return
              try {
                await api.deleteWorkspace(ws.id)
                const list = await useApp.getState().loadWorkspaces()
                useUI.getState().closeModal()
                if (list[0]) useApp.getState().openWorkspace(list[0].id)
              } catch (e) {
                toast.error(e)
              }
            }}
          >
            <Trash2 /> Delete
          </button>
        </Setting>
      ) : (
        <Setting name="Leave workspace" desc="You will lose access until the owner invites you again.">
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!(await confirmDialog({ title: `Leave “${ws.name}”?`, danger: true, confirmText: 'Leave' }))) return
              await api.leaveWorkspace(ws.id)
              const list = await useApp.getState().loadWorkspaces()
              useUI.getState().closeModal()
              if (list[0]) useApp.getState().openWorkspace(list[0].id)
            }}
          >
            Leave
          </button>
        </Setting>
      )}
    </>
  )
}

function GithubSection({ ws, isOwner }) {
  const sync = useApp((s) => s.sync)
  const [token, setToken] = useState('')
  const [branch, setBranch] = useState(ws?.github?.branch || '')
  const [repo, setRepo] = useState(ws?.github?.repo || '')
  const [saving, setSaving] = useState(false)
  const s = ws?.settings || {}

  const save = async (patch) => {
    try {
      await api.updateWorkspace(ws.id, patch)
      await useApp.getState().loadWorkspaces()
      toast.success('Saved')
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <>
      <h2>GitHub sync</h2>
      <p className="section-sub">Obi keeps a working copy on the server, commits your edits and pushes them to GitHub. Changes made in Obsidian are pulled back automatically.</p>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <FolderGit2 size={16} />
          <h3>{ws.github?.label}</h3>
          <span className="badge">{ws.github?.branch}</span>
          <a className="btn btn-ghost btn-sm" href={ws.github?.repo?.replace(/\.git$/, '')} target="_blank" rel="noreferrer">
            <ExternalLink /> Open
          </a>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="setting-name">
                {sync?.state === 'error' ? <span style={{ color: 'var(--danger)' }}>Sync error</span> : sync?.state === 'syncing' ? 'Syncing…' : sync?.pending ? `${sync.pending} change(s) waiting` : 'Everything synced'}
              </div>
              <div className="setting-desc">{sync?.error || (sync?.lastSync ? `Last sync ${timeAgo(sync.lastSync)}` : 'Not synced yet')}</div>
            </div>
            <button className="btn" onClick={() => A.syncNow()}>
              <RefreshCw className={sync?.state === 'syncing' ? 'spin' : ''} /> Sync now
            </button>
          </div>
        </div>
      </div>

      <Setting name="Automatic sync" desc="Push your edits and pull remote changes in the background.">
        <Switch checked={s.autoSync !== false} onChange={(v) => save({ settings: { autoSync: v } })} />
      </Setting>
      <Setting name="Push after" desc="Seconds of inactivity before committing and pushing.">
        <input className="input" type="number" min="5" max="600" defaultValue={s.autoSyncSeconds ?? 30} onBlur={(e) => save({ settings: { autoSyncSeconds: Number(e.target.value) } })} style={{ width: 110 }} />
      </Setting>
      <Setting name="Pull every" desc="Seconds between checks for changes made elsewhere (e.g. Obsidian).">
        <input className="input" type="number" min="30" max="3600" defaultValue={s.pullIntervalSeconds ?? 120} onBlur={(e) => save({ settings: { pullIntervalSeconds: Number(e.target.value) } })} style={{ width: 110 }} />
      </Setting>
      <Setting name="Commit author" desc="Name and email used for commits Obi creates.">
        <div className="row">
          <input className="input" placeholder="Name" defaultValue={s.authorName || ''} onBlur={(e) => save({ settings: { authorName: e.target.value } })} style={{ width: 130 }} />
          <input className="input" placeholder="email@example.com" defaultValue={s.authorEmail || ''} onBlur={(e) => save({ settings: { authorEmail: e.target.value } })} style={{ width: 180 }} />
        </div>
      </Setting>

      {isOwner && (
        <>
          <h3>Connection</h3>
          <Setting name="Access token" desc="Paste a new fine-grained personal access token with Contents: read & write. Stored encrypted.">
            <div className="row">
              <input className="input" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: 200 }} />
              <button
                className="btn"
                disabled={!token || saving}
                onClick={async () => {
                  setSaving(true)
                  await save({ github: { token } })
                  setToken('')
                  setSaving(false)
                }}
              >
                Update
              </button>
            </div>
          </Setting>
          <Setting name="Repository & branch" desc="Changing these re-clones the repository on the server. Make sure everything is synced first.">
            <div className="row">
              <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} style={{ width: 240 }} />
              <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} style={{ width: 100 }} />
              <button
                className="btn"
                disabled={repo === ws.github?.repo && branch === ws.github?.branch}
                onClick={async () => {
                  const ok = await confirmDialog({ title: 'Re-clone repository?', message: 'Any changes that have not been pushed yet will be lost.', danger: true, confirmText: 'Re-clone' })
                  if (!ok) return
                  await save({ github: { repoUrl: repo, branch } })
                  useApp.getState().openWorkspace(ws.id)
                }}
              >
                Apply
              </button>
            </div>
          </Setting>
        </>
      )}
    </>
  )
}

function MembersSection({ ws, isOwner }) {
  const [members, setMembers] = useState([])
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('editor')
  const me = useApp((s) => s.user)

  const load = () => api.members(ws.id).then((r) => setMembers(r.members)).catch(() => {})
  useEffect(() => {
    load()
    api.users().then((r) => setUsers(r.users)).catch(() => {})
  }, [ws.id])

  const add = async () => {
    try {
      await api.addMember(ws.id, username.replace(/^@/, ''), role)
      setUsername('')
      load()
      toast.success('Member added')
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <>
      <h2>Members</h2>
      <p className="section-sub">Everyone here sees the whole workspace and edits it live with you.</p>
      {isOwner && (
        <div className="row" style={{ marginBottom: 16 }}>
          <input className="input grow" list="obi-users" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <datalist id="obi-users">
            {users.filter((u) => !members.some((m) => m.id === u.id)).map((u) => (
              <option key={u.id} value={u.username}>
                {u.displayName}
              </option>
            ))}
          </datalist>
          <select className="select" style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn btn-primary" disabled={!username} onClick={add}>
            <Plus /> Invite
          </button>
        </div>
      )}
      {members.map((m) => (
        <div className="person-row" key={m.id}>
          <Avatar name={m.displayName} color={m.color} size={32} />
          <div className="grow">
            <div style={{ fontWeight: 550 }}>
              {m.displayName} {m.id === me?.id && <span className="badge">you</span>}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              @{m.username} · added {timeAgo(m.addedAt)}
            </div>
          </div>
          {m.role === 'owner' ? (
            <span className="badge accent">Owner</span>
          ) : isOwner ? (
            <>
              <select
                className="select"
                value={m.role}
                onChange={async (e) => {
                  await api.setMemberRole(ws.id, m.id, e.target.value)
                  load()
                }}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button
                className="icon-btn"
                title="Remove"
                onClick={async () => {
                  await api.removeMember(ws.id, m.id)
                  load()
                }}
              >
                <X />
              </button>
            </>
          ) : (
            <span className="badge">{m.role === 'editor' ? 'Can edit' : 'Can view'}</span>
          )}
        </div>
      ))}
    </>
  )
}

function NotesSection({ ws, isOwner }) {
  const s = ws?.settings || {}
  const save = async (patch) => {
    try {
      await api.updateWorkspace(ws.id, { settings: patch })
      await useApp.getState().loadWorkspaces()
    } catch (e) {
      toast.error(e)
    }
  }
  return (
    <>
      <h2>Notes & daily notes</h2>
      <p className="section-sub">Where new things go.</p>
      <Setting name="Daily notes folder" desc="Daily notes are created here.">
        <input className="input" defaultValue={s.dailyFolder ?? 'Daily'} onBlur={(e) => save({ dailyFolder: e.target.value })} />
      </Setting>
      <Setting name="Daily note format" desc="Tokens: YYYY MM DD ddd. Example: YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.">
        <input className="input" defaultValue={s.dailyFormat ?? 'YYYY-MM-DD'} onBlur={(e) => save({ dailyFormat: e.target.value })} />
      </Setting>
      <Setting name="Daily note template" desc="Path to a note used as the template, e.g. Templates/Daily.md.">
        <input className="input" defaultValue={s.dailyTemplate ?? ''} placeholder="Templates/Daily.md" onBlur={(e) => save({ dailyTemplate: e.target.value })} />
      </Setting>
      <Setting name="Templates folder" desc="Notes here show up in the / menu and “Insert template”.">
        <input className="input" defaultValue={s.templatesFolder ?? 'Templates'} onBlur={(e) => save({ templatesFolder: e.target.value })} />
      </Setting>
      <Setting name="Attachments folder" desc="Pasted images and uploads are saved here.">
        <input className="input" defaultValue={s.attachmentsFolder ?? 'attachments'} onBlur={(e) => save({ attachmentsFolder: e.target.value })} />
      </Setting>
      <Setting name="New note location" desc="Leave empty to create notes next to the note you're reading.">
        <input className="input" defaultValue={s.newNoteFolder ?? ''} placeholder="(same folder)" onBlur={(e) => save({ newNoteFolder: e.target.value })} />
      </Setting>
    </>
  )
}

function DataSection({ ws }) {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <h2>Import & export</h2>
      <p className="section-sub">Your notes are plain markdown — take them anywhere.</p>
      <Setting name="Export workspace" desc="Download every note and attachment as a .zip archive.">
        <button className="btn" onClick={() => A.exportWorkspace()}>
          <Download /> Export .zip
        </button>
      </Setting>
      <Setting name="Import files" desc="Upload markdown files, folders or a .zip (for example an Obsidian vault).">
        <label className="btn" style={{ cursor: 'pointer' }}>
          <Upload /> {busy ? 'Importing…' : 'Choose files'}
          <input
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...e.target.files]
              if (!files.length) return
              setBusy(true)
              await A.importFiles(files)
              setBusy(false)
              e.target.value = ''
            }}
          />
        </label>
      </Setting>
      <Setting name="Import a folder" desc="Keeps the folder structure (Chrome, Edge, Safari).">
        <label className="btn" style={{ cursor: 'pointer' }}>
          <Upload /> Choose folder
          <input
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            hidden
            onChange={async (e) => {
              const files = [...e.target.files]
              if (!files.length) return
              setBusy(true)
              await A.importFiles(files)
              setBusy(false)
              e.target.value = ''
            }}
          />
        </label>
      </Setting>
    </>
  )
}

function TrashSection({ ws }) {
  const [items, setItems] = useState(null)
  const load = () => api.trash(ws.id).then((r) => setItems(r.items)).catch(() => setItems([]))
  useEffect(() => {
    load()
  }, [ws.id])
  return (
    <>
      <h2>Trash</h2>
      <p className="section-sub">Deleted notes are kept for 30 days.</p>
      {!items && <Spinner size="sm" />}
      {items?.length === 0 && <div className="empty">Trash is empty</div>}
      {items?.map((i) => (
        <div className="setting" key={i.id}>
          <div className="setting-text">
            <div className="setting-name truncate">{i.path}</div>
            <div className="setting-desc">
              {i.kind} · deleted {timeAgo(i.deletedAt)} {i.deletedBy ? `by ${i.deletedBy}` : ''}
            </div>
          </div>
          <div className="setting-control">
            <button
              className="btn btn-sm"
              onClick={async () => {
                const { path } = await api.restoreTrash(ws.id, i.id)
                toast.success(`Restored to ${path}`)
                useApp.getState().refreshTree()
                useApp.getState().refreshIndex()
                load()
              }}
            >
              Restore
            </button>
            <button
              className="icon-btn"
              title="Delete permanently"
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Delete permanently?', danger: true, confirmText: 'Delete' }))) return
                await api.purgeTrash(ws.id, i.id)
                load()
              }}
            >
              <Trash2 />
            </button>
          </div>
        </div>
      ))}
      {!!items?.length && (
        <button
          className="btn btn-danger"
          style={{ marginTop: 14 }}
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Empty trash?', message: 'Everything in the trash will be permanently deleted.', danger: true, confirmText: 'Empty trash' }))) return
            await api.purgeTrash(ws.id, 'all')
            load()
          }}
        >
          <Trash2 /> Empty trash
        </button>
      )}
    </>
  )
}

function WorkspacesSection() {
  const workspaces = useApp((s) => s.workspaces)
  const wsId = useApp((s) => s.wsId)
  return (
    <>
      <h2>Workspaces</h2>
      <p className="section-sub">Each workspace is a separate set of notes — cloud or GitHub.</p>
      {workspaces.map((w) => (
        <button
          key={w.id}
          className={`ws-list-item ${w.id === wsId ? 'current' : ''}`}
          onClick={() => {
            A.switchWorkspace(w.id)
            useUI.getState().closeModal()
          }}
        >
          <WsIcon ws={w} size={32} />
          <div className="grow">
            <div style={{ fontWeight: 550 }}>{w.name}</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {w.type === 'github' ? `GitHub · ${w.github?.label}` : `Online${w.memberCount > 1 ? ` · ${w.memberCount} members` : ''}`} · {w.role}
            </div>
          </div>
          {w.id === wsId && <Check size={16} />}
        </button>
      ))}
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => useUI.getState().openModal('new-workspace')}>
        <Plus /> New workspace
      </button>
    </>
  )
}

function AboutSection() {
  const shortcuts = [
    ['Command palette', `${modKey} K`],
    ['Quick switcher', `${modKey} O`],
    ['Search all notes', `${modKey} ⇧ F`],
    ['New note', `${modKey} N / Alt N`],
    ['Daily note', `${modKey} D`],
    ['Graph view', `${modKey} G`],
    ['Reading view', `${modKey} E`],
    ['Toggle sidebar', `${modKey} \\`],
    ['Focus mode', `${modKey} ⇧ ↵`],
    ['Bold / italic / link', `${modKey} B / I / K`],
    ['Toggle checkbox', `${modKey} ↵`],
    ['Close tab', 'Alt W'],
  ]
  return (
    <>
      <h2>About Obi</h2>
      <p className="section-sub">A calm, fast, self-hosted home for your markdown notes.</p>
      <h3>Keyboard shortcuts</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 20px', maxWidth: 420 }}>
        {shortcuts.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span className="muted">{k}</span>
            <kbd>{v}</kbd>
          </div>
        ))}
      </div>
      <h3>Tips</h3>
      <ul className="hint" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
        <li>
          Type <span className="code-inline">[[</span> to link notes, <span className="code-inline">#</span> for tags, <span className="code-inline">/</span> for blocks.
        </li>
        <li>Paste or drag images straight into a note — they upload automatically.</li>
        <li>
          Add <span className="code-inline">kanban-plugin: basic</span> to a note's front matter to turn it into a board.
        </li>
        <li>Notes with the same GitHub repo stay in sync with Obsidian on your desktop.</li>
      </ul>
    </>
  )
}
