// /download/<platform> — the desktop app's installers.
//
// The files live on GitHub Releases (they are ~120 MB each and this server has
// better things to do), but the links people see belong to this site. Asset
// names carry the version, so rather than guessing them we ask GitHub for the
// latest release and cache the answer.
//
//   DOWNLOAD_REPO=owner/repo   where the releases are published
//   GITHUB_TOKEN               optional; only raises the API rate limit
import express from 'express'
import { DOWNLOAD_REPO, APP_NAME } from './config.js'

export const downloadRouter = express.Router()

const CACHE_MS = 15 * 60 * 1000
const FAIL_MS = 60 * 1000
let cache = { at: 0, release: null }

const PLATFORMS = {
  windows: [/\.exe$/i],
  mac: [/(universal|-mac).*\.dmg$/i, /arm64.*\.dmg$/i, /\.dmg$/i, /\.pkg$/i],
  linux: [/\.appimage$/i, /\.deb$/i, /\.rpm$/i],
}
const ALIASES = { win: 'windows', win32: 'windows', macos: 'mac', osx: 'mac', darwin: 'mac' }

async function latestRelease() {
  const t = Date.now()
  if (cache.release && t - cache.at < CACHE_MS) return cache.release
  if (!cache.release && t - cache.at < FAIL_MS) return null // don't hammer after a miss
  try {
    const res = await fetch(`https://api.github.com/repos/${DOWNLOAD_REPO}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `${APP_NAME}-server`,
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    })
    const release = res.ok ? await res.json() : null
    cache = { at: t, release }
    return release
  } catch {
    cache = { at: t, release: null }
    return null
  }
}

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161513;color:#ebe7df;font:16px/1.6 system-ui,sans-serif;text-align:center;padding:24px}
a{color:#6cc9a7}main{max-width:32rem}h1{font-size:22px;margin:0 0 10px}p{color:#b9b3a8;margin:0 0 18px}
@media (prefers-color-scheme:light){body{background:#fcfbf7;color:#201d18}p{color:#4a453c}a{color:#1d6b51}}</style>
<main><h1>${title}</h1>${body}</main>`

async function handle(req, res) {
  const wanted = ALIASES[String(req.params.platform || '').toLowerCase()] || String(req.params.platform || '').toLowerCase()
  if (!DOWNLOAD_REPO) {
    return res
      .status(404)
      .type('html')
      .send(page('No builds published yet', `<p>The desktop app isn’t published from this server yet. You can build it from the source with <code>npm run desktop:build</code>.</p><p><a href="/welcome">Back to ${APP_NAME}</a></p>`))
  }
  const releasesPage = `https://github.com/${DOWNLOAD_REPO}/releases`
  const release = await latestRelease()
  const assets = release?.assets || []
  // no platform (or one we don't know): the releases page lists them all
  const patterns = PLATFORMS[wanted]
  if (!patterns || !assets.length) return res.redirect(302, release ? release.html_url : releasesPage)
  for (const re of patterns) {
    const hit = assets.find((a) => re.test(a.name))
    if (hit) return res.redirect(302, hit.browser_download_url)
  }
  res
    .status(404)
    .type('html')
    .send(page(`No ${wanted} build in the latest release`, `<p>The other platforms may be there.</p><p><a href="${release?.html_url || releasesPage}">See all downloads</a></p>`))
}

// What the intro page shows on its download button: the version and size of
// the latest Windows build, straight from the cached release.
downloadRouter.get('/info', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  if (!DOWNLOAD_REPO) return res.json({ available: false })
  const release = await latestRelease()
  const exe = release?.assets?.find((a) => PLATFORMS.windows.some((re) => re.test(a.name)))
  if (!exe) return res.json({ available: false })
  res.json({
    available: true,
    version: String(release.tag_name || '').replace(/^v/, ''),
    publishedAt: release.published_at,
    windows: { size: exe.size, name: exe.name },
  })
})

downloadRouter.get('/', handle)
downloadRouter.get('/:platform', handle)
