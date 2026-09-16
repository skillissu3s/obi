import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { api } from '../lib/api.js'
import { useApp } from '../store/app.js'
import { conn } from '../lib/socket.js'
import { navigate } from '../lib/router.js'
import { Spinner } from '../components/ui.jsx'

function AuthShell({ children }) {
  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-grid" />
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/favicon.svg" alt="" />
          <span>Obi</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function PasswordInput({ value, onChange, placeholder = 'Password', autoComplete = 'current-password', autoFocus }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} style={{ paddingRight: 38 }} />
      <button type="button" className="icon-btn" onClick={() => setShow(!show)} style={{ position: 'absolute', right: 6, top: 6 }} tabIndex={-1} aria-label="Show password">
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  )
}

function finishAuth(user, next) {
  useApp.getState().setUser(user)
  conn.start(user)
  navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true })
}

export function LoginPage({ search }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const next = new URLSearchParams(search).get('next') || (location.pathname !== '/login' ? location.pathname : '/')
  const isAdmin = location.pathname.startsWith('/admin')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user } = await api.login(username, password)
      finishAuth(user, next)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1>{isAdmin ? 'Admin sign in' : 'Welcome back'}</h1>
      <p className="sub">{isAdmin ? 'Sign in with an administrator account.' : 'Sign in to pick up where you left off.'}</p>
      <form onSubmit={submit}>
        <div className="field">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" autoFocus autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <PasswordInput value={password} onChange={setPassword} />
        </div>
        {error && <p className="error-text" style={{ margin: '0 0 12px' }}>{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || !password}>
          {busy ? <Spinner size="sm" /> : <>Sign in <ArrowRight /></>}
        </button>
      </form>
      <div className="auth-foot">Accounts are created by your administrator.</div>
    </AuthShell>
  )
}

export function SetupPage() {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user } = await api.setup({ username, password, displayName })
      finishAuth(user, '/admin')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <AuthShell>
      <h1>Set up Obi</h1>
      <p className="sub">Create the administrator account. Only admins can open <span className="code-inline">/admin</span> and create users.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label>Your name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ada Lovelace" autoFocus />
        </div>
        <div className="field">
          <label>Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <label>Password</label>
          <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Spinner size="sm" /> : 'Create admin account'}
        </button>
      </form>
    </AuthShell>
  )
}

export function SignupPage({ search }) {
  const invite = new URLSearchParams(search).get('invite') || ''
  const [state, setState] = useState({ loading: true, valid: false, note: '' })
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .checkInvite(invite)
      .then((r) => setState({ loading: false, valid: true, note: r.note }))
      .catch((e) => setState({ loading: false, valid: false, error: e.message }))
  }, [invite])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user } = await api.signup({ invite, username, password, displayName })
      finishAuth(user, '/')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      {state.loading ? (
        <Spinner />
      ) : !state.valid ? (
        <>
          <h1>Invite not valid</h1>
          <p className="sub">{state.error || 'This invite link is invalid or has expired.'} Ask your administrator for a new one.</p>
          <button className="btn btn-block" onClick={() => navigate('/login')}>
            Go to sign in
          </button>
        </>
      ) : (
        <>
          <h1>Create your account</h1>
          <p className="sub">You've been invited to Obi{state.note ? ` — ${state.note}` : ''}.</p>
          <form onSubmit={submit}>
            <div className="field">
              <label>Your name</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} />
            </div>
            <div className="field">
              <label>Password</label>
              <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" />
            </div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? <Spinner size="sm" /> : 'Create account'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  )
}

export { PasswordInput }
