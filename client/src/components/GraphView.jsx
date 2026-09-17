import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Maximize, Settings2, X } from 'lucide-react'
import { useApp } from '../store/app.js'
import { useLayout } from '../store/layout.js'
import { usePrefs } from '../store/prefs.js'
import { buildGraph, GraphRenderer } from '../lib/graph.js'
import { Switch } from './ui.jsx'
import { isNote, stripExt, basename } from '@shared/paths.js'

function useGraph(canvasRef, { focus, depth, options, onClick, compact }) {
  const notes = useApp((s) => s.notes)
  const tree = useApp((s) => s.tree)
  const resolver = useApp((s) => s.resolver)
  const version = useApp((s) => s.version)
  const rendererRef = useRef(null)
  const [hover, setHover] = useState(null)

  const data = useMemo(() => buildGraph({ notes, tree, resolver, options, focus, depth }), [version, options.showTags, options.showUnresolved, options.showAttachments, options.showOrphans, focus, depth])

  useEffect(() => {
    if (!canvasRef.current) return
    const r = new GraphRenderer(canvasRef.current, {
      ...options,
      onClick: (node, e) => onClick?.(node, e),
      onHover: (node) => setHover(node),
    })
    rendererRef.current = r
    const obs = new MutationObserver(() => r.refreshColors())
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] })
    return () => {
      obs.disconnect()
      r.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.setData(data, focus)
    if (compact || !r.fitted) {
      setTimeout(() => r.fit(), 350)
      r.fitted = true
    }
  }, [data, focus])

  useEffect(() => {
    rendererRef.current?.setOptions(options)
  }, [options.repel, options.linkDistance, options.nodeSize, options.labels, options.colorFolders])

  return { renderer: rendererRef, hover, count: data.nodes.length, links: data.links.length }
}

export function GraphView() {
  const canvasRef = useRef(null)
  const prefs = usePrefs()
  const wsId = useApp((s) => s.wsId)
  const [showSettings, setShowSettings] = useState(false)
  const [query, setQuery] = useState('')
  const options = prefs.graph
  const setOpt = (patch) => prefs.set({ graph: { ...prefs.graph, ...patch } })

  const { renderer, hover, count, links } = useGraph(canvasRef, {
    options,
    onClick: (node, e) => {
      if (node.type === 'note') useLayout.getState().openNote(wsId, node.path, { newTab: e.metaKey || e.ctrlKey || e.button === 1 })
      else if (node.type === 'tag') window.dispatchEvent(new CustomEvent('obi:search', { detail: { query: `tag:${node.label.slice(1)}` } }))
    },
  })

  useEffect(() => {
    const r = renderer.current
    if (!r) return
    r.searchQuery = query.toLowerCase()
    r.needsDraw = true
  }, [query, renderer])

  return (
    <div className="graph-view">
      <canvas ref={canvasRef} />
      <div className="graph-search">
        <div className="search-box" style={{ margin: 0 }}>
          <Search />
          <input
            className="input"
            placeholder="Find a note…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              const r = renderer.current
              if (!r) return
              const q = e.target.value.toLowerCase()
              if (!q) return
              const hit = r.nodes.find((n) => n.label.toLowerCase().includes(q))
              if (hit) {
                r.transform.x = -hit.x * r.transform.k
                r.transform.y = -hit.y * r.transform.k
                r.setHover(hit)
              }
            }}
          />
        </div>
      </div>
      <div className="graph-controls" style={{ paddingBottom: showSettings ? 10 : 6 }}>
        <div className="gc-row" style={{ fontWeight: 600 }}>
          <span>Graph</span>
          <span className="row" style={{ gap: 2 }}>
            <button className="icon-btn sm" title="Fit to screen" onClick={() => renderer.current?.fit()}>
              <Maximize />
            </button>
            <button className="icon-btn sm" title="Settings" onClick={() => setShowSettings(!showSettings)}>
              {showSettings ? <X /> : <Settings2 />}
            </button>
          </span>
        </div>
        <div className="gc-row faint">
          <span>
            {count} note{count === 1 ? '' : 's'} · {links} link{links === 1 ? '' : 's'}
          </span>
        </div>
        {showSettings && (
          <>
            <div className="gc-row">
              <span>Tags</span>
              <Switch checked={options.showTags} onChange={(v) => setOpt({ showTags: v })} />
            </div>
            <div className="gc-row">
              <span>Attachments</span>
              <Switch checked={options.showAttachments} onChange={(v) => setOpt({ showAttachments: v })} />
            </div>
            <div className="gc-row">
              <span>Unresolved links</span>
              <Switch checked={options.showUnresolved} onChange={(v) => setOpt({ showUnresolved: v })} />
            </div>
            <div className="gc-row">
              <span>Orphans</span>
              <Switch checked={options.showOrphans} onChange={(v) => setOpt({ showOrphans: v })} />
            </div>
            <div className="gc-row">
              <span>Colour by folder</span>
              <Switch checked={options.colorFolders} onChange={(v) => setOpt({ colorFolders: v })} />
            </div>
            <div className="gc-row">
              <span>Repel</span>
              <input type="range" min="30" max="400" value={options.repel} onChange={(e) => setOpt({ repel: Number(e.target.value) })} />
            </div>
            <div className="gc-row">
              <span>Link distance</span>
              <input type="range" min="20" max="220" value={options.linkDistance} onChange={(e) => setOpt({ linkDistance: Number(e.target.value) })} />
            </div>
            <div className="gc-row">
              <span>Node size</span>
              <input type="range" min="0.5" max="3" step="0.1" value={options.nodeSize} onChange={(e) => setOpt({ nodeSize: Number(e.target.value) })} />
            </div>
            <div className="gc-row">
              <span>Labels</span>
              <input type="range" min="0.3" max="3" step="0.1" value={options.labels} onChange={(e) => setOpt({ labels: Number(e.target.value) })} />
            </div>
          </>
        )}
      </div>
      <div className="graph-legend">{hover ? hover.label : 'Drag to pan · scroll to zoom · double-click to fit'}</div>
    </div>
  )
}

export function LocalGraph({ path }) {
  const canvasRef = useRef(null)
  const wsId = useApp((s) => s.wsId)
  const prefs = usePrefs()
  const [depth, setDepth] = useState(1)
  const options = useMemo(() => ({ ...prefs.graph, showOrphans: true, nodeSize: 1, repel: 90, linkDistance: 55 }), [prefs.graph])
  const { hover } = useGraph(canvasRef, {
    focus: path,
    depth,
    options,
    compact: true,
    onClick: (node, e) => {
      if (node.type === 'note') useLayout.getState().openNote(wsId, node.path, { newTab: e.metaKey || e.ctrlKey })
    },
  })
  return (
    <>
      <div className="local-graph">
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', padding: '8px 4px 0' }}>
        <span className="faint" style={{ fontSize: 11.5 }}>{hover ? hover.label : 'Local graph'}</span>
        <span className="segmented">
          {[1, 2, 3].map((d) => (
            <button key={d} className={depth === d ? 'active' : ''} onClick={() => setDepth(d)}>
              {d}
            </button>
          ))}
        </span>
      </div>
    </>
  )
}
