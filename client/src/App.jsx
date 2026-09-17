import { useEffect, useState, lazy, Suspense } from 'react'
import { useLocation, navigate } from './lib/router.js'
import { useApp, bindConnectionEvents } from './store/app.js'
import { api } from './lib/api.js'
import { conn } from './lib/socket.js'
import { LoginPage, SetupPage, SignupPage } from './pages/Auth.jsx'
import { Toasts, Dialogs, ContextMenu } from './components/ui.jsx'

const AppShell = lazy(() => import('./pages/AppShell.jsx'))
const AdminPage = lazy(() => import('./pages/Admin.jsx'))

bindConnectionEvents()

function Splash() {
  return (
    <div className="splash">
      <img src="/favicon.svg" alt="" width="46" height="46" />
      <span className="splash-name">Obi</span>
    </div>
  )
}

export function App() {
  const { path, search } = useLocation()
  const user = useApp((s) => s.user)
  const booting = useApp((s) => s.booting)
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const { user } = await api.me()
        useApp.getState().setUser(user)
        conn.start(user)
      } catch {
        try {
          const s = await api.setupStatus()
          setNeedsSetup(s.needsSetup)
        } catch {}
      } finally {
        useApp.setState({ booting: false })
      }
    })()
    const onUnauthorized = () => {
      if (!useApp.getState().user) return
      conn.stop()
      useApp.setState({ user: null })
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true })
    }
    window.addEventListener('obi:unauthorized', onUnauthorized)
    return () => window.removeEventListener('obi:unauthorized', onUnauthorized)
  }, [])

  if (booting) return <Splash />

  let page
  if (path.startsWith('/signup')) {
    page = <SignupPage search={search} />
  } else if (!user) {
    page = needsSetup ? <SetupPage onDone={() => setNeedsSetup(false)} /> : <LoginPage search={search} />
  } else if (path.startsWith('/admin')) {
    page = <AdminPage />
  } else if (path === '/login') {
    const next = new URLSearchParams(search).get('next')
    setTimeout(() => navigate(next && next.startsWith('/') ? next : '/', { replace: true }))
    page = <Splash />
  } else {
    page = <AppShell />
  }

  return (
    <>
      <Suspense fallback={<Splash />}>{page}</Suspense>
      <Toasts />
      <Dialogs />
      <ContextMenu />
    </>
  )
}
