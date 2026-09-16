import { useEffect, useState, useCallback } from 'react'
import { Users, FolderGit2, Globe, Activity, UserPlus, HardDrive, Link2, MoreHorizontal, ShieldCheck, Trash2, KeyRound, Ban, CheckCircle2, ArrowLeft, RefreshCw, Copy, Cloud, Cpu, Radio } from 'lucide-react'
import { api } from '../lib/api.js'
import { useApp } from '../store/app.js'
import { navigate } from '../lib/router.js'
import { Avatar, Modal, Switch, Spinner, menuFromElement } from '../components/ui.jsx'
import { PasswordInput } from './Auth.jsx'
import { useUI, toast, confirmDialog, promptDialog } from '../store/ui.js'
import { timeAgo, formatBytes, copyText } from '../lib/util.js'
import { StorageWarning } from '../components/StorageWarning.jsx'

export default function AdminPage() {
  const user = useApp((s) => s.user)
  const [data, setData] = useState(null)
  const [creating, setCreating] = useState(false)
  const [invite, setInvite] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyRow, setBusyRow] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.adminOverview())
    } catch (e) {
      toast.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = 'Admin · Obi'
    if (user?.isAdmin) load()
  }, [user, load])

  if (!user?.isAdmin) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <ShieldCheck style={{ width: 36, height: 36, color: 'var(--text-3)' }} />
          <h1 style={{ marginTop: 12 }}>Admins only</h1>
          <p className="sub">Your account doesn't have access to the admin console.</p>
          <button className="btn btn-block" onClick={() => navigate('/')}>
            Back to notes
          </button>
        </div>
      </div>
    )
  }

  const runFor = async (id, fn, okMessage) => {
    setBusyRow(id)
    try {
      await fn()
      if (okMessage) toast.success(okMessage)
      await load()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusyRow(null)
    }
  }

  const userMenu = (e, u) => {
    const self = u.id === user.id
    useUI.getState().showContextMenu(menuFromElement(e.currentTarget), [
      {
        label: 'Reset password…',
        icon: KeyRound,
        run: async () => {
          const pw = await promptDialog({ title: `Reset password for ${u.displayName}`, message: 'They will be signed out everywhere and asked to choose a new password on next login.', placeholder: 'New password (min 8 characters)' })
          if (!pw) return
          runFor(u.id, () => api.adminUpdateUser(u.id, { password: pw, mustChangePassword: !self }), 'Password updated')
        },
      },
      {
        label: 'Rename…',
        icon: Users,
        run: async () => {
          const name = await promptDialog({ title: 'Display name', value: u.displayName })
          if (!name) return
          runFor(u.id, () => api.adminUpdateUser(u.id, { displayName: name }))
        },
      },
      !self && {
        label: u.isAdmin ? 'Remove admin access' : 'Make admin',
        icon: ShieldCheck,
        run: () => runFor(u.id, () => api.adminUpdateUser(u.id, { isAdmin: !u.isAdmin }), u.isAdmin ? 'Admin access removed' : 'Now an admin'),
      },
      !self && {
        label: u.disabled ? 'Enable account' : 'Disable account',
        icon: u.disabled ? CheckCircle2 : Ban,
        run: () => runFor(u.id, () => api.adminUpdateUser(u.id, { disabled: !u.disabled }), u.disabled ? 'Account enabled' : 'Account disabled'),
      },
      !self && 'divider',
      !self && {
        label: 'Delete user',
        icon: Trash2,
        danger: true,
        run: async () => {
          const ok = await confirmDialog({ title: `Delete ${u.displayName}?`, message: 'This permanently deletes the user and every workspace they own (GitHub repositories themselves are not touched).', danger: true, confirmText: 'Delete user' })
          if (!ok) return
          runFor(u.id, () => api.adminDeleteUser(u.id), 'User deleted')
        },
      },
    ])
  }

  const createInvite = async () => {
    const note = await promptDialog({ title: 'Create invite link', message: 'Anyone with this link can create one account. Links expire after 7 days.', placeholder: 'Note (optional), e.g. "For Sam"', allowEmpty: true, confirmText: 'Create link' })
    if (note === null) return
    try {
      const r = await api.adminCreateInvite({ note })
      setInvite(`${location.origin}/signup?invite=${r.token}`)
      load()
    } catch (e) {
      toast.error(e)
    }
  }

  const s = data?.stats
  return (
    <div className="admin">
      <div className="admin-top">
        <button className="icon-btn" onClick={() => navigate('/')} title="Back to notes">
          <ArrowLeft />
        </button>
        <img src="/favicon.svg" alt="" />
        <h1>Obi Admin</h1>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>
      <div className="admin-wrap">
        <div className="admin-hero">
          <div>
            <h2>Console</h2>
            <div className="muted" style={{ marginTop: 4 }}>
              Manage who can use this Obi instance.
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={createInvite}>
              <Link2 /> Invite link
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <UserPlus /> New user
            </button>
          </div>
        </div>

        {!data ? (
          <div className="row" style={{ justifyContent: 'center', padding: 40 }}>
            <Spinner />
          </div>
        ) : (
          <>
            <StorageWarning storage={data.storage} />
            <div className="stats">
              <Stat icon={Users} label="Users" value={s.users} />
              <Stat icon={Radio} label="Online now" value={s.online} />
              <Stat icon={Cloud} label="Workspaces" value={s.workspaces} />
              <Stat icon={FolderGit2} label="GitHub synced" value={s.github} />
              <Stat icon={Globe} label="Published notes" value={s.publishedNotes} />
              <Stat icon={Cpu} label="Memory" value={formatBytes(s.memory)} />
              <Stat
                icon={HardDrive}
                label="Storage"
                value={data.storage.persistent ? 'Persistent' : 'Temporary'}
                sub={`${data.storage.source || data.storage.kind} · data since ${new Date(data.storage.createdAt).toLocaleDateString()}`}
                tone={data.storage.persistent ? null : 'danger'}
              />
            </div>

            <div className="card">
              <div className="card-head">
                <Users size={16} />
                <h3>Users</h3>
                <span className="badge">{data.users.length}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Workspaces</th>
                      <th>Last sign in</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="user-cell">
                            <Avatar name={u.displayName} color={u.color} size={30} />
                            <div>
                              <div style={{ fontWeight: 550 }}>
                                {u.displayName} {u.id === user.id && <span className="badge">you</span>}
                              </div>
                              <div className="faint" style={{ fontSize: 12 }}>
                                @{u.username}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{u.isAdmin ? <span className="badge accent"><ShieldCheck /> Admin</span> : <span className="badge">Member</span>}</td>
                        <td>
                          {u.disabled ? (
                            <span className="badge danger">Disabled</span>
                          ) : u.online ? (
                            <span className="row" style={{ gap: 7 }}>
                              <span className="online-dot" /> Online
                            </span>
                          ) : (
                            <span className="faint">Offline</span>
                          )}
                          {u.mustChangePassword && <span className="badge warning" style={{ marginLeft: 6 }}>Password reset pending</span>}
                        </td>
                        <td>{u.workspaceCount}</td>
                        <td className="faint">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {busyRow === u.id ? (
                            <Spinner size="sm" />
                          ) : (
                            <button className="icon-btn" onClick={(e) => userMenu(e, u)}>
                              <MoreHorizontal />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <Cloud size={16} />
                <h3>Workspaces</h3>
                <span className="badge">{data.workspaces.length}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Type</th>
                      <th>Owner</th>
                      <th>Members</th>
                      <th>Sync</th>
                      <th>Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.workspaces.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <div style={{ fontWeight: 550 }}>
                            {w.icon} {w.name}
                          </div>
                          {w.loaded && <div className="faint" style={{ fontSize: 12 }}>{w.noteCount} notes · {w.liveDocs} open</div>}
                        </td>
                        <td>{w.type === 'github' ? <span className="badge"><FolderGit2 /> {w.repo}</span> : <span className="badge accent"><Cloud /> Online</span>}</td>
                        <td>@{w.owner.username}</td>
                        <td>{w.memberCount}</td>
                        <td>{w.type !== 'github' ? <span className="faint">—</span> : w.syncError ? <span className="badge danger" title={w.syncError}>Error</span> : <span className="faint">{w.lastSync ? timeAgo(w.lastSync) : 'Never'}</span>}</td>
                        <td className="faint">{timeAgo(w.createdAt)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="icon-btn"
                            title="Delete workspace"
                            disabled={busyRow === w.id}
                            onClick={async () => {
                              const ok = await confirmDialog({ title: `Delete “${w.name}”?`, message: w.type === 'github' ? 'Removes the server copy. The GitHub repository is not affected.' : 'All notes in this workspace will be permanently deleted.', danger: true, confirmText: 'Delete' })
                              if (!ok) return
                              runFor(w.id, () => api.adminDeleteWorkspace(w.id), 'Workspace deleted')
                            }}
                          >
                            {busyRow === w.id ? <Spinner size="sm" /> : <Trash2 />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {data.invites.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <Link2 size={16} />
                  <h3>Invite links</h3>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Note</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.invites.map((i) => (
                        <tr key={i.id}>
                          <td>{i.note || <span className="faint">—</span>}</td>
                          <td>{i.usedBy ? <span className="badge success">Used by @{i.usedBy}</span> : i.expiresAt < Date.now() ? <span className="badge">Expired</span> : <span className="badge accent">Active · expires {new Date(i.expiresAt).toLocaleDateString()}</span>}</td>
                          <td className="faint">{timeAgo(i.createdAt)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {!i.usedBy && (
                              <button
                                className="icon-btn"
                                onClick={async () => {
                                  await api.adminDeleteInvite(i.id)
                                  load()
                                }}
                              >
                                <Trash2 />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
              <Activity size={12} style={{ verticalAlign: -2 }} /> Uptime {Math.round(s.uptime / 3600)}h · {s.sessions} active sessions
            </div>
          </>
        )}
      </div>

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
      {invite && (
        <Modal title="Invite link ready" center onClose={() => setInvite(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            Share this link — it can be used once to create an account.
          </p>
          <div className="link-copy">
            <input className="input mono" readOnly value={invite} onFocus={(e) => e.target.select()} />
            <button
              className="btn btn-primary"
              onClick={() => {
                copyText(invite)
                toast.success('Copied')
              }}
            >
              <Copy /> Copy
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">
        <Icon /> {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub" title={sub}>{sub}</div>}
    </div>
  )
}

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ displayName: '', username: '', password: '', isAdmin: false, mustChangePassword: true })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const generate = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const arr = crypto.getRandomValues(new Uint32Array(14))
    set({ password: Array.from(arr, (n) => chars[n % chars.length]).join('') })
  }
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api.adminCreateUser(form)
      toast.success(`Created @${form.username}`, form.password ? { action: { label: 'Copy password', run: () => copyText(form.password) }, timeout: 10000 } : undefined)
      onCreated()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Create user"
      center
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.username || !form.password}>
            {busy ? <Spinner size="sm" /> : 'Create user'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Display name</label>
        <input className="input" value={form.displayName} onChange={(e) => set({ displayName: e.target.value, username: form.username || '' })} placeholder="Sam Rivera" autoFocus />
      </div>
      <div className="field">
        <label>Username</label>
        <input className="input" value={form.username} onChange={(e) => set({ username: e.target.value.replace(/\s/g, '') })} placeholder="sam" autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="field">
        <label className="row" style={{ justifyContent: 'space-between' }}>
          Password
          <button type="button" className="btn btn-ghost btn-sm" onClick={generate}>
            Generate
          </button>
        </label>
        <PasswordInput value={form.password} onChange={(v) => set({ password: v })} placeholder="At least 8 characters" autoComplete="new-password" />
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">Require password change</div>
          <div className="setting-desc">Ask them to choose their own password on first sign in.</div>
        </div>
        <Switch checked={form.mustChangePassword} onChange={(v) => set({ mustChangePassword: v })} />
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-name">Administrator</div>
          <div className="setting-desc">Can open /admin and manage all users.</div>
        </div>
        <Switch checked={form.isAdmin} onChange={(v) => set({ isAdmin: v })} />
      </div>
      <p className="hint">Every new user gets a private “Personal” online workspace. They can connect GitHub repos themselves.</p>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  )
}
