// Your place in the note (lib/places.js), shown on its line: a tint and a bar down
// its left edge. Only colour, so it moves nothing (the canvas is pinned to lines).
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

/** The start of the line that is your place, or null for none */
export const setPlace = StateEffect.define()

const mark = Decoration.line({ class: 'cm-reading-place', attributes: { title: 'Your place — where you left off' } })

export const placeField = StateField.define({
  create: () => null,
  update(pos, tr) {
    for (const e of tr.effects) if (e.is(setPlace)) return e.value
    // (it stays on its line as the text above it changes)
    return pos == null || !tr.docChanged ? pos : tr.state.doc.lineAt(tr.changes.mapPos(pos)).from
  },
  provide: (f) => EditorView.decorations.from(f, (pos) => (pos == null ? Decoration.none : Decoration.set([mark.range(pos)]))),
})
