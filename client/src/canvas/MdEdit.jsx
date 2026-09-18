import { useEffect, useRef } from 'react'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, standardKeymap } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { classHighlighter } from '@lezer/highlight'
import { obiMarkdownExtensions } from '../editor/markdownExt.js'
import { livePreview, blockWidgets, editorCtx } from '../editor/livePreview.js'
import { obiHighlight } from '../editor/setup.js'

// Editing a markdown block runs the same live preview as a note, so a heading
// looks like a heading while you type it instead of after you click away.
export function MdEdit({ el, ctx, style }) {
  const host = useRef(null)
  const viewRef = useRef(null)
  const elRef = useRef(el)
  elRef.current = el

  useEffect(() => {
    const controller = ctx.controller
    const commit = () => controller.commitEditing(viewRef.current?.state.doc.toString() ?? '')
    const view = new EditorView({
      state: EditorState.create({
        doc: elRef.current.text || '',
        extensions: [
          editorCtx.of(ctx),
          EditorView.lineWrapping,
          drawSelection(),
          history(),
          markdown({ base: markdownLanguage, codeLanguages: languages, extensions: obiMarkdownExtensions, addKeymap: true }),
          syntaxHighlighting(obiHighlight),
          syntaxHighlighting(classHighlighter),
          livePreview,
          blockWidgets,
          keymap.of([
            {
              key: 'Escape',
              run: () => {
                commit()
                ctx.focusCanvas?.()
                return true
              },
            },
            { key: 'Mod-Enter', run: () => (commit(), ctx.focusCanvas?.(), true) },
          ]),
          keymap.of([...historyKeymap, ...standardKeymap, ...defaultKeymap]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            // the block grows as you write, measured from what is on screen
            controller.setEditingValue(u.state.doc.toString(), Math.ceil(u.view.dom.getBoundingClientRect().height))
          }),
          EditorView.domEventHandlers({
            blur: () => {
              commit()
              return false
            },
            pointerdown: (e) => e.stopPropagation(),
            paste: (e) => e.stopPropagation(),
            copy: (e) => e.stopPropagation(),
            cut: (e) => e.stopPropagation(),
          }),
        ],
      }),
      parent: host.current,
    })
    viewRef.current = view
    view.focus()
    controller.setEditingValue(view.state.doc.toString(), Math.ceil(view.dom.getBoundingClientRect().height))
    return () => {
      viewRef.current = null
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="cv-edit cv-md-edit obi-editor" style={style} onPointerDown={(e) => e.stopPropagation()} />
}
