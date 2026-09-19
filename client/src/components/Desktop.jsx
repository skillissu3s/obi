// The desktop app's own screens: the first-run welcome, adding a vault, signing
// in to an Obi cloud account, and the vault's sync settings (cloud + GitHub).
import { useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Cloud, CloudOff, FolderOpen, FolderPlus, HardDrive, RefreshCw, Check, AlertTriangle, LogOut,
  FolderGit2, Download, Upload, ExternalLink, Laptop, Link2Off,
} from 'lucide-react'
import { useApp } from '../store/app.js'
import { useUI, toast, confirmDialog } from '../store/ui.js'
import { api } from '../lib/api.js'
import { desktop, dapi, useDesktop, pickFolder, folderName } from '../lib/desktop.js'
import { timeAgo } from '../lib/util.js'
import { Modal, Spinner, Segmented, Switch } from './ui.jsx'
import { PasswordInput, CodeStep } from '../pages/Auth.jsx'

async function openVault(vault) {
  await useApp.getState().loadWorkspaces()
  await useApp.getState().openWorkspace(vault.id)
  useDesktop.getState().refresh()
}

// ---------------------------------------------------------------------------
// Signing in to (or creating) an Obi cloud account

export function CloudSignIn({ onDone, onBack }) {
  const info = useDesktop((s) => s.info)
  const [stage, setStage] = useState('server') // server | signin | register | code
  const [url, setUrl] = useState(() => localStorage.getItem('obi:cloudUrl') || info?.defaultCloud || '')
  const [opts, setOpts] = useState(null)
  const [form, setForm] = useState({ identifier: '', password: '', displayName: '', email: '', username: '' })
  const [withCode, setWithCode] = useState(false)
  const [code, setCode] = useState(null) // { ticket, sentTo, register }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: typeof v === 'string' ? v : v.target.value }))

  const step = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }
  const done = async (r) => {
    if (!r?.account) return false
    await useDesktop.getState().refresh()
    onDone(r.account)
    return true
  }

  if (stage === 'code') {
    return (
      <CodeStep
        sentTo={code.sentTo}
        what={code.register ? 'to confirm your email' : 'to sign in'}
        onVerify={async (c) => {
          const r = code.register ? await dapi.cloudRegisterVerify(opts.url, code.ticket, c) : await dapi.cloudLoginVerify(opts.url, code.ticket, c)
          await done(r)
        }}
        onResend={async () => setCode({ ...code, ticket: (await dapi.cloudResend(opts.url, code.ticket)).ticket })}
        onBack={() => setStage(code.register ? 'register' : 'signin')}
      />
    )
  }

  if (stage === 'server') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          step(async () => {
            const o = await dapi.cloudOptions(url)
            localStorage.setItem('obi:cloudUrl', o.url)
            setOpts(o)
            setStage('signin')
          })
        }}
      >
        <h1>Your Obi server</h1>
        <p className="sub">The address you open Obi at in the browser.</p>
        <div className="field">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="notes.example.com" autoFocus autoCapitalize="none" spellCheck={false} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !url.trim()}>
          {busy ? <Spinner size="sm" /> : <>Continue <ArrowRight /></>}
        </button>
        {onBack && (
          <div className="auth-foot">
            <button type="button" className="link-btn" onClick={onBack}>
              <ArrowLeft /> Back
            </button>
          </div>
        )}
      </form>
    )
  }

  if (stage === 'register') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          step(async () => {
            const r = await dapi.cloudRegister(opts.url, { email: form.email, username: form.username, password: form.password, displayName: form.displayName })
            setCode({ ticket: r.ticket, sentTo: r.sentTo, register: true })
            setStage('code')
          })
        }}
      >
        <h1>Create your account</h1>
        <p className="sub">
          On <b>{opts.url.replace(/^https?:\/\//, '')}</b>. We’ll email you a code to confirm it’s you.
        </p>
        <div className="field">
          <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Your name" autoFocus />
        </div>
        <div className="field">
          <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="Email" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <input className="input" value={form.username} onChange={set('username')} placeholder="Username" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <PasswordInput value={form.password} onChange={set('password')} placeholder="Password (8+ characters)" autoComplete="new-password" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !form.email || !form.username || form.password.length < 8}>
          {busy ? <Spinner size="sm" /> : 'Continue'}
        </button>
        <div className="auth-foot">
          Have an account?{' '}
          <button type="button" className="link-btn" onClick={() => setStage('signin')}>
            Sign in
          </button>
        </div>
      </form>
    )
  }

  const codesOn = opts?.loginCode === 'either'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        step(async () => {
          if (withCode) {
            const r = await dapi.cloudLoginCode(opts.url, form.identifier)
            setCode({ ticket: r.ticket, sentTo: null })
            return setStage('code')
          }
          const r = await dapi.cloudLogin(opts.url, form.identifier, form.password)
          if (await done(r)) return
          if (r.needsCode) {
            setCode({ ticket: r.ticket, sentTo: r.sentTo })
            setStage('code')
          }
        })
      }}
    >
      <h1>Sign in</h1>
      <p className="sub">
        to <b>{opts.url.replace(/^https?:\/\//, '')}</b>
      </p>
      <div className="field">
        <input className="input" value={form.identifier} onChange={set('identifier')} placeholder="Email or username" autoFocus autoCapitalize="none" spellCheck={false} />
      </div>
      {!withCode && (
        <div className="field">
          <PasswordInput value={form.password} onChange={set('password')} />
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || !form.identifier || (!withCode && !form.password)}>
        {busy ? <Spinner size="sm" /> : withCode ? 'Email me a code' : <>Sign in <ArrowRight /></>}
      </button>
      {codesOn && (
        <button type="button" className="btn btn-ghost btn-block auth-alt" onClick={() => setWithCode(!withCode)}>
          {withCode ? 'Use my password instead' : 'Email me a sign-in code instead'}
        </button>
      )}
      <div className="auth-foot auth-foot-row">
        <button type="button" className="link-btn" onClick={() => setStage('server')}>
          <ArrowLeft /> Other server
        </button>
        {opts?.registration === 'open' && (
          <button type="button" className="link-btn" onClick={() => setStage('register')}>
            Create an account
          </button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// The cloud workspaces of an account, each ready to become a folder here

function CloudWorkspaceList({ account, onImported }) {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    dapi
      .cloudWorkspaces(account.id)
      .then((r) => setList(r.workspaces))
      .catch((e) => setError(e.message))
  }, [account.id])

  const bring = async (w) => {
    const dir = await pickFolder({ title: `Choose a folder for “${w.name}”`, buttonLabel: 'Sync here' })
    if (!dir) return
    setBusy(w.id)
    setError('')
    try {
      const { vault } = await dapi.importCloud(account.id, w.id, dir, w.name)
      await onImported(vault)
    } catch (e) {
      setError(e.message)
    }
    setBusy(null)
  }

  if (error && !list) return <p className="error-text">{error}</p>
  if (!list)
    return (
      <div className="setting-loading">
        <Spinner size="sm" /> Loading your workspaces…
      </div>
    )
  return (
    <div className="dk-list">
      {list.map((w) => (
        <div className="dk-item" key={w.id}>
          <span className="dk-item-icon">{w.icon || <Cloud />}</span>
          <div className="dk-item-text">
            <div className="dk-item-name truncate">{w.name}</div>
            <div className="dk-item-meta">{w.vault ? `Syncs with “${w.vault.name}”` : w.role === 'owner' ? 'Yours' : `Shared with you · ${w.role}`}</div>
          </div>
          {w.vault ? (
            <span className="badge success">
              <Check /> On this computer
            </span>
          ) : (
            <button className="btn" disabled={!!busy} onClick={() => bring(w)}>
              {busy === w.id ? <Spinner size="sm" /> : <Download />} Sync to a folder…
            </button>
          )}
        </div>
      ))}
      {!list.length && <p className="faint">No workspaces in this account yet.</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

async function newLocalVault(title = 'Choose a folder for your notes') {
  const dir = await pickFolder({ title, buttonLabel: 'Use this folder' })
  if (!dir) return null
  const { vault } = await dapi.createVault({ dir, name: folderName(dir) })
  return vault
}

// ---------------------------------------------------------------------------
// First run: no vault yet

export function DesktopWelcome() {
  const info = useDesktop((s) => s.info)
  const [stage, setStage] = useState('start') // start | cloud | pick
  const [account, setAccount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    useDesktop.getState().refresh()
  }, [])

  const local = async () => {
    setBusy(true)
    setError('')
    try {
      const vault = await newLocalVault()
      if (vault) await openVault(vault)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const known = info?.accounts?.[0]

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-grid" />
      <div className={`auth-card ${stage === 'start' || stage === 'pick' ? 'dk-wide' : ''}`}>
        <div className="auth-logo">
          <img src="/favicon.svg" alt="" />
          <span>Obi</span>
        </div>
        {stage === 'start' && (
          <>
            <h1>Where should your notes live?</h1>
            <p className="sub">Obi keeps every note as a markdown file in a folder on this computer, so it all works offline. You can sync a folder with your Obi account whenever you like.</p>
            <div className="dk-choices">
              <button className="type-card" onClick={() => (known ? (setAccount(known), setStage('pick')) : setStage('cloud'))}>
                <div className="tc-icon">
                  <Cloud />
                </div>
                <h4>Sync with my Obi account</h4>
                <p>{known ? `Continue as ${known.user?.displayName || known.user?.username} — pick workspaces to bring to this computer.` : 'Sign in or create an account. Each workspace you pick gets a folder here and stays in sync.'}</p>
              </button>
              <button className="type-card" onClick={local} disabled={busy}>
                <div className="tc-icon">
                  <HardDrive />
                </div>
                <h4>Keep everything on this computer</h4>
                <p>Choose a folder — an empty one, or one that already has notes (an Obsidian vault works). You can sync it later.</p>
              </button>
            </div>
            {busy && <Spinner />}
            {error && <p className="error-text">{error}</p>}
          </>
        )}
        {stage === 'cloud' && (
          <CloudSignIn
            onBack={() => setStage('start')}
            onDone={(a) => {
              setAccount(a)
              setStage('pick')
            }}
          />
        )}
        {stage === 'pick' && account && (
          <>
            <h1>Bring your notes here</h1>
            <p className="sub">
              Signed in as <b>{account.user?.displayName || account.user?.username}</b>. Choose a folder for each workspace you want on this computer — you can add others later.
            </p>
            <CloudWorkspaceList account={account} onImported={openVault} />
            <div className="auth-foot auth-foot-row">
              <button className="link-btn" onClick={() => setStage('start')}>
                <ArrowLeft /> Back
              </button>
              <button className="link-btn" onClick={local}>
                Start with an empty folder instead
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Adding another vault (replaces "New workspace" on the desktop)

export function NewVaultModal() {
  const close = useUI((s) => s.closeModal)
  const info = useDesktop((s) => s.info)
  const [stage, setStage] = useState('start')
  const [account, setAccount] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    useDesktop.getState().refresh()
  }, [])

  const finish = async (vault) => {
    await openVault(vault)
    close()
    toast.success(`“${vault.name}” is ready`)
  }

  return (
    <Modal title="Add a vault" center onClose={close} className="dk-modal">
      {stage === 'start' && (
        <>
          <div className="dk-choices">
            <button
              className="type-card"
              onClick={async () => {
                setError('')
                try {
                  const v = await newLocalVault('Choose a folder — empty, or one with notes in it')
                  if (v) await finish(v)
                } catch (e) {
                  setError(e.message)
                }
              }}
            >
              <div className="tc-icon">
                <FolderPlus />
              </div>
              <h4>A folder on this computer</h4>
              <p>New and empty, or an existing folder of markdown notes.</p>
            </button>
            <button
              className="type-card"
              onClick={() => {
                const a = info?.accounts?.[0]
                if (a) setAccount(a)
                setStage(a ? 'pick' : 'cloud')
              }}
            >
              <div className="tc-icon">
                <Cloud />
              </div>
              <h4>From my Obi cloud</h4>
              <p>A cloud workspace, synced into a folder here.</p>
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </>
      )}
      {stage === 'cloud' && (
        <div className="dk-embedded-auth">
          <CloudSignIn
            onBack={() => setStage('start')}
            onDone={(a) => {
              setAccount(a)
              setStage('pick')
            }}
          />
        </div>
      )}
      {stage === 'pick' && account && (
        <>
          {info?.accounts?.length > 1 && (
            <div className="field">
              <select className="select" value={account.id} onChange={(e) => setAccount(info.accounts.find((a) => a.id === e.target.value))}>
                {info.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.user?.username} · {a.url.replace(/^https?:\/\//, '')}
                  </option>
                ))}
              </select>
            </div>
          )}
          <CloudWorkspaceList key={account.id} account={account} onImported={finish} />
          <div className="auth-foot auth-foot-row">
            <button className="link-btn" onClick={() => setStage('start')}>
              <ArrowLeft /> Back
            </button>
            <button className="link-btn" onClick={() => setStage('cloud')}>
              Another account
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Settings → Sync, for the vault in front

function Row({ name, desc, children, stacked }) {
  return (
    <div className={`setting ${stacked ? 'stacked' : ''}`}>
      <div className="setting-text">
        <div className="setting-name">{name}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function cloudStatusText(s) {
  if (!s) return 'Waiting to sync'
  if (s.state === 'syncing') return 'Syncing…'
  if (s.state === 'offline') return 'Offline — changes are kept here and sync when you’re back online'
  if (s.state === 'signedout') return s.error || 'Signed out'
  if (s.state === 'error') return s.error || 'Sync failed'
  return s.lastSync ? `Up to date · synced ${timeAgo(s.lastSync)}` : 'Up to date'
}

export function VaultSyncSection({ ws }) {
  const info = useDesktop((s) => s.info)
  useEffect(() => {
    useDesktop.getState().refresh()
  }, [])
  if (!ws) return null
  return (
    <>
      <h2>Sync</h2>
      <p className="section-sub">This vault is a folder on this computer. Syncing is optional: with your Obi account, with GitHub, or both.</p>
      <Row name="Folder" desc={ws.dir}>
        <button className="btn" onClick={() => desktop?.reveal(ws.dir)}>
          <FolderOpen /> Show
        </button>
      </Row>
      <CloudCard ws={ws} info={info} />
      <GithubCard ws={ws} info={info} />
    </>
  )
}

function CloudCard({ ws, info }) {
  const [signingIn, setSigningIn] = useState(false)
  const [target, setTarget] = useState('new')
  const [remote, setRemote] = useState(null)
  const [busy, setBusy] = useState(false)
  const accounts = info?.accounts || []
  const [accountId, setAccountId] = useState(null)
  const account = accounts.find((a) => a.id === accountId) || accounts[0]

  useEffect(() => {
    setRemote(null)
    if (!account || ws.cloud) return
    dapi
      .cloudWorkspaces(account.id)
      .then((r) => setRemote(r.workspaces.filter((w) => !w.vault && w.role !== 'viewer')))
      .catch(() => setRemote([]))
  }, [account?.id, !!ws.cloud])

  const act = async (fn) => {
    setBusy(true)
    try {
      await fn()
      await useApp.getState().loadWorkspaces()
      await useDesktop.getState().refresh()
    } catch (e) {
      toast.error(e)
    }
    setBusy(false)
  }

  const linked = ws.cloud
  const linkedAccount = linked && accounts.find((a) => a.id === linked.account)
  const s = linked?.status

  if (linked) {
    return (
      <>
        <h3>Obi cloud</h3>
        <div className="dk-status">
          {s?.state === 'offline' ? <CloudOff /> : s?.state === 'error' || s?.state === 'signedout' ? <AlertTriangle className="danger" /> : s?.state === 'syncing' ? <RefreshCw className="spin" /> : <Cloud />}
          <div>
            <div className="dk-status-title">
              Synced with “{linked.remoteName}”{linkedAccount ? ` on ${linkedAccount.url.replace(/^https?:\/\//, '')}` : ''}
            </div>
            <div className="dk-status-desc">{cloudStatusText(s)}</div>
          </div>
        </div>
        {!linkedAccount && (
          <Row name="Signed out" desc="Sign in to that account again to keep syncing.">
            <button className="btn btn-primary" onClick={() => setSigningIn(true)}>
              Sign in
            </button>
          </Row>
        )}
        <div className="setting-actions">
          <button className="btn" disabled={busy} onClick={() => act(() => dapi.cloudSyncNow(ws.id))}>
            <RefreshCw /> Sync now
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              if (!(await confirmDialog({ title: 'Stop syncing?', message: 'The notes stay in this folder and in the cloud; they just stop updating each other.', confirmText: 'Stop syncing' }))) return
              act(() => dapi.unlinkCloud(ws.id))
            }}
          >
            <Link2Off /> Stop syncing
          </button>
        </div>
        {signingIn && <SignInModal onClose={() => setSigningIn(false)} />}
      </>
    )
  }

  return (
    <>
      <h3>Obi cloud</h3>
      <p className="section-sub">Sync this vault with your Obi account to reach it from the web and your other devices. The cloud keeps every version, so nothing is lost.</p>
      {!account ? (
        <div className="setting-actions">
          <button className="btn btn-primary" onClick={() => setSigningIn(true)}>
            <Cloud /> Sign in or create an account
          </button>
        </div>
      ) : (
        <>
          <Row name="Account" desc={account.url.replace(/^https?:\/\//, '')}>
            {accounts.length > 1 ? (
              <select className="select" value={account.id} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.user?.username} · {a.url.replace(/^https?:\/\//, '')}
                  </option>
                ))}
              </select>
            ) : (
              <span className="faint">{account.user?.displayName || account.user?.username}</span>
            )}
          </Row>
          <Row name="Sync with" stacked>
            <div className="dk-radio">
              <label>
                <input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} /> A new cloud workspace, “{ws.name}”
              </label>
              {remote?.map((r) => (
                <label key={r.id}>
                  <input type="radio" checked={target === r.id} onChange={() => setTarget(r.id)} /> Existing: “{r.name}” <span className="faint">— merged with this folder</span>
                </label>
              ))}
            </div>
          </Row>
          <div className="setting-actions">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => act(() => dapi.linkCloud(ws.id, target === 'new' ? { account: account.id, create: true, name: ws.name } : { account: account.id, remoteId: target }))}
            >
              {busy ? <Spinner size="sm" /> : <Upload />} Start syncing
            </button>
            <button className="btn btn-ghost" onClick={() => setSigningIn(true)}>
              Use another account
            </button>
          </div>
        </>
      )}
      {signingIn && (
        <SignInModal
          onClose={() => setSigningIn(false)}
          onDone={(a) => {
            setAccountId(a.id)
            setSigningIn(false)
          }}
        />
      )}
    </>
  )
}

function SignInModal({ onClose, onDone }) {
  return (
    <Modal title={null} center onClose={onClose} className="dk-modal">
      <div className="dk-embedded-auth">
        <CloudSignIn
          onDone={(a) => {
            toast.success(`Signed in as ${a.user?.username}`)
            onDone ? onDone(a) : onClose()
          }}
        />
      </div>
    </Modal>
  )
}

const MODES = [
  { value: 'save', label: 'On save' },
  { value: 'interval', label: 'Timed' },
  { value: 'manual', label: 'Manual' },
]

function GithubCard({ ws, info }) {
  const connected = ws.type === 'github'
  const [form, setForm] = useState({ repoUrl: '', token: '', branch: '' })
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState('')
  const s = ws.settings || {}
  const mode = s.syncMode || (s.autoSync === false ? 'manual' : 'save')
  const sync = useApp((st) => (st.wsId === ws.id ? st.sync : null))

  const save = (patch) =>
    api
      .updateWorkspace(ws.id, { settings: patch })
      .then(() => useApp.getState().loadWorkspaces())
      .catch((e) => toast.error(e))

  const act = async (key, fn, ok) => {
    setBusy(key)
    try {
      await fn()
      await useApp.getState().loadWorkspaces()
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(e)
    }
    setBusy(null)
  }

  if (info && !info.git) {
    return (
      <>
        <h3>GitHub</h3>
        <div className="dk-status">
          <AlertTriangle />
          <div>
            <div className="dk-status-title">Git isn’t installed</div>
            <div className="dk-status-desc">
              GitHub sync uses git. Install it from{' '}
              <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">
                git-scm.com
              </a>
              , then reopen this page.
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!connected) {
    return (
      <>
        <h3>GitHub</h3>
        <p className="section-sub">Keep this vault in a GitHub repository: every sync is a commit, and changes pushed from elsewhere are pulled in.</p>
        <Row name="Repository" desc="An empty repository is fine. https://github.com/you/notes or git@github.com:you/notes.git" stacked>
          <input className="input" value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="https://github.com/you/notes" spellCheck={false} />
        </Row>
        <Row name="Access token" desc="GitHub → Settings → Developer settings → Fine-grained tokens → this repository → Contents: Read and write. Stored encrypted on this computer." stacked>
          <input className="input" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="github_pat_…" spellCheck={false} />
        </Row>
        <Row name="Branch" desc="Leave empty for the repository’s default.">
          <input className="input" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="main" spellCheck={false} />
        </Row>
        <div className="setting-actions">
          <button className="btn btn-primary" disabled={!form.repoUrl || !!busy} onClick={() => act('connect', () => dapi.githubConnect(ws.id, form), 'Connected to GitHub')}>
            {busy === 'connect' ? <Spinner size="sm" /> : <FolderGit2 />} Connect
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <h3>GitHub</h3>
      <div className="dk-status">
        {sync?.state === 'syncing' ? <RefreshCw className="spin" /> : sync?.state === 'error' ? <AlertTriangle className="danger" /> : <FolderGit2 />}
        <div>
          <div className="dk-status-title">
            {ws.github?.label} · {ws.github?.branch}
          </div>
          <div className="dk-status-desc">
            {sync?.state === 'error' ? sync.error : sync?.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} not pushed yet` : sync?.lastSync ? `Pushed ${timeAgo(sync.lastSync)}` : 'Not synced yet'}
          </div>
        </div>
      </div>
      <Row name="When to commit and push" desc={mode === 'save' ? 'Shortly after you stop typing.' : mode === 'interval' ? 'On a timer, however much is going on.' : 'Only when you press Sync now.'}>
        <Segmented value={mode} options={MODES} onChange={(v) => save({ syncMode: v, autoSync: v !== 'manual' })} />
      </Row>
      {mode === 'interval' && (
        <Row name="Every" desc="Minutes between pushes.">
          <select className="select" value={String(s.intervalMinutes ?? 15)} onChange={(e) => save({ intervalMinutes: Number(e.target.value) })}>
            {[5, 10, 15, 30, 60, 120].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row name="Pull changes automatically" desc={mode === 'manual' ? 'Fetch what was pushed elsewhere every few minutes (commits your changes locally, without pushing).' : 'Fetch what was pushed elsewhere every few minutes.'}>
        <Switch checked={mode === 'manual' ? s.autoPull === true : s.autoPull !== false} onChange={(v) => save({ autoPull: v })} />
      </Row>
      <Row name="Commit message" desc="Used for automatic commits. {summary} is the automatic one; also {files}, {count}, {date}, {time}, {device}." stacked>
        <input
          className="input"
          defaultValue={s.commitMessage || ''}
          placeholder="{summary}"
          onBlur={(e) => e.target.value !== (s.commitMessage || '') && save({ commitMessage: e.target.value })}
          spellCheck={false}
        />
      </Row>
      <Row name="Sync now" desc="Commit with this message (or the automatic one), pull, and push." stacked>
        <div className="dk-inline">
          <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit message (optional)" />
          <button
            className="btn btn-primary"
            disabled={!!busy}
            onClick={() =>
              act('sync', async () => {
                const { sync } = await api.sync(ws.id, message)
                if (sync?.state === 'error') throw new Error(sync.error)
                setMessage('')
              }, 'Pushed to GitHub')
            }
          >
            {busy === 'sync' ? <Spinner size="sm" /> : <Upload />} Commit & push
          </button>
          <button className="btn" disabled={!!busy} onClick={() => act('pull', () => dapi.githubPull(ws.id), 'Pulled from GitHub')}>
            {busy === 'pull' ? <Spinner size="sm" /> : <Download />} Pull
          </button>
        </div>
      </Row>
      <div className="setting-actions">
        <button
          className="btn btn-ghost"
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Disconnect GitHub?', message: 'Your notes and their git history stay in the folder; Obi just stops committing and pushing.', confirmText: 'Disconnect' }))) return
            act('off', () => dapi.githubDisconnect(ws.id))
          }}
        >
          <Link2Off /> Disconnect
        </button>
      </div>
    </>
  )
}

/** Account settings on the desktop: this computer, and the cloud accounts it is signed in to */
export function DesktopAccountSection() {
  const info = useDesktop((s) => s.info)
  const [signingIn, setSigningIn] = useState(false)
  useEffect(() => {
    useDesktop.getState().refresh()
  }, [])
  return (
    <>
      <h2>Accounts</h2>
      <p className="section-sub">Obi works fully on this computer without an account. Sign in to sync vaults with an Obi server.</p>
      <Row name="This computer" desc={info?.device}>
        <Laptop className="faint" />
      </Row>
      <h3>Cloud accounts</h3>
      {info?.accounts?.map((a) => (
        <Row key={a.id} name={a.user?.displayName || a.user?.username} desc={`@${a.user?.username} · ${a.url.replace(/^https?:\/\//, '')}`}>
          <button
            className="btn"
            onClick={async () => {
              if (!(await confirmDialog({ title: 'Sign out?', message: 'Vaults synced with this account stop syncing until you sign in again. Nothing is deleted.', confirmText: 'Sign out' }))) return
              await dapi.cloudSignOut(a.id).catch((e) => toast.error(e))
              useDesktop.getState().refresh()
            }}
          >
            <LogOut /> Sign out
          </button>
        </Row>
      ))}
      {!info?.accounts?.length && <p className="faint">Not signed in to any cloud account.</p>}
      <div className="setting-actions">
        <button className="btn btn-primary" onClick={() => setSigningIn(true)}>
          <Cloud /> Sign in or create an account
        </button>
      </div>
      {signingIn && <SignInModal onClose={() => setSigningIn(false)} onDone={() => setSigningIn(false)} />}
    </>
  )
}
