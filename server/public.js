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
  return { row, rt, content, boards }
}

function renderFor({ row, rt, content, boards }) {
  const published = new Map(all('SELECT slug, path FROM published WHERE workspace_id = ?', row.workspace_id).map((r) => [r.path, r.slug]))
  const { render } = createMarkdown({
    html: false,
    noteEmbeds: false,
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
      const { svg, empty } = boardToSvg(elements, { maxHeight, title: noteTitle(p), fileUrl: (src) => `/p/${row.slug}/file?path=${encodeURIComponent(src)}` })
      return empty ? '' : `<figure class="board">${svg}</figure>`
    },
  })
  return render(content, { path: row.path })
}

const page = (title, body, slug) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<style>
:root{--bg:#fcfbf7;--fg:#201d18;--muted:#5d5749;--border:#e8e4d9;--accent:#217a5c;--code:#f2f0e8;--mark:#f3e0a1}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--fg:#ebe7df;--muted:#a49e93;--border:#2a2823;--accent:#4db894;--code:#1d1c19;--mark:#4a3c18}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:740px;margin:0 auto;padding:56px 22px 80px}
h1,h2,h3,h4{line-height:1.25;letter-spacing:-.01em;margin:1.8em 0 .6em}h1{font-size:2.1em;margin-top:0}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}.is-unresolved{color:var(--muted)}
code{background:var(--code);padding:.15em .35em;border-radius:5px;font-size:.88em;font-family:ui-monospace,"JetBrains Mono",monospace}
pre{background:var(--code);padding:14px 16px;border-radius:10px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--border);color:var(--muted)}
.callout{border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent);color:var(--fg);border-radius:8px;padding:.6em 1em}
.callout-title{font-weight:600;margin:.2em 0}
img,video{max-width:100%;border-radius:8px}table{border-collapse:collapse;width:100%;display:block;overflow:auto}th,td{border:1px solid var(--border);padding:6px 12px}
mark{background:var(--mark);color:inherit;padding:0 .15em;border-radius:3px}.tag{background:color-mix(in srgb,var(--accent) 14%,transparent);padding:.1em .45em;border-radius:99px;font-size:.88em}
ul.contains-task-list{list-style:none;padding-left:1.2em}.task-list-item input{margin-right:.5em}.task-list-item.is-checked{color:var(--muted);text-decoration:line-through}
hr{border:none;border-top:1px solid var(--border);margin:2em 0}
footer{margin-top:64px;color:var(--muted);font-size:13px;border-top:1px solid var(--border);padding-top:16px}
.math,.mermaid-block{font-family:ui-monospace,monospace;white-space:pre-wrap;background:var(--code);padding:.2em .4em;border-radius:6px}
figure.board{margin:1.4em 0;padding:8px;border:1px solid var(--border);border-radius:12px;overflow:auto;text-align:center}
figure.board svg{display:inline-block}
:root{--cv-bg:var(--bg);--cv-ink:#1e1c18;--cv-gray:#8a857b;--cv-red:#d6453d;--cv-orange:#e07b2c;--cv-yellow:#d9a514;--cv-green:#2f9e58;--cv-teal:#1f9a94;--cv-blue:#2f6fdb;--cv-violet:#7c4ddb;--cv-pink:#d6448f;
--cv-gray-fill:#ecebe6;--cv-red-fill:#fbd9d6;--cv-orange-fill:#fde2c8;--cv-yellow-fill:#fbefb8;--cv-green-fill:#d3f0dc;--cv-teal-fill:#cdeeec;--cv-blue-fill:#d7e5fb;--cv-violet-fill:#e5dbfa;--cv-pink-fill:#f9d7ea;--cv-ink-fill:#e4e2dc;
--cv-sticky-yellow:#fde68a;--cv-sticky-orange:#fdc79a;--cv-sticky-pink:#f9b8d4;--cv-sticky-violet:#d4c2fb;--cv-sticky-blue:#b9d5fb;--cv-sticky-teal:#a6e3dd;--cv-sticky-green:#bfe8b5;--cv-sticky-gray:#e2e0da;
--cv-card:#fff;--cv-card-border:#e3dfd4;--cv-frame:rgba(0,0,0,.02)}
@media (prefers-color-scheme:dark){:root{--cv-ink:#ebe7df;--cv-gray:#9c968b;--cv-red:#f07068;--cv-orange:#f39a55;--cv-yellow:#f0c648;--cv-green:#5cc983;--cv-teal:#4cc7c0;--cv-blue:#6ea0f5;--cv-violet:#a88af5;--cv-pink:#f27ab6;
--cv-gray-fill:#2c2a26;--cv-red-fill:#4a2522;--cv-orange-fill:#4a311e;--cv-yellow-fill:#473b16;--cv-green-fill:#1f3d2a;--cv-teal-fill:#1b3c3a;--cv-blue-fill:#1f3050;--cv-violet-fill:#33284f;--cv-pink-fill:#48233a;--cv-ink-fill:#34322d;
--cv-card:#1b1a18;--cv-card-border:#34322d;--cv-frame:rgba(255,255,255,.02)}}
</style></head><body><main><article id="content">${body}</article>
<footer>Published with ${escapeHtml(APP_NAME)} · updates live</footer></main>
<script>
(function(){var last=null;setInterval(function(){if(document.hidden)return;fetch('/p/${slug}/html',{cache:'no-store'}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h!=null&&h!==last){if(last!==null)document.getElementById('content').innerHTML=h;last=h}}).catch(function(){})},8000)})();
document.addEventListener('change',function(e){if(e.target.matches('.task-checkbox'))e.target.checked=!e.target.checked});
</script></body></html>`

const bodyHtml = (title, html) => {
  const hasH1 = /^\s*<h1[\s>]/.test(html)
  return (hasH1 ? '' : `<h1>${escapeHtml(title)}</h1>`) + html
}

publicRouter.get('/:slug', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  if (!data) return res.status(404).send(page('Not found', '<h1>Not found</h1><p>This page is not published.</p>', ''))
  const title = noteTitle(data.row.path)
  const { html } = renderFor(data)
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'")
  res.send(page(title, bodyHtml(title, html), data.row.slug))
})

publicRouter.get('/:slug/html', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  if (!data) return res.status(404).end()
  const { html } = renderFor(data)
  res.setHeader('Cache-Control', 'no-store')
  res.type('text/html').send(bodyHtml(noteTitle(data.row.path), html))
})

publicRouter.get('/:slug/file', async (req, res) => {
  const data = await loadPublished(req.params.slug)
  if (!data) return res.status(404).end()
  const p = safePath(req.query.path)
  const ext = extname(p)
  const meta = data.rt.meta.get(data.row.path)
  const inBoard = [...data.boards.values()].some((els) => els?.some((e) => e.type === 'image' && e.src === p))
  const allowed = inBoard || meta?.links.some((l) => data.rt.resolver.resolve(l.target, data.row.path, l.kind) === p)
  if (!allowed || !(IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext) || ext === 'pdf') || !data.rt.hasFile(p)) return res.status(404).end()
  res.setHeader('Content-Type', mimeFor(ext))
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!INLINE_SAFE.has(ext)) res.attachment()
  res.sendFile(absPath(data.rt.dir, p), { maxAge: 300000 })
})
