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
import { all, one, run, now } from './db.js'

export const downloadRouter = express.Router()

const CACHE_MS = 15 * 60 * 1000
const FAIL_MS = 60 * 1000
let cache = { at: 0, release: null }

const PLATFORMS = {
  windows: [/\.exe$/i],
  mac: [/(universal|-mac).*\.dmg$/i, /\.dmg$/i, /\.pkg$/i],
  linux: [/\.appimage$/i, /\.deb$/i, /\.rpm$/i],
  // the Linux packages one by one, for a page that offers both
  appimage: [/\.appimage$/i],
  deb: [/\.deb$/i],
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
    if (hit) {
      recordDownload(req, wanted, release.tag_name)
      return res.redirect(302, hit.browser_download_url)
    }
  }
  res
    .status(404)
    .type('html')
    .send(page(`No ${wanted} build in the latest release`, `<p>The other platforms may be there.</p><p><a href="${release?.html_url || releasesPage}">See all downloads</a></p>`))
}

// The build a platform's link hands out, as /download/<platform> picks it
const assetFor = (release, platform) => {
  for (const re of PLATFORMS[platform]) {
    const hit = release?.assets?.find((a) => re.test(a.name))
    if (hit) return { size: hit.size, name: hit.name }
  }
  return null
}

// What the intro page shows on its download links: the version, and the size of
// each platform's build (null for one the latest release doesn't have).
downloadRouter.get('/info', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  if (!DOWNLOAD_REPO) return res.json({ available: false })
  const release = await latestRelease()
  const builds = Object.fromEntries(['windows', 'mac', 'appimage', 'deb'].map((p) => [p, assetFor(release, p)]))
  if (!Object.values(builds).some(Boolean)) return res.json({ available: false })
  res.json({
    available: true,
    version: String(release.tag_name || '').replace(/^v/, ''),
    publishedAt: release.published_at,
    ...builds,
  })
})

// ---------------- statistics (the admin console) ----------------

// link checkers, crawlers and chat previews follow links too: they aren't downloads
export const isBot = (req) => /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|discord|telegram|headless|lighthouse/i.test(req.get('user-agent') || '')

/** A download through this site's links: when, and which build. Nothing about who. */
function recordDownload(req, platform, tag) {
  if (req.method !== 'GET' || isBot(req)) return
  try {
    run('INSERT INTO download_events (at, platform, version) VALUES (?, ?, ?)', now(), platform, String(tag || '').replace(/^v/, '') || null)
  } catch {}
}

const DAY = 24 * 60 * 60 * 1000
const platformOf = (name) => {
  if (/\.blockmap$|\.ya?ml$|uninstaller/i.test(name)) return null
  if (/\.exe$/i.test(name)) return 'windows'
  if (/\.(dmg|pkg)$/i.test(name) || /mac.*\.zip$/i.test(name)) return 'mac'
  if (/\.(appimage|deb|rpm)$/i.test(name)) return 'linux'
  return null
}

let statsCache = { at: 0, value: null }
/** GitHub's own count of every installer's downloads, release by release (it includes the app's updates) */
async function githubDownloads() {
  if (!DOWNLOAD_REPO) return null
  if (statsCache.value && Date.now() - statsCache.at < CACHE_MS) return statsCache.value
  const res = await fetch(`https://api.github.com/repos/${DOWNLOAD_REPO}/releases?per_page=100`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `${APP_NAME}-server`, ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const releases = (await res.json())
    .filter((r) => !r.draft)
    .map((r) => {
      const row = { version: String(r.tag_name || '').replace(/^v/, ''), date: r.published_at, windows: 0, mac: 0, linux: 0 }
      for (const a of r.assets || []) {
        const p = platformOf(a.name)
        if (p) row[p] += a.download_count || 0
      }
      row.total = row.windows + row.mac + row.linux
      return row
    })
  const totals = { windows: 0, mac: 0, linux: 0, total: 0 }
  for (const r of releases) for (const k of Object.keys(totals)) totals[k] += r[k]
  const value = { releases, totals, repo: DOWNLOAD_REPO }
  statsCache = { at: Date.now(), value }
  return value
}

/** Downloads, for the admin console: this site's links (a count a day for 30 days, by platform) and GitHub's */
export async function downloadStats() {
  const t = now()
  const since = (days) => one('SELECT COUNT(*) AS n FROM download_events WHERE at >= ?', t - days * DAY).n
  const byPlatform = Object.fromEntries(all('SELECT platform, COUNT(*) AS n FROM download_events GROUP BY platform').map((r) => [r.platform, r.n]))
  const start = new Date(t - 29 * DAY)
  start.setHours(0, 0, 0, 0)
  const counts = new Map()
  for (const r of all('SELECT at FROM download_events WHERE at >= ?', start.getTime())) {
    const d = new Date(r.at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY + 12 * 60 * 60 * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { day: key, n: counts.get(key) || 0 }
  })
  const site = { total: one('SELECT COUNT(*) AS n FROM download_events').n, last7: since(7), last30: since(30), byPlatform, days, since: one('SELECT MIN(at) AS t FROM download_events').t }
  let github = null
  let githubError = null
  try {
    github = await githubDownloads()
  } catch (e) {
    githubError = e.message
  }
  return { configured: !!DOWNLOAD_REPO, site, github, githubError }
}

downloadRouter.get('/', handle)
downloadRouter.get('/:platform', handle)
