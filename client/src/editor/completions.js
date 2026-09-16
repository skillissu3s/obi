import { snippetCompletion } from '@codemirror/autocomplete'
import { editorCtx } from './livePreview.js'
import { basename, stripExt, dirname, isNote, extname } from '@shared/paths.js'
import { formatDate } from '../lib/util.js'

// ---------- [[wiki links]] ----------
export function wikiCompletion(context) {
  const ctx = context.state.facet(editorCtx)
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  const m = /(!?)\[\[([^\[\]\n]*)$/.exec(before)
  if (!m) return null
  const raw = m[2]
  const embed = m[1] === '!'
  const hashIdx = raw.search(/[#^]/)
  const after = context.state.sliceDoc(context.pos, context.pos + 2)
  const closing = after === ']]' ? 2 : 0

  const applyLink = (text) => (view, completion, from, to) => {
    view.dispatch({
      changes: { from, to: to + closing, insert: `${text}]]` },
      selection: { anchor: from + text.length + 2 },
      userEvent: 'input.complete',
    })
  }

  if (hashIdx >= 0) {
    // heading completion within a note
    const targetName = raw.slice(0, hashIdx).trim()
    const query = raw.slice(hashIdx + 1)
    const targetPath = targetName ? ctx.resolve?.(targetName) : ctx.path
    const headings = targetPath ? ctx.headings?.(targetPath) || [] : []
    return {
      from: context.pos - query.length,
      options: headings.map((h) => ({
        label: h.text,
        detail: '#'.repeat(h.level),
        type: 'heading',
        apply: (view, c, from, to) => {
          const insert = h.text
          view.dispatch({ changes: { from, to: to + closing, insert: insert + ']]' }, selection: { anchor: from + insert.length + 2 } })
        },
      })),
      validFor: /^[^\]\n]*$/,
    }
  }

  const files = ctx.files?.() || []
  const options = []
  for (const f of files) {
    const note = isNote(f.path)
    if (!embed && !note) continue
    const name = note ? stripExt(basename(f.path)) : basename(f.path)
    const folder = dirname(f.path)
    options.push({
      label: name,
      detail: folder || (note ? '' : extname(f.path)),
      type: note ? 'note' : 'file',
      boost: note ? 1 : 0,
      apply: applyLink(ctx.linkTextFor ? ctx.linkTextFor(f.path) : name),
    })
    if (folder) options.push({ label: f.path.replace(/\.md$/, ''), detail: 'path', type: note ? 'note' : 'file', boost: -2, apply: applyLink(f.path.replace(/\.md$/, '')) })
  }
  for (const a of ctx.aliases?.() || []) {
    options.push({ label: a.alias, detail: `alias · ${stripExt(basename(a.path))}`, type: 'note', boost: 1, apply: applyLink(`${stripExt(basename(a.path))}|${a.alias}`) })
  }
  if (raw.trim() && !files.some((f) => stripExt(basename(f.path)).toLowerCase() === raw.trim().toLowerCase())) {
    options.push({ label: raw.trim(), detail: 'Create new note', type: 'create', boost: -5, apply: applyLink(raw.trim()) })
  }
  return { from: context.pos - raw.length, options, validFor: /^[^\[\]#^|\n]*$/ }
}

// ---------- #tags ----------
export function tagCompletion(context) {
  const ctx = context.state.facet(editorCtx)
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  const m = /(?:^|[\s(,;])#([\p{L}\p{N}_\-/]*)$/u.exec(before)
  if (!m) return null
  if (/^#{1,6}\s*$/.test(before)) return null
  const tags = ctx.tags?.() || []
  if (!tags.length && !m[1]) return null
  return {
    from: context.pos - m[1].length,
    options: tags.map((t) => ({ label: t.tag, detail: String(t.count), type: 'tag' })),
    validFor: /^[\p{L}\p{N}_\-/]*$/u,
  }
}

// ---------- /slash commands ----------
const SLASH = [
  { label: 'Heading 1', keywords: 'h1 title', snippet: '# ${}' },
  { label: 'Heading 2', keywords: 'h2', snippet: '## ${}' },
  { label: 'Heading 3', keywords: 'h3', snippet: '### ${}' },
  { label: 'To-do', keywords: 'task checkbox todo', snippet: '- [ ] ${}' },
  { label: 'Bullet list', keywords: 'ul list', snippet: '- ${}' },
  { label: 'Numbered list', keywords: 'ol ordered', snippet: '1. ${}' },
  { label: 'Quote', keywords: 'blockquote', snippet: '> ${}' },
  { label: 'Callout — note', keywords: 'admonition info', snippet: '> [!note] ${Title}\n> ${}' },
  { label: 'Callout — tip', keywords: 'admonition', snippet: '> [!tip] ${Title}\n> ${}' },
  { label: 'Callout — warning', keywords: 'admonition', snippet: '> [!warning] ${Title}\n> ${}' },
  { label: 'Code block', keywords: 'fence pre', snippet: '```${language}\n${}\n```' },
  { label: 'Table', keywords: 'grid', snippet: '| ${Column} | ${Column 2} |\n| --- | --- |\n| ${} |  |' },
  { label: 'Divider', keywords: 'hr rule line', snippet: '\n---\n' },
  { label: 'Math block', keywords: 'latex katex formula', snippet: '$$\n${}\n$$' },
  { label: 'Mermaid diagram', keywords: 'chart flow graph', snippet: '```mermaid\nflowchart LR\n  ${A} --> ${B}\n```' },
  { label: 'Link to note', keywords: 'wikilink internal', snippet: '[[${}]]' },
  { label: 'Embed note', keywords: 'transclude include', snippet: '![[${}]]' },
  { label: 'Front matter', keywords: 'yaml properties metadata', snippet: '---\ntags: [${}]\n---\n' },
  { label: 'Table of contents placeholder', keywords: 'toc outline', snippet: '## Contents\n- [[${}]]' },
]

export function slashCompletion(context) {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  const m = /(?:^|\s)\/([\w-]*)$/.exec(before)
  if (!m) return null
  const from = context.pos - m[1].length - 1
  const options = SLASH.map((s) =>
    snippetCompletion(s.snippet, {
      label: s.label,
      detail: s.keywords.split(' ')[0],
      type: 'block',
      section: 'Blocks',
    }),
  )
  const now = new Date()
  options.push(
    { label: "Today's date", detail: formatDate(now, 'YYYY-MM-DD'), type: 'block', apply: formatDate(now, 'YYYY-MM-DD'), section: 'Insert' },
    { label: 'Current time', detail: formatDate(now, 'HH:mm'), type: 'block', apply: formatDate(now, 'HH:mm'), section: 'Insert' },
    { label: 'Date & time', detail: formatDate(now, 'YYYY-MM-DD HH:mm'), type: 'block', apply: formatDate(now, 'YYYY-MM-DD HH:mm'), section: 'Insert' },
  )
  const ctx = context.state.facet(editorCtx)
  for (const tpl of ctx.templates?.() || []) {
    options.push({
      label: stripExt(basename(tpl)),
      detail: 'template',
      type: 'block',
      section: 'Templates',
      apply: (view, c, from2, to) => ctx.insertTemplate?.(view, tpl, from2, to),
    })
  }
  return { from, options, validFor: /^[\w-]*$/ }
}
