import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Menu, Search, Network, ListChecks, Settings, Plus, PanelRight, ShieldCheck, LogOut, CalendarDays, Star, X, Loader2,
  AlertTriangle, RefreshCw, FolderGit2, FileText, Maximize2, Layers, CheckCircle2, KeyRound, PanelLeftOpen, Shapes,
  Pencil, Eye, MoreHorizontal,
} from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { useUI, toast } from '../store/ui.js'
import { api } from '../lib/api.js'
import { conn } from '../lib/socket.js'
import { navigate, useLocation, notePathFromUrl, urlForNote } from '../lib/router.js'
import { installHotkeys, runCommand } from '../lib/commands.js'
import * as A from '../lib/actions.js'
import { Sidebar } from '../components/Sidebar.jsx'
import { RightPanel } from '../components/RightPanel.jsx'
import { Pane } from '../components/Pane.jsx'
import { StatusBar } from '../components/StatusBar.jsx'
import { CommandPalette } from '../components/CommandPalette.jsx'
import { HoverPreview } from '../components/HoverPreview.jsx'
import { SettingsModal } from '../components/modals/Settings.jsx'
import { NewWorkspaceModal, ShareModal, HistoryModal, MoveModal, ImportModal, ShortcutsModal } from '../components/modals/Misc.jsx'
import { Modal, WsIcon, Avatar, Spinner, menuFromElement } from '../components/ui.jsx'
import { PasswordInput } from './Auth.jsx'
import { StorageWarning } from '../components/StorageWarning.jsx'
import { ConnectionBanner } from '../components/ConnectionBanner.jsx'
import { EdgeToggles } from '../components/EdgeToggles.jsx'
import { userMenu } from '../lib/userMenu.js'
import { basename, stripExt } from '@shared/paths.js'

export default function AppShell() {
  const { path: url } = useLocation()
  const user = useApp((s) => s.user)
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const loadingWs = useApp((s) => s.loadingWs)
  const wsError = useApp((s) => s.wsError)
  const initError = useApp((s) => s.initError)
  const sync = useApp((s) => s.sync)
  const layout = useLayout()
  const prefs = usePrefs()
  const modal = useUI((s) => s.modal)
  const [booted, setBooted] = useState(false)

  // initial load: workspaces + route
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await useApp.getState().loadWorkspaces()
        useApp.getState().loadShared()
        if (cancelled) return
        const target = notePathFromUrl(location.pathname)
        const last = localStorage.getItem('obi:lastWs')
        const wanted = (target?.ws && list.some((w) => w.id === target.ws) && target.ws) || (last && list.some((w) => w.id === last) && last) || list[0]?.id
        if (wanted) {
          await useApp.getState().openWorkspace(wanted)
          if (target?.path) useLayout.getState().openNote(target.ws, target.path)
          else if (target?.ws && target.ws !== wanted) navigate('/', { replace: true })
        }
      } catch (e) {
        toast.error(e)
      } finally {
        if (!cancelled) setBooted(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => installHotkeys(), [])

  // reflect active note in the URL
  const activeTab = useLayout((s) => {
    const pane = s.panes.find((p) => p.id === s.activePane)
    return pane?.tabs.find((t) => t.id === pane.active)
  })
  const lastUrl = useRef(null)
  useEffect(() => {
    if (!booted || !wsId) return
    const want = activeTab?.kind === 'note' ? urlForNote(activeTab.ws, activeTab.path) : `/w/${wsId}`
    if (location.pathname !== want) {
      lastUrl.current = want
      history.replaceState(null, '', want)
    }
    document.title = activeTab?.kind === 'note' ? `${stripExt(basename(activeTab.path))} · Obi` : 'Obi'
  }, [activeTab?.path, activeTab?.ws, activeTab?.kind, wsId, booted])

  // open note from URL when the user navigates back/forward
  useEffect(() => {
    if (!booted) return
    if (url === lastUrl.current) return // we wrote this URL ourselves
    if (url !== location.pathname) return // stale snapshot — the URL has already moved on
    lastUrl.current = url
    const target = notePathFromUrl(url)
    if (!target?.path) return
    const cur = useLayout.getState().activeTab()
    if (cur?.kind === 'note' && cur.path === target.path && cur.ws === target.ws) return
    if (target.ws === wsId || useApp.getState().workspaces.some((w) => w.id === target.ws)) useLayout.getState().openNote(target.ws, target.path)
  }, [url, booted])

  // drag & drop files anywhere → import
  useEffect(() => {
    const prevent = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const ws = workspaces.find((w) => w.id === wsId)
  const mobile = window.matchMedia('(max-width: 768px)').matches

  if (!booted) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    )
  }

  if (!workspaces.length) {
    return (
      <div className="ws-status-panel">
        <Layers style={{ width: 32, height: 32, color: 'var(--text-3)' }} />
        <h3>No workspaces yet</h3>
        <p>Create your first workspace — cloud-hosted for sharing, or connected to a GitHub repository.</p>
        <button className="btn btn-primary" onClick={() => useUI.getState().openModal('new-workspace')}>
          <Plus /> New workspace
        </button>
        {modal?.type === 'new-workspace' && <NewWorkspaceModal />}
      </div>
    )
  }

  return (
    <div className={`app ${layout.focus ? 'focus-mode' : ''}`}>
      {user?.isAdmin && <StorageWarning compact />}
      <ConnectionBanner />
      <MobileHeader ws={ws} activeTab={activeTab} />
      <div className="app-body">
        {/* one or the other: the full sidebar when open, the compact ribbon when closed.
            On desktop both stay mounted and collapse to nothing, so opening and
            closing slides instead of snapping. */}
        {mobile ? null : <Ribbon user={user} closed={layout.left} />}
        {mobile ? layout.left && <Sidebar user={user} /> : <Sidebar user={user} closed={!layout.left} />}
        {layout.left && mobile && <div className="scrim" onClick={() => layout.toggleLeft(false)} />}
        <div className="main">
          {loadingWs ? (
            <div className="ws-status-panel">
              <Spinner />
              <h3>Opening {ws?.name || 'workspace'}…</h3>
              {ws?.type === 'github' && <p>Cloning or refreshing your repository. This can take a moment the first time.</p>}
            </div>
          ) : wsError ? (
            <div className="ws-status-panel">
              <AlertTriangle style={{ width: 30, height: 30, color: 'var(--danger)' }} />
              <h3>Could not open this workspace</h3>
              <p>{wsError}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => useApp.getState().openWorkspace(wsId)}>
                  <RefreshCw /> Try again
                </button>
                <button className="btn" onClick={() => useUI.getState().openModal('settings', { section: 'workspace' })}>
                  <Settings /> Settings
                </button>
              </div>
            </div>
          ) : initError ? (
            <div className="ws-status-panel">
              <FolderGit2 style={{ width: 30, height: 30, color: 'var(--danger)' }} />
              <h3>GitHub connection problem</h3>
              <p>{initError}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => useUI.getState().openModal('settings', { section: 'github' })}>
                  <KeyRound /> Fix connection
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    await A.syncNow()
                    useApp.getState().openWorkspace(wsId)
                  }}
                >
                  <RefreshCw /> Retry
                </button>
              </div>
            </div>
          ) : (
            layout.panes.map((pane) => <Pane key={pane.id} pane={pane} isActive={pane.id === layout.activePane} multi={layout.panes.length > 1} />)
          )}
        </div>
        {mobile
          ? layout.right && !layout.focus && <RightPanel tab={activeTab} />
          : !layout.focus && <RightPanel tab={activeTab} closed={!layout.right} />}
        {layout.right && mobile && <div className="scrim" onClick={() => layout.toggleRight(false)} />}
        {!mobile && !layout.focus && <EdgeToggles />}
      </div>
      <StatusBar />
      {layout.focus && (
        <button className="icon-btn focus-exit" title="Exit focus mode (Esc)" onClick={() => layout.toggleFocus(false)}>
          <Maximize2 />
        </button>
      )}
      <CommandPalette />
      <HoverPreview />
      <Modals />
      {user?.mustChangePassword && <ForcePasswordChange />}
    </div>
  )
}

function Modals() {
  const modal = useUI((s) => s.modal)
  if (!modal) return null
  const p = modal.props || {}
  switch (modal.type) {
    case 'settings':
      return <SettingsModal {...p} />
    case 'new-workspace':
      return <NewWorkspaceModal />
    case 'share':
      return <ShareModal {...p} />
    case 'history':
      return <HistoryModal {...p} />
    case 'move':
      return <MoveModal {...p} />
    case 'import':
      return <ImportModal />
    case 'shortcuts':
      return <ShortcutsModal />
    default:
      return null
  }
}

function Ribbon({ user, closed }) {
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const layout = useLayout()
  const ws = workspaces.find((w) => w.id === wsId)

  return (
    <div className={`ribbon ${closed ? 'is-closed' : ''}`} inert={closed || undefined}>
      <button className="ws-avatar" onClick={() => useUI.getState().openPalette('workspaces')} title={`${ws?.name || 'Workspace'} — switch (⌘⇧O)`}>
        <WsIcon ws={ws} size={32} />
      </button>
      <button className="icon-btn" title="Open sidebar (Ctrl/⌘ \)" onClick={() => layout.toggleLeft(true)}>
        <PanelLeftOpen />
      </button>
      <button className="icon-btn" title="Search (⌘⇧F)" onClick={() => layout.setLeftTab('search')}>
        <Search />
      </button>
      <button className="icon-btn" title="Graph view (⌘G)" onClick={() => layout.openView('graph')}>
        <Network />
      </button>
      <button className="icon-btn" title="Tasks" onClick={() => layout.openView('tasks')}>
        <ListChecks />
      </button>
      <button className="icon-btn" title="Daily note (⌘D)" onClick={() => A.openDailyNote()}>
        <CalendarDays />
      </button>
      <button className="icon-btn" title="New note (⌘N)" onClick={() => runCommand('new-note')}>
        <Plus />
      </button>
      <button className="icon-btn" title="New whiteboard (Alt B)" onClick={() => runCommand('new-whiteboard')}>
        <Shapes />
      </button>
      <div className="ribbon-spacer" />
      <button className="icon-btn" title="Settings" onClick={() => useUI.getState().openModal('settings')}>
        <Settings />
      </button>
      <button className="icon-btn" onClick={(e) => userMenu(e, user)} title={user?.displayName} style={{ marginTop: 4 }}>
        <Avatar name={user?.displayName || '?'} color={user?.color} size={26} />
      </button>
    </div>
  )
}

function MobileHeader({ ws, activeTab }) {
  const layout = useLayout()
  const defaultMode = usePrefs((s) => s.defaultMode)
  const isNoteTab = activeTab?.kind === 'note'
  const reading = isNoteTab && (activeTab.mode || defaultMode) === 'read'
  return (
    <div className="mobile-header">
      <button className="icon-btn" title="Files" onClick={() => layout.toggleLeft()}>
        <Menu />
      </button>
      <div className="mobile-title truncate">{isNoteTab ? stripExt(basename(activeTab.path)) : ws?.name || 'Obi'}</div>
      <button className="icon-btn" title="Search" onClick={() => useUI.getState().openPalette('files')}>
        <Search />
      </button>
      {/* the note header is hidden at this width, so its two essentials live here */}
      {isNoteTab && (
        <button className="icon-btn" title={reading ? 'Edit' : 'Reading view'} onClick={() => runCommand('toggle-mode')}>
          {reading ? <Pencil /> : <Eye />}
        </button>
      )}
      {isNoteTab ? (
        <button className="icon-btn" title="More" onClick={(e) => window.dispatchEvent(new CustomEvent('obi:note-menu', { detail: { currentTarget: e.currentTarget } }))}>
          <MoreHorizontal />
        </button>
      ) : (
        <button className="icon-btn" title="Panel" onClick={() => layout.toggleRight()}>
          <PanelRight />
        </button>
      )}
    </div>
  )
}

function ForcePasswordChange() {
  const [pw, setPw] = useState('')
  const [current, setCurrent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api.changePassword(current, pw)
      const { user } = await api.me()
      useApp.getState().setUser(user)
      toast.success('Password updated')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Choose a new password"
      center
      onClose={() => {}}
      footer={
        <button className="btn btn-primary" disabled={busy || pw.length < 8 || !current} onClick={submit}>
          {busy ? <Spinner size="sm" /> : 'Set password'}
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Your administrator asked you to set your own password.
      </p>
      <div className="field">
        <label>Current password</label>
        <PasswordInput value={current} onChange={setCurrent} autoFocus />
      </div>
      <div className="field">
        <label>New password</label>
        <PasswordInput value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 8 characters" />
      </div>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  )
}
