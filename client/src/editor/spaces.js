// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing.
// Drawing spaces in the editor: room opened under a line for drawing in
// (canvas/spaces.js), shown as an empty block of that height — a block widget,
// so CodeMirror counts it in its height map and the lines below move down with
// it. The published page puts the same block under the same line.
//
// NoteCanvas says where the spaces are (setSpaces) and what resizing or
// removing one does (spaceActions). Dragging a space's bottom edge resizes it
// here at once (resizeSpace) and stores the new height when let go.
import { Facet, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { SPACE_MAX, SPACE_MIN, SPACE_STEP } from '../canvas/spaces.js'

/** [{ id, line (1-based), h }] */
export const setSpaces = StateEffect.define()
/** { id, h }: a space's height while it is being dragged */
const resizeSpace = StateEffect.define()

/** { resize(id, h), remove(id), readOnly } from NoteCanvas */
export const spaceActions = Facet.define({ combine: (v) => v[v.length - 1] || null })

const X_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'

class SpaceWidget extends WidgetType {
  constructor(id, h) {
    super()
    this.id = id
    this.h = h
  }

  eq(other) {
    return other.id === this.id && other.h === this.h
  }

  get estimatedHeight() {
    return this.h
  }

  updateDOM(dom) {
    if (dom.dataset.space !== this.id) return false
    dom.style.height = `${this.h}px`
    return true
  }

  toDOM(view) {
    const dom = document.createElement('div')
    dom.className = 'cm-obi-space'
    dom.dataset.space = this.id
    dom.style.height = `${this.h}px`
    dom.contentEditable = 'false'
    dom.setAttribute('aria-label', 'Drawing space')
    const actions = () => view.state.facet(spaceActions)
    if (actions()?.readOnly) return dom

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'cm-obi-space-x'
    remove.title = 'Remove this space (the drawings in it stay)'
    remove.setAttribute('aria-label', 'Remove this drawing space')
    remove.innerHTML = X_ICON
    remove.addEventListener('click', (e) => {
      e.preventDefault()
      actions()?.remove(this.id)
    })
    const grip = document.createElement('div')
    grip.className = 'cm-obi-space-grip'
    grip.title = 'Drag to make the space taller or shorter'
    grip.appendChild(document.createElement('span'))
    grip.addEventListener('pointerdown', (e) => {
      const act = actions()
      if (!act || act.readOnly || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const id = this.id
      const from = parseFloat(dom.style.height) || this.h
      // a zoomed note is scaled on screen: a pixel moved is 1/scale of the note's own
      const scale = dom.getBoundingClientRect().height / (dom.offsetHeight || 1) || 1
      const startY = e.clientY
      let h = from
      dom.classList.add('is-resizing')
      const move = (ev) => {
        const next = Math.min(SPACE_MAX, Math.max(SPACE_MIN, Math.round((from + (ev.clientY - startY) / scale) / SPACE_STEP) * SPACE_STEP))
        if (next === h) return
        h = next
        view.dispatch({ effects: resizeSpace.of({ id, h }) })
      }
      // (on the window, so the drag goes on wherever the pointer goes)
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        dom.classList.remove('is-resizing')
        if (h !== from) act.resize(id, h)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    })
    dom.append(remove, grip)
    return dom
  }

  ignoreEvent() {
    return true
  }
}

const spaceDeco = (id, h) => Decoration.widget({ widget: new SpaceWidget(id, h), block: true, side: 1 })

export const spaceField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setSpaces)) {
        const doc = tr.state.doc
        const ranges = e.value.filter((s) => s.line >= 1).map((s) => spaceDeco(s.id, s.h).range(doc.line(Math.min(s.line, doc.lines)).to))
        deco = Decoration.set(ranges, true)
      } else if (e.is(resizeSpace)) {
        const ranges = []
        deco.between(0, tr.state.doc.length, (from, to, value) => {
          const w = value.spec.widget
          ranges.push((w.id === e.value.id ? spaceDeco(w.id, e.value.h) : value).range(from))
        })
        deco = Decoration.set(ranges, true)
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** Is the screen point (x, y) on a drawing space? (there it is the canvas's, not the text's) */
export const onSpace = (x, y) => document.elementsFromPoint(x, y).some((el) => el.classList?.contains('cm-obi-space'))
