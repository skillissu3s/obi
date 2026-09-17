// Highlights and canvas references drawn into the note text (the markdown itself is untouched).
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

export const setAnnotations = StateEffect.define()

// value: [{ from, to, cls, attrs }]
export const annotationField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setAnnotations)) continue
      const len = tr.state.doc.length
      const ranges = e.value
        .filter((a) => a.to > a.from && a.from >= 0 && a.to <= len)
        .map((a) => Decoration.mark({ class: a.cls, attributes: a.attrs, inclusiveStart: false, inclusiveEnd: false }).range(a.from, a.to))
      deco = Decoration.set(ranges, true)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// Annotation (id) under a document position, if any.
export function annotationAt(state, pos) {
  let found = null
  state.field(annotationField, false)?.between(pos, pos, (from, to, value) => {
    const id = value.spec.attributes?.['data-anno']
    if (id && from <= pos && to >= pos && !found) found = { id, from, to }
  })
  return found
}
