// Clipboard HTML -> markdown, for pasting from a web page or a doc.
//
// Deliberately small: it covers the tags people actually paste (headings,
// lists, links, emphasis, code, quotes, images, tables, rules) and falls back
// to the plain-text flavour of the clipboard for anything it can't read. The
// HTML is parsed with DOMParser and never inserted into the page, so nothing
// in it can run.

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL'])
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])

// Characters that would otherwise turn pasted prose into markup.
const escapeText = (s) => s.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(\s*)([-+]|#{1,6}|\d+[.)])(\s)/gm, '$1\\$2$3')

const collapse = (s) => s.replace(/[ \t\r\n]+/g, ' ')

function inline(node, ctx) {
  let out = ''
  for (const child of node.childNodes) out += serialize(child, ctx)
  return out
}

function listItems(node, ctx, ordered) {
  const items = [...node.children].filter((c) => c.tagName === 'LI')
  return items
    .map((li, i) => {
      const marker = ordered ? `${(Number(node.getAttribute('start')) || 1) + i}. ` : '- '
      const body = serialize(li, { ...ctx, list: true }).trim()
      const [first, ...rest] = body.split('\n')
      const pad = ' '.repeat(marker.length)
      return [marker + first, ...rest.map((l) => (l ? pad + l : l))].join('\n')
    })
    .join('\n')
}

function table(node, ctx) {
  const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => collapse(serialize(td, { ...ctx, cell: true })).trim().replace(/\|/g, '\\|')))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r) => [...r, ...Array(width - r.length).fill('')]
  const head = pad(rows[0])
  const body = rows.slice(1).map(pad)
  const line = (cells) => `| ${cells.join(' | ')} |`
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n')
}

function serialize(node, ctx) {
  if (node.nodeType === 3) return collapse(ctx.pre ? node.nodeValue : escapeText(node.nodeValue))
  if (node.nodeType !== 1) return ''
  const tag = node.tagName
  if (SKIP.has(tag)) return ''
  if (node.getAttribute?.('aria-hidden') === 'true') return ''

  switch (tag) {
    case 'BR':
      return ctx.cell ? ' ' : '\n'
    case 'HR':
      return '\n\n---\n\n'
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return `\n\n${'#'.repeat(+tag[1])} ${collapse(inline(node, ctx)).trim()}\n\n`
    case 'P':
      return `\n\n${inline(node, ctx).trim()}\n\n`
    case 'STRONG':
    case 'B': {
      const t = inline(node, ctx).trim()
      return t ? `**${t}**` : ''
    }
    case 'EM':
    case 'I': {
      const t = inline(node, ctx).trim()
      return t ? `*${t}*` : ''
    }
    case 'DEL':
    case 'S': {
      const t = inline(node, ctx).trim()
      return t ? `~~${t}~~` : ''
    }
    case 'MARK': {
      const t = inline(node, ctx).trim()
      return t ? `==${t}==` : ''
    }
    case 'CODE': {
      if (ctx.pre) return node.textContent
      const t = node.textContent.trim()
      if (!t) return ''
      const fence = '`'.repeat(Math.max(1, ...(t.match(/`+/g) || ['']).map((m) => m.length)) + 1)
      return `${fence}${t}${fence}`
    }
    case 'PRE': {
      const text = node.textContent.replace(/\n+$/, '')
      const lang = /\blanguage-([\w+-]+)/.exec(node.querySelector('code')?.className || '')?.[1] || ''
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`
    }
    case 'BLOCKQUOTE': {
      const body = serialize2(node, ctx).replace(/\n{3,}/g, '\n\n').trim()
      return `\n\n${body.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n`
    }
    // a nested list belongs to the line above it, not a paragraph of its own
    case 'UL':
    case 'OL': {
      const wrap = ctx.list ? '\n' : '\n\n'
      return `${wrap}${listItems(node, ctx, tag === 'OL')}${wrap}`
    }
    case 'LI':
      return inline(node, ctx)
    case 'A': {
      const href = node.getAttribute('href') || ''
      const text = collapse(inline(node, ctx)).trim()
      if (!text) return ''
      if (!href || href.startsWith('javascript:') || href.startsWith('#')) return text
      return `[${text}](${href})`
    }
    case 'IMG': {
      const src = node.getAttribute('src') || ''
      if (!src || src.startsWith('data:')) return ''
      return `![${(node.getAttribute('alt') || '').trim()}](${src})`
    }
    case 'TABLE':
      return `\n\n${table(node, ctx)}\n\n`
    default:
      return BLOCK.has(tag) ? `\n\n${inline(node, ctx).trim()}\n\n` : inline(node, ctx)
  }
}

// blockquote children, without the quote wrapper recursing into itself
const serialize2 = (node, ctx) => inline(node, ctx)

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const md = serialize(doc.body, { pre: false })
  return md
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Plain text dressed up as HTML (a single wrapper around one line, or a bare
// fragment) is better pasted as-is — converting it only adds escapes.
export function worthConverting(html, plain) {
  if (!html) return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return false
  if (body.querySelector('a[href], img[src], pre, code, table, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, strong, b, em, i, del, s, mark')) return true
  // several blocks of text still carry structure worth keeping
  const blocks = [...body.querySelectorAll('p, div, li, tr')].filter((el) => el.textContent.trim())
  if (blocks.length > 1) return true
  return false
}
