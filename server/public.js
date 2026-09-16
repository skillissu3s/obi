import express from 'express'
import { one, all } from './db.js'
import { getRuntime } from './runtime.js'
import { createMarkdown, escapeHtml } from '../shared/markdown.js'
import { absPath, mimeFor, safePath, INLINE_SAFE } from './fsutil.js'
import { noteTitle, extname, IMAGE_EXT, AUDIO_EXT, VIDEO_EXT } from '../shared/paths.js'
import { APP_NAME } from './config.js'

export const publicRouter = express.Router()

async function loadPublished(slug) {
  const row = one('SELECT * FROM published WHERE slug = ?', slug)
  if (!row) return null
  const rt = await getRuntime(row.workspace_id)
  const content = await rt.readNote(row.path)
  if (content == null) return null
  return { row, rt, content }
}

function renderFor({ row, rt, content }) {
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
  const allowed = meta?.links.some((l) => data.rt.resolver.resolve(l.target, data.row.path, l.kind) === p)
  if (!allowed || !(IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext) || ext === 'pdf') || !data.rt.hasFile(p)) return res.status(404).end()
  res.setHeader('Content-Type', mimeFor(ext))
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!INLINE_SAFE.has(ext)) res.attachment()
  res.sendFile(absPath(data.rt.dir, p), { maxAge: 300000 })
})
