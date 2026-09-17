import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { baseExtensions, compartments, collabExtensions, modeExtensions, readOnlyExtensions, prefsExtensions } from '../editor/setup.js'
import { editorCtx, refreshEffect } from '../editor/livePreview.js'
import { usePrefs } from '../store/prefs.js'
import { useApp } from '../store/app.js'
import { buildEditorCtx, uploadFiles } from '../lib/actions.js'
import { toast } from '../store/ui.js'

const scrollMemory = new Map()

export function Editor({ handle, tabId, mode, readOnly, onStats, onViewReady, line, heading }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const compsRef = useRef(null)
  const prefs = usePrefs()
  const version = useApp((s) => s.version)

  // create the view
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const comps = compartments()
    compsRef.current = comps
    const ctx = buildEditorCtx(handle.ws, handle.path)
    const state = EditorState.create({
      doc: handle.ytext.toString(),
      extensions: [
        baseExtensions({
          ctx,
          comps,
          handle,
          mode,
          prefs: usePrefs.getState(),
          placeholderText: 'Start writing… type / for blocks, [[ to link',
          onUpdate: (u) => {
            if (onStats) onStats(statsFor(u.state))
          },
        }),
        EditorView.domEventHandlers({
          paste(event, view) {
            const files = [...(event.clipboardData?.files || [])]
            if (files.length) {
              event.preventDefault()
              handlePasteFiles(view, files)
              return true
            }
            const text = event.clipboardData?.getData('text/plain')?.trim()
            if (text && /^https?:\/\/\S+$/.test(text) && !view.state.selection.main.empty) {
              event.preventDefault()
              const { from, to } = view.state.selection.main
              const sel = view.state.sliceDoc(from, to)
              view.dispatch({ changes: { from, to, insert: `[${sel}](${text})` }, selection: { anchor: from + sel.length + text.length + 4 } })
              return true
            }
            return false
          },
          drop(event, view) {
            const files = [...(event.dataTransfer?.files || [])]
            if (!files.length) return false
            event.preventDefault()
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
            handlePasteFiles(view, files, pos)
            return true
          },
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    view.obiComps = comps // lets the canvas layer plug its listeners in
    viewRef.current = view
    view.dispatch({
      effects: [
        comps.collab.reconfigure(collabExtensions(handle)),
        comps.readOnly.reconfigure(readOnlyExtensions(readOnly)),
      ],
    })
    onViewReady?.(view)
    if (onStats) onStats(statsFor(view.state))

    const saved = scrollMemory.get(`${tabId}:${handle.key}`)
    if (saved != null && !line && !heading) {
      requestAnimationFrame(() => {
        const scroller = view.scrollDOM.closest('.note-scroll')
        if (scroller) scroller.scrollTop = saved
      })
    }
    return () => {
      const scroller = view.scrollDOM.closest('.note-scroll')
      if (scroller) scrollMemory.set(`${tabId}:${handle.key}`, scroller.scrollTop)
      onViewReady?.(null)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, tabId])

  // mode / readOnly / prefs
  useEffect(() => {
    const view = viewRef.current
    const comps = compsRef.current
    if (!view || !comps) return
    view.dispatch({ effects: comps.mode.reconfigure(modeExtensions(mode)) })
  }, [mode])

  useEffect(() => {
    const view = viewRef.current
    const comps = compsRef.current
    if (!view || !comps) return
    view.dispatch({ effects: comps.readOnly.reconfigure(readOnlyExtensions(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    const comps = compsRef.current
    if (!view || !comps) return
    view.dispatch({ effects: comps.prefs.reconfigure(prefsExtensions(prefs)) })
  }, [prefs.lineNumbers, prefs.spellcheck])

  // workspace index changed → re-resolve links
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dispatch({ effects: refreshEffect.of(null) })
  }, [version])

  // jump to a line / heading
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    let target = null
    if (line != null && line >= 0) target = line
    else if (heading) {
      const name = heading.replace(/^#+/, '').toLowerCase()
      const text = view.state.doc.toString().split('\n')
      const idx = text.findIndex((l) => /^#{1,6}\s+/.test(l) && l.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === name)
      if (idx >= 0) target = idx
    }
    if (target == null) return
    const t = setTimeout(() => {
      try {
        const l = view.state.doc.line(Math.min(target + 1, view.state.doc.lines))
        view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) })
        view.focus()
        flashLine(view, l.from)
      } catch {}
    }, 60)
    return () => clearTimeout(t)
  }, [line, heading, handle])

  return <div className="obi-editor" ref={hostRef} />
}

function flashLine(view, pos) {
  const dom = view.domAtPos(pos)?.node
  const el = dom?.nodeType === 3 ? dom.parentElement : dom
  const lineEl = el?.closest?.('.cm-line')
  if (!lineEl) return
  lineEl.animate([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], { duration: 1200, easing: 'ease-out' })
}

async function handlePasteFiles(view, files, pos) {
  const at = pos ?? view.state.selection.main.head
  // visible placeholder while the upload runs, swapped for the embed when it lands
  const placeholder = `⏳ Uploading ${files.length === 1 ? files[0].name || 'file' : `${files.length} files`}…`
  view.dispatch({ changes: { from: at, insert: placeholder }, selection: { anchor: at + placeholder.length } })
  let text = ''
  try {
    const paths = await uploadFiles(files)
    text = paths.map((p) => `![[${p.split('/').pop()}]]`).join('\n')
  } catch (e) {
    toast.error(e)
  }
  const cur = view.state.doc.toString().indexOf(placeholder)
  if (cur >= 0) view.dispatch({ changes: { from: cur, to: cur + placeholder.length, insert: text }, selection: { anchor: cur + text.length } })
  else if (text) view.dispatch({ changes: { from: view.state.selection.main.head, insert: text } })
}

function statsFor(state) {
  const text = state.doc.toString()
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length
  const sel = state.selection.main
  const selWords = sel.empty ? 0 : (state.sliceDoc(sel.from, sel.to).match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length
  return { words, chars: text.length, line: state.doc.lineAt(sel.head).number, col: sel.head - state.doc.lineAt(sel.head).from + 1, selWords }
}
