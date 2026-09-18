import express from 'express'
import { one, all } from './db.js'
import { getRuntime } from './runtime.js'
import { createMarkdown, escapeHtml } from '../shared/markdown.js'
import { absPath, mimeFor, safePath, INLINE_SAFE } from './fsutil.js'
import { noteTitle, extname, IMAGE_EXT, AUDIO_EXT, VIDEO_EXT } from '../shared/paths.js'
import { isBoardPath, parseBoard } from '../shared/board.js'
import { boardToSvg } from '../shared/boardsvg.js'
import { APP_NAME } from './config.js'

export const publicRouter = express.Router()

async function loadPublished(slug) {
  const row = one('SELECT * FROM published WHERE slug = ?', slug)
  if (!row) return null
  const rt = await getRuntime(row.workspace_id)
  const content = await rt.readNote(row.path)
  if (content == null) return null
  // whiteboards embedded with ![[x.board]] are rendered to static SVG
  const boards = new Map()
  for (const m of content.matchAll(/!\[\[([^\]|#]+\.board)/gi)) {
    const p = rt.resolver.resolve(m[1].trim(), row.path, 'wiki')
    if (!p || boards.has(p) || !isBoardPath(p)) continue
    try {
      boards.set(p, parseBoard(await rt.readNote(p)))
    } catch {
      boards.set(p, null)
    }
  }
  // the note's own canvas layer: drawings, sticky notes and links around the text
  let layer = []
  if (!isBoardPath(row.path)) {
    try {
      layer = parseBoard(await rt.readLayer(row.path))
    } catch {
      layer = []
    }
  }
  let theme = null
  try {
    theme = row.theme ? JSON.parse(row.theme) : null
  } catch {
    theme = null
  }
  return { row, rt, content, boards, layer, theme }
}

// ⚠ LAYOUT CONTRACT — read client/src/publish/README.md before changing any of
// the page below. The published page has to set every line of the note where
// the author's editor sets it: the typography lives in client/src/publish/
// publish.css, the canvas is laid out in the reader's browser by
// client/src/publish/main.js, and this file only supplies the author's values
// and the data.

// The author's resolved theme, so the page looks like the workspace it came
// from. Values are filtered before they reach the stylesheet: colours and
// sizes may not carry url(), expressions or anything that closes the rule.
const SAFE_VALUE = /^[#a-zA-Z0-9\s(),.%/_-]{1,120}$/
const SAFE_FONT = /^[\w\s'",.()/-]{1,240}$/
function themeCss(theme) {
  if (!theme?.vars) return ''
  const out = []
  for (const [k, v] of Object.entries(theme.vars)) {
    if (!/^[a-z0-9-]{1,40}$/.test(k) || typeof v !== 'string') continue
    const ok = k.startsWith('font-') ? SAFE_FONT.test(v) && !/[;{}<\\]|url\(/i.test(v) : SAFE_VALUE.test(v)
    if (ok) out.push(`--${k}:${v}`)
  }
  const px = (v, fallback) => (/^\d{1,4}(\.\d+)?px$/.test(String(v || '')) ? v : fallback)
  const num = (v, fallback) => (/^\d(\.\d+)?$/.test(String(v || '')) ? v : fallback)
  const col = Number.isFinite(theme.columnWidth) && theme.columnWidth >= 200 && theme.columnWidth <= 2400 ? `${theme.columnWidth}px` : px(theme.noteWidth, '620px')
  out.push(`--pub-fs:${px(theme.fontSize, '16px')}`, `--pub-lh:${num(theme.lineHeight, '1.75')}`, `--pub-col:${col}`, '--cv-bg:var(--bg)')
  return `:root{${out.join(';')};color-scheme:${theme.theme === 'light' ? 'light' : 'dark'}}`
}

// Pages published before the theme travelled with the link: light or dark to
// match the reader, with the app's default colours.
const FALLBACK_CSS = `:root{--bg:#fcfbf7;--bg-code:#f2f0e8;--text:#201d18;--text-2:#4a453c;--text-3:#6d675b;--text-faint:#8e887b;--border:#e8e4d9;--border-strong:#dcd7ca;--accent:#217a5c;--accent-text:#1d6b51;--mark-bg:#f3e0a1;--tint:40 34 24;--cv-bg:var(--bg);
--cv-ink:#1e1c18;--cv-gray:#8a857b;--cv-red:#d6453d;--cv-orange:#e07b2c;--cv-yellow:#d9a514;--cv-green:#2f9e58;--cv-teal:#1f9a94;--cv-blue:#2f6fdb;--cv-violet:#7c4ddb;--cv-pink:#d6448f;
--cv-gray-fill:#ecebe6;--cv-red-fill:#fbd9d6;--cv-orange-fill:#fde2c8;--cv-yellow-fill:#fbefb8;--cv-green-fill:#d3f0dc;--cv-teal-fill:#cdeeec;--cv-blue-fill:#d7e5fb;--cv-violet-fill:#e5dbfa;--cv-pink-fill:#f9d7ea;--cv-ink-fill:#e4e2dc;
--cv-sticky-yellow:#fde68a;--cv-sticky-orange:#fdc79a;--cv-sticky-pink:#f9b8d4;--cv-sticky-violet:#d4c2fb;--cv-sticky-blue:#b9d5fb;--cv-sticky-teal:#a6e3dd;--cv-sticky-green:#bfe8b5;--cv-sticky-gray:#e2e0da;
--cv-card:#fff;--cv-card-border:#e3dfd4;--cv-frame:rgba(0,0,0,.02);
--cv-hl-yellow:rgba(234,179,8,.3);--cv-hl-green:rgba(34,197,94,.26);--cv-hl-blue:rgba(59,130,246,.3);--cv-hl-pink:rgba(236,72,153,.28);--cv-hl-violet:rgba(139,92,246,.32);--cv-hl-orange:rgba(249,115,22,.28)}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--bg-code:#1f1e1b;--text:#ebe7df;--text-2:#c9c4ba;--text-3:#a49e93;--text-faint:#7d786f;--border:#2a2823;--border-strong:#36332d;--accent:#4db894;--accent-text:#6cc9a7;--mark-bg:#4a3c18;--tint:255 247 234;
--cv-ink:#ebe7df;--cv-gray:#9c968b;--cv-red:#f07068;--cv-orange:#f39a55;--cv-yellow:#f0c648;--cv-green:#5cc983;--cv-teal:#4cc7c0;--cv-blue:#6ea0f5;--cv-violet:#a88af5;--cv-pink:#f27ab6;
--cv-gray-fill:#2c2a26;--cv-red-fill:#4a2522;--cv-orange-fill:#4a311e;--cv-yellow-fill:#473b16;--cv-green-fill:#1f3d2a;--cv-teal-fill:#1b3c3a;--cv-blue-fill:#1f3050;--cv-violet-fill:#33284f;--cv-pink-fill:#48233a;--cv-ink-fill:#34322d;
--cv-card:#1b1a18;--cv-card-border:#34322d;--cv-frame:rgba(255,255,255,.02);
--cv-hl-yellow:rgba(250,204,21,.38);--cv-hl-green:rgba(74,222,128,.32);--cv-hl-blue:rgba(96,165,250,.3);--cv-hl-pink:rgba(244,114,182,.3);--cv-hl-violet:rgba(167,139,250,.32);--cv-hl-orange:rgba(251,146,60,.32)}}`

function renderFor({ row, rt, content, boards }) {
  const published = new Map(all('SELECT slug, path FROM published WHERE workspace_id = ?', row.workspace_id).map((r) => [r.path, r.slug]))
  const { render } = createMarkdown({
    html: false,
    noteEmbeds: false,
    // every block and line carries its source line; see the contract above
    sourceLines: true,
    resolve: (target, kind, env) => {
      const p = rt.resolver.resolve(target, env.path, kind)
      if (!p) return { href: null, exists: false, path: null }
      const slug = published.get(p)
      return { href: slug ? `/p/${slug}` : null, exists: !!slug, path: p }
    },
    fileUrl: (p) => `/p/${row.slug}/file?path=${encodeURIComponent(p)}`,
    boardEmbed: (r, env, { target, display }) => {
      const p = rt.resolver.resolve(target, env.path, 'wiki')
      const elements = p ? boards?.get(p) : null
      if (!elements) return `<p class="board-missing">${escapeHtml(noteTitle(target))}</p>`
      const maxHeight = display && /^\d+$/.test(display) ? Number(display) : 520
      const { svg, empty } = boardToSvg(elements, {
        maxHeight,
        title: noteTitle(p),
        fileUrl: (src) => `/p/${row.slug}/file?path=${encodeURIComponent(src)}`,
        renderMarkdown: plainMarkdown,
      })
      return empty ? '' : `<figure class="board">${svg}</figure>`
    },
  })
  return render(content, { path: row.path })
}

// markdown inside a canvas text block, with links left inert on a static page
const plainMd = createMarkdown({ html: false, noteEmbeds: false, resolve: () => ({ href: null, exists: false, path: null }), fileUrl: (p) => p })
const plainMarkdown = (text) => plainMd.render(String(text || ''), {}).html

// What the reader's browser needs to lay the canvas out itself: the note's
// source (anchors are resolved against it, exactly as in the editor), the
// elements, and the rendered HTML of any markdown text blocks.
function canvasPayload(data) {
  if (!data.layer?.length) return null
  const md = {}
  for (const el of data.layer) if (el.type === 'text' && el.md) md[el.id] = plainMarkdown(el.text || '')
  return { text: data.content, elements: data.layer, md, fileBase: `/p/${data.row.slug}/file?path=` }
}

// JSON inside a <script type="application/json"> must not be able to close it
const jsonForScript = (v) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

const page = (title, body, slug, { theme = null, canvas = null, bodyClass = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<link rel="stylesheet" href="/publish.css">
<style>${FALLBACK_CSS}
${themeCss(theme)}</style></head><body class="${bodyClass}" data-slug="${escapeHtml(slug)}"><main><article id="content">${body}</article>
<footer>Published with ${escapeHtml(APP_NAME)} · updates live</footer></main>
${canvas ? `<script type="application/json" id="obi-canvas">${jsonForScript(canvas)}</script>` : ''}
<script type="module" src="/publish.js"></script>
</body></html>`

const bodyHtml = (title, html) => {
  const hasH1 = /^\s*<h1[\s>]/.test(html)
  return (hasH1 ? '' : `<h1 class="obi-title">${escapeHtml(title)}</h1>`) + html
}

// A published whiteboard is the whole page: the board drawn at its own size.
function boardPageHtml(data) {
  const elements = parseBoard(data.content)
  const { svg, empty } = boardToSvg(elements, {
    title: noteTitle(data.row.path),
    fileUrl: (src) => `/p/${data.row.slug}/file?path=${encodeURIComponent(src)}`,
    renderMarkdown: plainMarkdown,
  })
  return empty ? '<p class="board-missing">This whiteboard is empty.</p>' : `<figure class="board">${svg}</figure>`
}

const CSP = "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; frame-src 'self'"

publicRouter.get('/:slug', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  res.setHeader('Content-Security-Policy', CSP)
  if (!data) return res.status(404).send(page('Not found', '<h1>Not found</h1><p>This page is not published.</p>', ''))
  const title = noteTitle(data.row.path)
  const board = isBoardPath(data.row.path)
  res.setHeader('Cache-Control', 'no-cache')
  res.send(
    page(title, board ? boardPageHtml(data) : bodyHtml(title, renderFor(data).html), data.row.slug, {
      theme: data.theme,
      canvas: board ? null : canvasPayload(data),
      bodyClass: board ? 'is-board' : '',
    }),
  )
})

// The text and the canvas travel together, so a live update never shows one
// without the other.
publicRouter.get('/:slug/data', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  if (!data) return res.status(404).end()
  const title = noteTitle(data.row.path)
  const board = isBoardPath(data.row.path)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ html: board ? boardPageHtml(data) : bodyHtml(title, renderFor(data).html), canvas: board ? null : canvasPayload(data) })
})

publicRouter.get('/:slug/html', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  if (!data) return res.status(404).end()
  const title = noteTitle(data.row.path)
  const html = isBoardPath(data.row.path) ? boardPageHtml(data) : bodyHtml(title, renderFor(data).html)
  res.setHeader('Cache-Control', 'no-store')
  res.type('text/html').send(html)
})

publicRouter.get('/:slug/file', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  if (!data) return res.status(404).end()
  const p = safePath(req.query.path)
  const ext = extname(p)
  const meta = data.rt.meta.get(data.row.path)
  const fromBoard = (els) => els?.some((e) => e.type === 'image' && e.src === p)
  const inBoard =
    [...data.boards.values()].some(fromBoard) ||
    fromBoard(data.layer) ||
    (isBoardPath(data.row.path) && fromBoard(parseBoard(data.content)))
  const allowed = inBoard || meta?.links.some((l) => data.rt.resolver.resolve(l.target, data.row.path, l.kind) === p)
  if (!allowed || !(IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext) || ext === 'pdf') || !data.rt.hasFile(p)) return res.status(404).end()
  res.setHeader('Content-Type', mimeFor(ext))
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!INLINE_SAFE.has(ext)) res.attachment()
  res.sendFile(absPath(data.rt.dir, p), { maxAge: 300000 })
})
