import { useEffect, useState } from 'react'
import { RefreshCw, Check, CloudOff, AlertTriangle, Cloud, Wifi, WifiOff, GitBranch, Users, FileText, Loader2 } from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { useUI } from '../store/ui.js'
import { syncNow } from '../lib/actions.js'
import { conn } from '../lib/socket.js'
import { timeAgo, readingTime } from '../lib/util.js'
import { AvatarStack } from './ui.jsx'
import { HardDrive } from 'lucide-react'
import { dapi } from '../lib/desktop.js'
import { cloudStatusText } from './Desktop.jsx'
import { toast } from '../store/ui.js'

// Desktop: how this vault stands with the cloud. Offline is shown, never an
// error: everything is kept here and goes up when the connection is back.
function CloudChip({ ws }) {
  const s = ws.cloud.status
  const state = s?.state || 'idle'
  const icon =
    state === 'syncing' ? <RefreshCw className="spin" /> : state === 'offline' ? <CloudOff /> : state === 'error' || state === 'signedout' ? <AlertTriangle style={{ color: 'var(--danger)' }} /> : <Cloud />
  const label = state === 'syncing' ? 'Syncing…' : state === 'offline' ? 'Offline' : state === 'signedout' ? 'Signed out' : state === 'error' ? 'Sync failed' : 'Synced'
  return (
    <button
      className={`status-item ${state === 'offline' ? 'status-offline' : ''}`}
      title={`${cloudStatusText(s)}\nClick to sync now`}
      onClick={() => dapi.cloudSyncNow(ws.id).catch((e) => toast.error(e))}
    >
      {icon}
      {label}
    </button>
  )
}

export function StatusBar() {
  const connection = useApp((s) => s.connection)
  const sync = useApp((s) => s.sync)
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const presence = useApp((s) => s.presence)
  const user = useApp((s) => s.user)
  const tab = useLayout((s) => {
    const pane = s.panes.find((p) => p.id === s.activePane)
    return pane?.tabs.find((t) => t.id === pane.active)
  })
  const treeMap = useApp((s) => s.treeMap)
  const [stats, setStats] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [, tick] = useState(0)
  const ws = workspaces.find((w) => w.id === wsId)

  // "Saving… / Saved" for the note in front (GitHub workspaces show sync state instead)
  useEffect(() => {
    setSaveState('idle')
    if (!tab || tab.kind !== 'note') return
    const onDirty = (e) => {
      if (e.detail.path === tab.path && e.detail.ws === tab.ws) setSaveState('saving')
    }
    window.addEventListener('obi:doc-dirty', onDirty)
    const off = conn.on('index', (m) => {
      if (m.ws === tab.ws && m.path === tab.path) setSaveState('saved')
    })
    return () => {
      window.removeEventListener('obi:doc-dirty', onDirty)
      off()
    }
  }, [tab?.ws, tab?.path, tab?.kind])

  useEffect(() => {
    const onStats = (e) => setStats(e.detail)
    window.addEventListener('obi:stats', onStats)
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => {
      window.removeEventListener('obi:stats', onStats)
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    if (!tab || tab.kind !== 'note') setStats(null)
  }, [tab?.id, tab?.kind])

  const everyone = new Map()
  for (const list of Object.values(presence || {})) for (const u of list) if (u.id !== user?.id) everyone.set(u.id, u)
  const others = [...everyone.values()]

  const syncIcon = () => {
    if (!sync) return null
    if (sync.state === 'syncing' || sync.state === 'cloning') return <RefreshCw className="spin" />
    if (sync.state === 'error') return <AlertTriangle style={{ color: 'var(--danger)' }} />
    if (sync.state === 'dirty' || sync.pending) return <Cloud />
    // a desktop vault can show cloud sync too: say which one this is
    return ws?.dir ? <GitBranch /> : <Check />
  }
  const syncLabel = () => {
    if (!sync) return ''
    if (sync.state === 'cloning') return 'Cloning repository…'
    if (sync.state === 'syncing') return 'Syncing…'
    if (sync.state === 'error') return 'Sync failed'
    if (sync.pending) return `${sync.pending} change${sync.pending === 1 ? '' : 's'} pending`
    if (ws?.dir) return sync.lastSync ? `Pushed ${timeAgo(sync.lastSync)}` : 'Not pushed yet'
    return sync.lastSync ? `Synced ${timeAgo(sync.lastSync)}` : 'Not synced yet'
  }

  return (
    <div className="statusbar">
      {ws?.type === 'github' && (
        <button className="status-item" onClick={syncNow} title={sync?.error || `${ws.github?.label} · ${ws.github?.branch}\nClick to sync now`}>
          {syncIcon()}
          {syncLabel()}
        </button>
      )}
      {ws?.cloud && <CloudChip ws={ws} />}
      {ws?.type === 'online' &&
        (saveState === 'idle' ? (
          ws.dir ? (
            !ws.cloud && (
              <span className="status-item desktop-only" title={ws.dir}>
                <HardDrive /> On this computer
              </span>
            )
          ) : (
            <span className="status-item desktop-only" title="Notes are stored on this server">
              <Cloud /> Online workspace
            </span>
          )
        ) : (
          <span className="status-item" title={saveState === 'saving' ? (ws.dir ? 'Saving to the folder' : 'Your changes are on their way to the server') : 'Every change is saved'}>
            {saveState === 'saving' ? <Loader2 className="spin" /> : <Check />}
            {saveState === 'saving' ? 'Saving…' : 'Saved'}
          </span>
        ))}
      {/* Only worth a word when something is wrong: a permanent "Live" chip
          was just noise next to the save state. */}
      {connection !== 'online' && (
        <span className="status-item" title="Changes are kept in this tab until the connection is back">
          <span className={`status-dot ${connection === 'offline' ? 'offline' : 'connecting'}`} />
          {connection === 'reconnecting' ? 'Reconnecting…' : connection === 'offline' ? 'Offline' : 'Connecting…'}
        </span>
      )}
      {others.length > 0 && (
        <span className="status-item" title={others.map((o) => o.name).join(', ')}>
          <AvatarStack users={others} size={16} max={5} />
        </span>
      )}
      <span className="status-spacer" />
      {tab?.kind === 'note' && tab.ws === wsId && treeMap.get(tab.path)?.mtime > 0 && (
        <span className="status-item desktop-only" title={new Date(treeMap.get(tab.path).mtime).toLocaleString()}>
          Edited {timeAgo(treeMap.get(tab.path).mtime)}
        </span>
      )}
      {stats && (
        <>
          {stats.selWords > 0 && <span className="status-item desktop-only">{stats.selWords} selected</span>}
          <span className="status-item desktop-only">{readingTime(stats.words)}</span>
          <span className="status-item">
            {stats.words} words
            {stats.chars != null && <span className="desktop-only"> · {stats.chars} chars</span>}
          </span>
          {stats.line != null && (
            <span className="status-item desktop-only">
              Ln {stats.line}, Col {stats.col}
            </span>
          )}
        </>
      )}
    </div>
  )
}
