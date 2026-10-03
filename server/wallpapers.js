import express from 'express'
import { requireAuth } from './auth.js'
import { rateLimit } from './security.js'
import { APP_NAME } from './config.js'
import { createWallpapers, WallpaperError } from './wallpaperProviders.js'

// Background images: which sources this server can reach, what they offer, and
// the "this picture was chosen" ping some of them ask for. API keys come from
// the environment (see README) and never leave the server.
const wallpapers = createWallpapers({ appName: APP_NAME })

export const wallpaperRouter = express.Router()
wallpaperRouter.use(requireAuth)

// Browsing thumbnails is a request or two a second at most; the providers' own limits are far lower.
const handle = (fn) => async (req, res) => {
  if (!rateLimit(`wallpapers:${req.user.id}`, 90, 60 * 1000)) return res.status(429).json({ error: 'Too many requests — slow down a little' })
  try {
    res.json(await fn(req))
  } catch (e) {
    if (!(e instanceof WallpaperError)) throw e
    // sent here rather than through the error handler, which hides the text of 5xx errors
    res.status(e.status).json({ error: e.message })
  }
}
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

wallpaperRouter.get('/providers', handle(async () => ({ providers: wallpapers.providers() })))

wallpaperRouter.get(
  '/search',
  handle(async (req) => {
    const provider = text(req.query.provider, 40)
    const q = text(req.query.q, 100)
    const page = Math.min(50, Math.max(1, parseInt(req.query.page, 10) || 1))
    return { provider, q, page, ...(await wallpapers.search(provider, q, page)) }
  }),
)

wallpaperRouter.post(
  '/track',
  handle(async (req) => {
    const id = text(req.body?.id, 80)
    if (!/^[\w.:-]+$/.test(id)) throw new WallpaperError(400, 'Missing picture id')
    await wallpapers.track(text(req.body?.provider, 40), id)
    return { ok: true }
  }),
)
