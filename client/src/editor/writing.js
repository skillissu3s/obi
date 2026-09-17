// Small writing comforts: typewriter scrolling and dimming everything but the
// paragraph you are in. Both are opt-in from Settings → Editor.
import { EditorView, ViewPlugin, Decoration } from '@codemirror/view'

const scrollerOf = (view) => view.scrollDOM.closest('.note-scroll') || view.scrollDOM

// Keeps the caret line at a comfortable height instead of letting it drift to the bottom.
export const typewriterScroll = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view
      this.frame = 0
    }
    update(u) {
      if (!u.docChanged && !u.selectionSet) return
      if (!u.view.hasFocus || u.view.state.selection.ranges.length !== 1) return
      if (!u.state.selection.main.empty && !u.docChanged) return
      this.schedule()
    }
    schedule() {
      cancelAnimationFrame(this.frame)
      this.frame = requestAnimationFrame(() => this.center())
    }
    center() {
      const view = this.view
      if (!view.hasFocus) return
      const scroller = scrollerOf(view)
      const head = view.state.selection.main.head
      const coords = view.coordsAtPos(head)
      if (!coords || !scroller) return
      const box = scroller.getBoundingClientRect()
      // a little above the middle reads better than dead centre
      const target = box.top + Math.min(box.height * 0.42, box.height - 120)
      const delta = (coords.top + coords.bottom) / 2 - target
      const max = scroller.scrollHeight - scroller.clientHeight
      const next = Math.max(0, Math.min(max, scroller.scrollTop + delta))
      if (Math.abs(next - scroller.scrollTop) > 1) scroller.scrollTop = next
    }
    destroy() {
      cancelAnimationFrame(this.frame)
    }
  },
)

const dimmed = Decoration.line({ class: 'cm-dimmed' })

// Dims every block except the one the cursor sits in.
export const paragraphFocus = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view)
    }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = this.build(u.view)
    }
    build(view) {
      const { state } = view
      if (!view.hasFocus || state.selection.ranges.length !== 1) return Decoration.none
      const doc = state.doc
      const sel = state.selection.main
      const from = doc.lineAt(sel.from).number
      const to = doc.lineAt(sel.to).number
      // the active block: neighbouring non-blank lines
      let top = from
      while (top > 1 && doc.line(top - 1).text.trim()) top--
      let bottom = to
      while (bottom < doc.lines && doc.line(bottom + 1).text.trim()) bottom++
      const ranges = []
      for (const { from: vf, to: vt } of view.visibleRanges) {
        let line = doc.lineAt(vf)
        while (line.from <= vt) {
          if (line.number < top || line.number > bottom) ranges.push(dimmed.range(line.from))
          if (line.to + 1 > doc.length) break
          line = doc.lineAt(line.to + 1)
        }
      }
      return Decoration.set(ranges, true)
    }
  },
  { decorations: (v) => v.decorations },
)

export const writingExtensions = ({ typewriter, focusParagraph }) => [
  typewriter ? typewriterScroll : [],
  focusParagraph ? paragraphFocus : [],
  focusParagraph ? EditorView.editorAttributes.of({ class: 'cm-focus-paragraph' }) : [],
]
