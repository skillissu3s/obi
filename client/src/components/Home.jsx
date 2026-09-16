import { useMemo } from 'react'
import { FilePlus, CalendarDays, Search, Network, FileText, Clock, Star, ListChecks, Sparkles, Upload, FolderGit2, Cloud, LayoutGrid } from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { useUI } from '../store/ui.js'
import * as A from '../lib/actions.js'
import { runCommand } from '../lib/commands.js'
import { timeAgo, modKey, formatDate } from '../lib/util.js'
import { basename, stripExt } from '@shared/paths.js'

export function Home() {
  const user = useApp((s) => s.user)
  const wsId = useApp((s) => s.wsId)
  const workspaces = useApp((s) => s.workspaces)
  const version = useApp((s) => s.version)
  const prefs = usePrefs()
  const ws = workspaces.find((w) => w.id === wsId)
  const recent = useMemo(() => A.recentNotes(8), [version])
  const stats = useMemo(() => A.workspaceStats(), [version])
  const bookmarks = (prefs.bookmarks[wsId] || []).slice(0, 6)
  const tasks = useMemo(() => {
    const today = formatDate(new Date(), 'YYYY-MM-DD')
    return A.allTasks()
      .filter((t) => !t.checked && t.due && t.due <= today)
      .slice(0, 6)
  }, [version])

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const actions = [
    { icon: FilePlus, title: 'New note', hint: `${modKey} N`, run: () => runCommand('new-note') },
    { icon: CalendarDays, title: "Today's note", hint: `${modKey} D`, run: () => A.openDailyNote() },
    { icon: Search, title: 'Search notes', hint: `${modKey} ⇧ F`, run: () => useLayout.getState().setLeftTab('search') },
    { icon: Network, title: 'Graph view', hint: `${modKey} G`, run: () => useLayout.getState().openView('graph') },
  ]

  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="home-greet">
          {greeting}
          {user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}.
        </h1>
        <p className="home-sub">
          {ws?.type === 'github' ? (
            <>
              <FolderGit2 size={13} style={{ verticalAlign: -2 }} /> Synced with {ws.github?.label} · {stats.notes} notes
            </>
          ) : (
            <>
              <Cloud size={13} style={{ verticalAlign: -2 }} /> {ws?.name} · {stats.notes} notes{ws?.memberCount > 1 ? ` · ${ws.memberCount} members` : ''}
            </>
          )}
        </p>

        <div className="quick-actions">
          {actions.map((a) => (
            <button className="qa" key={a.title} onClick={a.run}>
              <span className="qa-icon">
                <a.icon />
              </span>
              <span>
                <div className="qa-title">{a.title}</div>
                <div className="qa-hint">{a.hint}</div>
              </span>
            </button>
          ))}
        </div>

        <div className="home-cols">
          <div className="home-section">
            <h3>
              <Clock /> Recently edited
            </h3>
            {!recent.length && <div className="faint">No notes yet — create your first one.</div>}
            {recent.map((e) => (
              <div key={e.path} className="recent-item" onClick={(ev) => useLayout.getState().openNote(wsId, e.path, { newTab: ev.metaKey || ev.ctrlKey })}>
                <FileText />
                <span className="truncate grow">{stripExt(basename(e.path))}</span>
                <span className="when">{timeAgo(e.mtime)}</span>
              </div>
            ))}
          </div>
          <div className="home-section">
            {bookmarks.length > 0 && (
              <>
                <h3>
                  <Star /> Bookmarks
                </h3>
                {bookmarks.map((p) => (
                  <div key={p} className="recent-item" onClick={() => useLayout.getState().openNote(wsId, p)}>
                    <FileText />
                    <span className="truncate grow">{stripExt(basename(p))}</span>
                  </div>
                ))}
                <div style={{ height: 18 }} />
              </>
            )}
            <h3>
              <ListChecks /> Due today
            </h3>
            {!tasks.length && <div className="faint">Nothing due. Nice.</div>}
            {tasks.map((t, i) => (
              <div key={i} className="recent-item" onClick={() => useLayout.getState().openNote(wsId, t.path, { line: t.line })}>
                <ListChecks />
                <span className="truncate grow">{t.text.replace(/📅\s*\d{4}-\d{2}-\d{2}/, '').trim()}</span>
                <span className="when">{t.due}</span>
              </div>
            ))}
            {!!A.allTasks().length && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => useLayout.getState().openView('tasks')}>
                All tasks →
              </button>
            )}
          </div>
        </div>

        <div className="home-stats">
          <span>
            <b>{stats.notes}</b> notes
          </span>
          <span>
            <b>{stats.words.toLocaleString()}</b> words
          </span>
          <span>
            <b>{stats.tags}</b> tags
          </span>
          <span>
            <b>
              {stats.done}/{stats.tasks}
            </b>{' '}
            tasks done
          </span>
          <span>
            <b>{stats.files}</b> files
          </span>
        </div>
      </div>
    </div>
  )
}
