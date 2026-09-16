import { EditorSelection } from '@codemirror/state'
import { editorCtx, toggleTaskAt } from './livePreview.js'

function wordAt(state, pos) {
  const line = state.doc.lineAt(pos)
  const rel = pos - line.from
  let a = rel
  let b = rel
  const isWord = (c) => c && /[\p{L}\p{N}_'-]/u.test(c)
  while (a > 0 && isWord(line.text[a - 1])) a--
  while (b < line.text.length && isWord(line.text[b])) b++
  return a === b ? null : { from: line.from + a, to: line.from + b }
}

export function toggleWrap(mark, markEnd = mark) {
  return (view) => {
    const { state } = view
    if (state.readOnly) return false
    const changes = []
    const selection = []
    for (const range of state.selection.ranges) {
      let { from, to } = range
      if (from === to) {
        const w = wordAt(state, from)
        if (w) {
          from = w.from
          to = w.to
        }
      }
      const before = state.sliceDoc(Math.max(0, from - mark.length), from)
      const after = state.sliceDoc(to, Math.min(state.doc.length, to + markEnd.length))
      const inner = state.sliceDoc(from, to)
      if (before === mark && after === markEnd) {
        changes.push({ from: from - mark.length, to: from, insert: '' }, { from: to, to: to + markEnd.length, insert: '' })
        selection.push(EditorSelection.range(from - mark.length, to - mark.length))
      } else if (inner.startsWith(mark) && inner.endsWith(markEnd) && inner.length > mark.length + markEnd.length) {
        changes.push({ from, to, insert: inner.slice(mark.length, inner.length - markEnd.length) })
        selection.push(EditorSelection.range(from, to - mark.length - markEnd.length))
      } else {
        changes.push({ from, to, insert: mark + inner + markEnd })
        selection.push(from === to ? EditorSelection.cursor(from + mark.length) : EditorSelection.range(from + mark.length, to + mark.length))
      }
    }
    view.dispatch({ changes, selection: EditorSelection.create(selection, state.selection.mainIndex), userEvent: 'input.format', scrollIntoView: true })
    return true
  }
}

export const insertLink = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to)
  const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(text)
  const insert = isUrl ? `[](${text})` : `[${text}]()`
  const cursor = isUrl ? range.from + 1 : range.from + text.length + 3
  view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: cursor }, userEvent: 'input.format' })
  return true
}

export const insertWikiLink = (view) => {
  if (view.state.readOnly) return false
  const range = view.state.selection.main
  const text = view.state.sliceDoc(range.from, range.to)
  view.dispatch({ changes: { from: range.from, to: range.to, insert: `[[${text}]]` }, selection: { anchor: range.from + 2 + text.length }, userEvent: 'input.format' })
  return true
}

export const toggleTask = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const changes = []
  const lines = new Set()
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n)
  }
  for (const n of lines) {
    const line = state.doc.line(n)
    const task = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX/\-])(\])/.exec(line.text)
    if (task) {
      changes.push({ from: line.from + task[1].length, to: line.from + task[1].length + 1, insert: task[2] === ' ' ? 'x' : ' ' })
      continue
    }
    const list = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line.text)
    if (list) {
      changes.push({ from: line.from + list[0].length, to: line.from + list[0].length, insert: '[ ] ' })
      continue
    }
    const indent = /^\s*/.exec(line.text)[0]
    changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: '- [ ] ' })
  }
  if (!changes.length) return false
  view.dispatch({ changes, userEvent: 'input.format' })
  return true
}

export function setHeading(level) {
  return (view) => {
    const { state } = view
    if (state.readOnly) return false
    const changes = []
    const lines = new Set()
    for (const range of state.selection.ranges) {
      for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n)
    }
    for (const n of lines) {
      const line = state.doc.line(n)
      const m = /^(#{1,6})\s+/.exec(line.text)
      const prefix = level ? '#'.repeat(level) + ' ' : ''
      if (m) {
        const same = m[1].length === level
        changes.push({ from: line.from, to: line.from + m[0].length, insert: same ? '' : prefix })
      } else if (level) {
        changes.push({ from: line.from, to: line.from, insert: prefix })
      }
    }
    if (!changes.length) return false
    view.dispatch({ changes, userEvent: 'input.format' })
    return true
  }
}

export const toggleQuote = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const changes = []
  const lines = new Set()
  for (const range of state.selection.ranges) for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n)
  const all = [...lines].every((n) => /^\s*>\s?/.test(state.doc.line(n).text))
  for (const n of lines) {
    const line = state.doc.line(n)
    if (all) {
      const m = /^(\s*)(>\s?)/.exec(line.text)
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' })
    } else {
      changes.push({ from: line.from, to: line.from, insert: '> ' })
    }
  }
  view.dispatch({ changes, userEvent: 'input.format' })
  return true
}

export const toggleBulletList = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const changes = []
  const lines = new Set()
  for (const range of state.selection.ranges) for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n)
  const all = [...lines].every((n) => /^\s*[-*+]\s/.test(state.doc.line(n).text))
  for (const n of lines) {
    const line = state.doc.line(n)
    if (all) {
      const m = /^(\s*)([-*+]\s+)/.exec(line.text)
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' })
    } else if (line.text.trim()) {
      const indent = /^\s*/.exec(line.text)[0]
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: '- ' })
    }
  }
  view.dispatch({ changes, userEvent: 'input.format' })
  return true
}

export const toggleCodeBlock = (view) => {
  const { state } = view
  if (state.readOnly) return false
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to)
  if (text.includes('\n') || !text) {
    const from = state.doc.lineAt(range.from).from
    const to = state.doc.lineAt(range.to).to
    const body = state.sliceDoc(from, to)
    view.dispatch({ changes: { from, to, insert: '```\n' + body + '\n```' }, selection: { anchor: from + 3 }, userEvent: 'input.format' })
  } else {
    toggleWrap('`')(view)
  }
  return true
}

export const clickTaskInReading = toggleTaskAt

export function markdownKeymapFor() {
  return [
    { key: 'Mod-b', run: toggleWrap('**'), preventDefault: true },
    { key: 'Mod-i', run: toggleWrap('*'), preventDefault: true },
    { key: 'Mod-Shift-h', run: toggleWrap('=='), preventDefault: true },
    { key: 'Mod-Shift-x', run: toggleWrap('~~'), preventDefault: true },
    { key: 'Mod-e', run: toggleWrap('`'), preventDefault: true },
    { key: 'Mod-k', run: insertLink, preventDefault: true },
    { key: 'Mod-Shift-k', run: insertWikiLink, preventDefault: true },
    { key: 'Mod-Enter', run: toggleTask, preventDefault: true },
    { key: 'Mod-Shift-q', run: toggleQuote, preventDefault: true },
    { key: 'Mod-Shift-l', run: toggleBulletList, preventDefault: true },
    { key: 'Mod-Shift-c', run: toggleCodeBlock, preventDefault: true },
    { key: 'Mod-1', run: setHeading(1), preventDefault: true },
    { key: 'Mod-2', run: setHeading(2), preventDefault: true },
    { key: 'Mod-3', run: setHeading(3), preventDefault: true },
    { key: 'Mod-0', run: setHeading(0), preventDefault: true },
  ]
}

export function getCtx(view) {
  return view.state.facet(editorCtx)
}
