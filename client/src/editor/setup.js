import { EditorView, keymap, drawSelection, dropCursor, highlightSpecialChars, rectangularSelection, crosshairCursor, lineNumbers, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState, Compartment, Prec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, standardKeymap } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching, foldKeymap, codeFolding } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { classHighlighter } from '@lezer/highlight'
import { yCollab } from 'y-codemirror.next'
import { obiMarkdownExtensions, obiTags } from './markdownExt.js'
import { livePreview, blockWidgets, linkHandlers, editorCtx, editorFocusField, setEditorFocus } from './livePreview.js'
import { wikiCompletion, tagCompletion, slashCompletion } from './completions.js'
import { markdownKeymapFor } from './commands.js'
import { annotationField } from './annotations.js'

const obiHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-hd cm-hd1' },
  { tag: t.heading2, class: 'cm-hd cm-hd2' },
  { tag: t.heading3, class: 'cm-hd cm-hd3' },
  { tag: t.heading4, class: 'cm-hd' },
  { tag: t.heading5, class: 'cm-hd' },
  { tag: t.heading6, class: 'cm-hd' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strikethrough, class: 'cm-strike' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.link, class: 'cm-link-text' },
  { tag: t.url, class: 'cm-url' },
  { tag: t.quote, class: 'cm-quote' },
  { tag: t.processingInstruction, class: 'cm-md-mark' },
  { tag: t.contentSeparator, class: 'cm-md-mark' },
  { tag: obiTags.wikiLink, class: 'cm-wikilink' },
  { tag: obiTags.wikiMark, class: 'cm-md-mark' },
  { tag: obiTags.hashtag, class: 'cm-tag-src' },
  { tag: obiTags.highlight, class: 'cm-hl' },
  { tag: obiTags.highlightMark, class: 'cm-md-mark' },
  { tag: obiTags.frontmatter, class: 'cm-frontmatter-text' },
  { tag: t.comment, class: 'cm-comment' },
])

export const compartments = () => ({
  mode: new Compartment(),
  readOnly: new Compartment(),
  collab: new Compartment(),
  prefs: new Compartment(),
  canvas: new Compartment(),
})

export function baseExtensions({ ctx, comps, handle, mode, prefs, onUpdate, onFocus, placeholderText }) {
  const exts = [
    editorCtx.of(ctx),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    indentUnit.of('    '),
    bracketMatching(),
    closeBrackets(),
    codeFolding(),
    highlightSelectionMatches({ minSelectionLength: 3 }),
    search({ top: true }),
    autocompletion({
      override: [wikiCompletion, tagCompletion, slashCompletion],
      closeOnBlur: true,
      icons: true,
      activateOnTyping: true,
      maxRenderedOptions: 60,
      defaultKeymap: true,
    }),
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: obiMarkdownExtensions, addKeymap: true }),
    syntaxHighlighting(obiHighlight),
    syntaxHighlighting(classHighlighter),
    linkHandlers,
    Prec.high(keymap.of(markdownKeymapFor())),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    keymap.of(standardKeymap),
    keymap.of(defaultKeymap),
    editorFocusField,
    EditorView.updateListener.of((u) => {
      if (u.focusChanged) {
        onFocus?.(u.view.hasFocus)
        u.view.dispatch({ effects: setEditorFocus.of(u.view.hasFocus) })
      }
      if (u.docChanged || u.selectionSet) onUpdate?.(u)
    }),
    comps.mode.of(mode === 'source' ? [] : [livePreview, blockWidgets]),
    comps.readOnly.of([]),
    comps.collab.of([]),
    comps.prefs.of(prefsExtensions(prefs)),
    annotationField,
    comps.canvas.of([]),
  ]
  if (placeholderText) exts.push(cmPlaceholder(placeholderText))
  if (!handle) exts.push(history())
  return exts
}

export function prefsExtensions(prefs) {
  const exts = []
  if (prefs.lineNumbers) exts.push(lineNumbers())
  if (prefs.spellcheck) exts.push(EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }))
  else exts.push(EditorView.contentAttributes.of({ spellcheck: 'false' }))
  return exts
}

export function collabExtensions(handle) {
  if (!handle) return []
  return [yCollab(handle.ytext, handle.awareness, { undoManager: handle.undoManager })]
}

export function modeExtensions(mode) {
  return mode === 'source' ? [] : [livePreview, blockWidgets]
}

export function readOnlyExtensions(readOnly) {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
}
