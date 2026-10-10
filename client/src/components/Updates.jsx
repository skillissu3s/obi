// A new version of Obi, told inside the app (state in lib/updates.js):
// - once per version, a toast that stays until it is acted on or closed;
// - meanwhile a pill in the status bar;
// - and Settings → About, with the version and "Check for updates".
import { useEffect, useRef } from 'react'
import { ArrowUpCircle, Download, RefreshCw, RotateCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react'
import { Spinner } from './ui.jsx'
import { toast } from '../store/ui.js'
import { useUpdates, startUpdates, checkForUpdates, installUpdate, downloadUpdate, reloadForUpdate } from '../lib/updates.js'

// what to say, and what the one button does, for each state that needs the person
function offer(s) {
  if (s.status === 'ready') return { text: `Obi ${s.version} is ready. Restart to update.`, label: 'Restart', run: installUpdate, pill: 'Restart to update', Icon: RotateCw }
  if (s.status === 'available') return { text: `Obi ${s.version} is available.`, label: 'Download', run: downloadUpdate, pill: `Obi ${s.version} available`, Icon: Download }
  if (s.status === 'reload') return { text: 'A new version of Obi is available.', label: 'Reload', run: reloadForUpdate, pill: 'Reload to update', Icon: RefreshCw }
  return null
}

/** Starts watching for updates, and raises the toast once for each new version */
export function UpdateWatcher() {
  const s = useUpdates()
  const told = useRef(new Set())
  useEffect(() => startUpdates(), [])
  useEffect(() => {
    const o = offer(s)
    const key = `${s.status}:${s.version || ''}:${s.key || ''}`
    if (!o || told.current.has(key)) return
    told.current.add(key)
    toast.info(o.text, { timeout: 0, action: { label: o.label, run: o.run } })
  }, [s])
  return null
}

/** The status bar's reminder, while there is an update to take */
export function UpdatePill() {
  const s = useUpdates()
  const o = offer(s)
  if (s.status === 'installing') {
    return (
      <span className="status-item status-update">
        <Spinner size="sm" /> Updating…
      </span>
    )
  }
  if (!o) return null
  return (
    <button type="button" className="status-item status-update" title={o.text} onClick={o.run}>
      <ArrowUpCircle /> {o.pill}
    </button>
  )
}

/** Settings → About: the version, and checking for a newer one */
export function UpdateSettings() {
  const s = useUpdates()
  const o = offer(s)
  const desktop = s.kind === 'desktop'
  let line = null
  if (s.status === 'checking') line = <><Spinner size="sm" /> Checking…</>
  else if (s.status === 'downloading') line = <><Spinner size="sm" /> Downloading Obi {s.version}… {s.progress ? `${s.progress}%` : ''}</>
  else if (s.status === 'installing') line = <><Spinner size="sm" /> Restarting into Obi {s.version}…</>
  else if (s.status === 'none') line = <><CheckCircle2 className="ok" /> You have the latest version.</>
  else if (s.status === 'error') line = <><AlertCircle className="bad" /> Couldn't check for updates{s.error ? `: ${s.error}` : '.'}</>
  else if (o) line = <><ArrowUpCircle className="ok" /> {o.text}</>
  else if (!desktop) line = 'This page updates itself when the server does.'
  return (
    <div className="setting update-setting">
      <div className="setting-text">
        <div className="setting-name">Version {s.current || '—'}</div>
        <div className="setting-desc update-line">{line || (desktop ? 'Obi looks for a new version when it starts and every few hours.' : null)}</div>
      </div>
      <div className="setting-control">
        {o && (
          <button type="button" className="btn btn-primary btn-sm" onClick={o.run}>
            <o.Icon /> {o.label}
          </button>
        )}
        {s.notes && (s.status === 'ready' || s.status === 'available') && (
          <a className="btn btn-sm btn-ghost" href={s.notes} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> What's new
          </a>
        )}
        {desktop && !o && (
          <button type="button" className="btn btn-sm" disabled={s.status === 'checking' || s.status === 'downloading' || s.status === 'installing'} onClick={checkForUpdates}>
            <RefreshCw /> Check for updates
          </button>
        )}
      </div>
    </div>
  )
}
