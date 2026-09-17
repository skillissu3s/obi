import { useRef, useState } from 'react'
import { X, Plus, FileText, Network, ListChecks, Home as HomeIcon, SplitSquareHorizontal, Pin, PinOff, Copy, MoreHorizontal, Shapes } from 'lucide-react'
import { useLayout } from '../store/layout.js'
import { useApp } from '../store/app.js'
import { useUI } from '../store/ui.js'
import { NoteView } from './NoteView.jsx'
import { BoardView } from './BoardView.jsx'
import { isBoardPath } from '@shared/board.js'
import { Home } from './Home.jsx'
import { GraphView } from './GraphView.jsx'
import { TasksView } from './TasksView.jsx'
import { setActiveEditorView } from '../lib/commands.js'
import { basename, stripExt } from '@shared/paths.js'
import * as A from '../lib/actions.js'

const KIND_ICON = { note: FileText, graph: Network, tasks: ListChecks, home: HomeIcon }

export function Pane({ pane, isActive, multi }) {
  const panes = useLayout((s) => s.panes)
  const pending = useApp((s) => s.pending)
  const dragIdx = useRef(null)
  const activeTab = pane.tabs.find((t) => t.id === pane.active)

  const tabMenu = (e, tab, idx) => {
    useUI.getState().showContextMenu(e, [
      { label: tab.pinned ? 'Unpin tab' : 'Pin tab', icon: tab.pinned ? PinOff : Pin, run: () => useLayout.getState().updateTab(tab.id, { pinned: !tab.pinned }) },
      { label: 'Split right', icon: SplitSquareHorizontal, run: () => useLayout.getState().splitRight(tab) },
      tab.kind === 'note' && { label: 'Copy link', icon: Copy, run: () => A.copyNoteLink(tab.ws, tab.path) },
      'divider',
      { label: 'Close', icon: X, run: () => useLayout.getState().closeTab(pane.id, tab.id) },
      { label: 'Close others', run: () => useLayout.getState().closeOthers(pane.id, tab.id) },
    ])
  }

  return (
    <div className={`pane ${isActive ? '' : 'inactive'}`} onMouseDown={() => useLayout.getState().focusPane(pane.id)}>
      <div className="tabbar">
        {pane.tabs.map((tab, idx) => {
          const Icon = tab.kind === 'note' && isBoardPath(tab.path) ? Shapes : KIND_ICON[tab.kind] || FileText
          const busy = tab.kind === 'note' ? pending[`${tab.ws}:${tab.path}`] : null
          const title = tab.kind === 'note' ? stripExt(basename(tab.path)) : tab.kind === 'graph' ? 'Graph' : tab.kind === 'tasks' ? 'Tasks' : 'Home'
          return (
            <div
              key={tab.id}
              className={`tab ${pane.active === tab.id ? 'active' : ''}`}
              title={tab.kind === 'note' ? tab.path : title}
              draggable
              onDragStart={() => (dragIdx.current = idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIdx.current != null && dragIdx.current !== idx) useLayout.getState().reorderTab(pane.id, dragIdx.current, idx)
                dragIdx.current = null
              }}
              onClick={() => useLayout.getState().setActive(pane.id, tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  useLayout.getState().closeTab(pane.id, tab.id)
                }
              }}
              onContextMenu={(e) => tabMenu(e, tab, idx)}
            >
              {busy ? <span className="spinner sm tab-icon" style={{ borderWidth: 1.5 }} /> : <Icon className="tab-icon" />}
              <span className="tab-title">{title}</span>
              {tab.pinned ? (
                <Pin size={11} style={{ opacity: 0.6 }} />
              ) : (
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    useLayout.getState().closeTab(pane.id, tab.id)
                  }}
                >
                  <X />
                </button>
              )}
            </div>
          )
        })}
        <button className="icon-btn tab-add" title="New tab" onClick={() => useLayout.getState().newTab()}>
          <Plus />
        </button>
        <div className="tabbar-actions">
          {multi && (
            <button className="icon-btn" title="Close split" onClick={() => pane.tabs.forEach((t) => useLayout.getState().closeTab(pane.id, t.id))}>
              <X />
            </button>
          )}
          {!multi && (
            <button className="icon-btn" title="Split right" onClick={() => useLayout.getState().splitRight()}>
              <SplitSquareHorizontal />
            </button>
          )}
        </div>
      </div>
      <div className="pane-content">
        {!activeTab && <Home />}
        {activeTab &&
          pane.tabs.map((tab) => (
            <div key={tab.id} style={{ display: tab.id === pane.active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <TabContent tab={tab} paneId={pane.id} active={tab.id === pane.active && isActive} />
            </div>
          ))}
      </div>
    </div>
  )
}

function TabContent({ tab, paneId, active }) {
  if (tab.kind === 'note' && isBoardPath(tab.path)) return <BoardView tab={tab} paneId={paneId} active={active} />
  if (tab.kind === 'note') return <NoteView tab={tab} paneId={paneId} active={active} />
  if (tab.kind === 'graph') return <GraphView />
  if (tab.kind === 'tasks') return <TasksView />
  return <Home />
}
