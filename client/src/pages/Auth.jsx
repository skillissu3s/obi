import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, MailCheck } from 'lucide-react'
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

// What this server offers: open registration, emailed sign-in codes
let optionsCache = null
function useAuthOptions() {
  const [opts, setOpts] = useState(optionsCache)
  useEffect(() => {
    if (optionsCache) return
    api
      .setupStatus()
      .then((o) => setOpts((optionsCache = o)))
      .catch(() => setOpts((optionsCache = { registration: 'invite', loginCode: 'off' })))
  }, [])
  return opts
}

const RESEND_WAIT = 30

/**
 * The end of "I forgot my password": the emailed code and the new password on
 * one screen, so the code is still fresh when it is used.
 */
function ResetStep({ ticket, identifier, onDone, onBack }) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onDone(code, password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <>
      <div className="auth-code-icon">
        <KeyRound />
      </div>
      <h1>Choose a new password</h1>
      <p className="sub">
        If an account uses <b>{identifier}</b>, a 6-digit code is on its way there. It expires in 10 minutes.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <input
            className="input auth-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="6-digit code"
          />
        </div>
        <div className="field">
          <PasswordInput value={password} onChange={setPassword} placeholder="New password (8+ characters)" autoComplete="new-password" />
        </div>
        {error && <p className="error-text" style={{ margin: '0 0 12px' }}>{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6 || password.length < 8}>
          {busy ? <Spinner size="sm" /> : 'Set password and sign in'}
        </button>
      </form>
      <div className="auth-foot">
        <button type="button" className="link-btn" onClick={onBack}>
          <ArrowLeft /> Back to sign in
        </button>
      </div>
    </>
  )
}

/**
 * "Check your email": six digits, pasted or typed. Submits by itself once all
 * six are in.
 */
function CodeStep({ sentTo, title = 'Check your email', what, onVerify, onResend, onBack }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(RESEND_WAIT)
  const tried = useRef('')

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return
    tried.current = c
    setBusy(true)
    setError('')
    try {
      await onVerify(c)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const resend = async () => {
    setError('')
    try {
      await onResend()
      setCode('')
      setWait(RESEND_WAIT)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="auth-code-icon">
        <MailCheck />
      </div>
      <h1>{title}</h1>
      <p className="sub">
        {sentTo ? (
          <>
            We sent a 6-digit code to <b>{sentTo}</b>
          </>
        ) : (
          'If an account matches, a 6-digit code is on its way to its email'
        )}
        {sentTo && what ? ` ${what}` : ''}. It expires in 10 minutes.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          verify()
        }}
      >
        <div className="field">
          <input
            className="input auth-code"
            value={code}
            onChange={(e) => {
              const c = e.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(c)
              if (c.length === 6 && c !== tried.current) verify(c)
            }}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="6-digit code"
          />
        </div>
        {error && <p className="error-text" style={{ margin: '0 0 12px' }}>{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6}>
          {busy ? <Spinner size="sm" /> : 'Continue'}
        </button>
      </form>
      <div className="auth-foot auth-foot-row">
        <button type="button" className="link-btn" onClick={onBack}>
          <ArrowLeft /> Back
        </button>
        <button type="button" className="link-btn" disabled={wait > 0} onClick={resend}>
          {wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}
        </button>
      </div>
    </>
  )
}

export function LoginPage({ search }) {
  const opts = useAuthOptions()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [withCode, setWithCode] = useState(false) // sign in by email code instead of password
  const [code, setCode] = useState(null) // { ticket, sentTo } while waiting for a code
  const [reset, setReset] = useState(null) // { ticket } while resetting a forgotten password
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const next = new URLSearchParams(search).get('next') || (location.pathname !== '/login' ? location.pathname : '/')
  const isAdmin = location.pathname.startsWith('/admin')
  const codesOn = opts?.loginCode === 'either'

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (withCode) {
        const { ticket } = await api.loginCode(identifier)
        setCode({ ticket, sentTo: null })
      } else {
        const r = await api.login(identifier, password)
        if (r.needsCode) setCode({ ticket: r.ticket, sentTo: r.sentTo, second: true })
        else return finishAuth(r.user, next)
      }
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (reset) {
    return (
      <AuthShell>
        <ResetStep
          ticket={reset.ticket}
          identifier={identifier}
          onDone={async (c, pw) => finishAuth((await api.resetPasswordVerify(reset.ticket, c, pw)).user, next)}
          onBack={() => setReset(null)}
        />
      </AuthShell>
    )
  }

  if (code) {
    return (
      <AuthShell>
        <CodeStep
          sentTo={code.sentTo}
          title={code.second ? 'One more step' : 'Check your email'}
          what={code.second ? 'to finish signing in' : 'to sign in'}
          what="to sign in"
          onVerify={async (c) => finishAuth((await api.verifyLoginCode(code.ticket, c)).user, next)}
          onResend={async () => setCode({ ...code, ticket: (await api.resendCode(code.ticket)).ticket })}
          onBack={() => {
            setCode(null)
            setPassword('')
          }}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1>{isAdmin ? 'Admin sign in' : 'Welcome back'}</h1>
      <p className="sub">
        {isAdmin
          ? 'Administrators sign in with a password and a code.'
          : withCode
            ? 'We\u2019ll email you a code to sign in with.'
            : 'Sign in to pick up where you left off.'}
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <input
            className="input"
            type="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        {!withCode && (
          <div className="field">
            <PasswordInput value={password} onChange={setPassword} />
          </div>
        )}
        {opts?.canReset && !withCode && (
          <div className="auth-aside">
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                if (!identifier.trim()) return setError('Enter your email address first, then we’ll send you a code')
                setBusy(true)
                setError('')
                try {
                  setReset(await api.resetPassword(identifier))
                } catch (err) {
                  setError(err.message)
                }
                setBusy(false)
              }}
            >
              Forgot your password?
            </button>
          </div>
        )}
        {error && <p className="error-text" style={{ margin: '0 0 12px' }}>{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !identifier || (!withCode && !password)}>
          {busy ? (
            <Spinner size="sm" />
          ) : withCode ? (
            'Email me a code'
          ) : (
            <>
              Sign in <ArrowRight />
            </>
          )}
        </button>
        {codesOn && (
          <button
            type="button"
            className="btn btn-ghost btn-block auth-alt"
            onClick={() => {
              setWithCode(!withCode)
              setError('')
            }}
          >
            {withCode ? 'Use my password instead' : 'Email me a sign-in code instead'}
          </button>
        )}
      </form>
      <div className="auth-foot">
        {opts?.registration === 'open' ? (
          <>
            New to Obi?{' '}
            <button type="button" className="link-btn" onClick={() => navigate('/register' + (search || ''))}>
              Create an account
            </button>
            {' · '}
            <a className="link-btn" href="/welcome">
              What is Obi?
            </a>
          </>
        ) : opts ? (
          'Accounts are created by your administrator.'
        ) : null}
      </div>
    </AuthShell>
  )
}

/** Open registration: email, username and password, then the emailed code */
export function RegisterPage({ search }) {
  const opts = useAuthOptions()
  const [form, setForm] = useState({ displayName: '', email: '', username: '', password: '' })
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: typeof v === 'string' ? v : v.target.value }))
  const next = new URLSearchParams(search).get('next') || '/'

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setCode(await api.register(form))
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (!opts) {
    return (
      <AuthShell>
        <Spinner />
      </AuthShell>
    )
  }
  if (opts.registration !== 'open') {
    return (
      <AuthShell>
        <h1>Registration is closed</h1>
        <p className="sub">Accounts on this server are created by its administrator. Ask them for an invite link.</p>
        <button className="btn btn-block" onClick={() => navigate('/login')}>
          Go to sign in
        </button>
      </AuthShell>
    )
  }
  if (code) {
    return (
      <AuthShell>
        <CodeStep
          sentTo={code.sentTo}
          what="to confirm your email"
          onVerify={async (c) => finishAuth((await api.verifyRegistration(code.ticket, c)).user, next)}
          onResend={async () => setCode({ ...code, ticket: (await api.resendCode(code.ticket)).ticket })}
          onBack={() => setCode(null)}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1>Create your account</h1>
      <p className="sub">Your notes, on every device. We’ll email you a code to confirm it’s you.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label>Your name</label>
          <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Ada Lovelace" autoComplete="name" autoFocus />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <label>Username</label>
          <input className="input" value={form.username} onChange={set('username')} placeholder="ada" autoComplete="username" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <label>Password</label>
          <PasswordInput value={form.password} onChange={set('password')} placeholder="At least 8 characters" autoComplete="new-password" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !form.email || !form.username || form.password.length < 8}>
          {busy ? <Spinner size="sm" /> : 'Continue'}
        </button>
      </form>
      <div className="auth-foot">
        Already have an account?{' '}
        <button type="button" className="link-btn" onClick={() => navigate('/login' + (search || ''))}>
          Sign in
        </button>
      </div>
    </AuthShell>
  )
}

export function SetupPage() {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user } = await api.setup({ username, password, displayName, email })
      finishAuth(user, '/admin')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <AuthShell>
      <h1>Set up Obi</h1>
      <p className="sub">Create the administrator account. Only admins can open <span className="code-inline">/admin</span> and manage users.</p>
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
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoCapitalize="none" spellCheck={false} />
          <div className="hint">You sign in with this address, and administrators also get a code by email.</div>
        </div>
        <div className="field">
          <label>Password</label>
          <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !email || !username || password.length < 8}>
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState(null) // { ticket, sentTo } once the invite is spent
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
      setCode(await api.signup({ invite, email, username, password, displayName }))
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (code) {
    return (
      <AuthShell>
        <CodeStep
          sentTo={code.sentTo}
          what="to confirm your email"
          onVerify={async (c) => finishAuth((await api.verifyRegistration(code.ticket, c)).user, '/')}
          onResend={async () => setCode({ ...code, ticket: (await api.resendCode(code.ticket)).ticket })}
          onBack={() => setCode(null)}
        />
      </AuthShell>
    )
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
          <p className="sub">You've been invited to Obi{state.note ? ` — ${state.note}` : ''}. We’ll email you a code to confirm it’s you.</p>
          <form onSubmit={submit}>
            <div className="field">
              <label>Your name</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoCapitalize="none" spellCheck={false} />
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
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || !email || !username || password.length < 8}>
              {busy ? <Spinner size="sm" /> : 'Continue'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  )
}

export { PasswordInput, CodeStep }
