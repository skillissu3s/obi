// Parse / serialise Obsidian-Kanban compatible markdown boards.
import { splitFrontmatter } from '@shared/parse.js'

let idSeq = 0

export function isBoardContent(content) {
  const { frontmatter } = splitFrontmatter(content || '')
  return !!frontmatter && ('kanban-plugin' in frontmatter || frontmatter.kanban === true)
}

export function parseBoard(content) {
  const text = content || ''
  const fmMatch = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)
  const fm = fmMatch ? fmMatch[0] : ''
  const body = text.slice(fm.length)
  const lines = body.split('\n')
  const lanes = []
  const preamble = []
  let footer = []
  let lane = null
  let item = null
  let inFooter = false

  for (const line of lines) {
    if (inFooter) {
      footer.push(line)
      continue
    }
    if (/^%%\s*kanban:settings/.test(line) || /^\*\*\*\s*$/.test(line)) {
      inFooter = true
      footer.push(line)
      continue
    }
    const h = /^##\s+(.*)$/.exec(line)
    if (h) {
      lane = { id: `l${++idSeq}`, title: h[1].trim(), items: [], extra: [] }
      lanes.push(lane)
      item = null
      continue
    }
    const li = /^\s*[-*]\s+(?:\[([ xX/\-])\]\s+)?(.*)$/.exec(line)
    if (li && lane) {
      item = { id: `c${++idSeq}`, checked: li[1] === 'x' || li[1] === 'X', hasCheckbox: li[1] !== undefined, text: li[2], extra: [] }
      lane.items.push(item)
      continue
    }
    if (!lane) {
      preamble.push(line)
      continue
    }
    if (item && /^\s+\S/.test(line)) {
      item.extra.push(line)
      continue
    }
    if (line.trim()) {
      lane.extra.push(line)
      item = null
    }
  }
  return { fm, preamble: preamble.join('\n').trim(), lanes, footer: footer.join('\n').trim() }
}

function itemToMarkdown(item) {
  const box = item.hasCheckbox === false ? '' : `[${item.checked ? 'x' : ' '}] `
  return [`- ${box}${item.text}`, ...(item.extra || [])].join('\n')
}

export function serializeBoard(board) {
  const parts = []
  if (board.fm) parts.push(board.fm.replace(/\n+$/, '\n'))
  if (board.preamble) parts.push(board.preamble + '\n')
  for (const lane of board.lanes) {
    const body = [...lane.items.map(itemToMarkdown), ...(lane.extra || [])].join('\n')
    parts.push(`\n## ${lane.title}\n\n${body}${body ? '\n' : ''}`)
  }
  if (board.footer) parts.push('\n' + board.footer + '\n')
  return parts.join('').replace(/\n{4,}/g, '\n\n\n')
}

export function emptyBoardContent(title = 'Board') {
  return `---\nkanban-plugin: basic\n---\n\n## Backlog\n\n- [ ] First task\n\n## In progress\n\n## Done\n\n`
}

export function cloneBoard(board) {
  return { ...board, lanes: board.lanes.map((l) => ({ ...l, items: l.items.map((i) => ({ ...i })) })) }
}
