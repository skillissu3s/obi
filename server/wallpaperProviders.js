// Where background images come from. One adapter per provider turns that
// provider's own JSON into the same small shape,
//   { id, provider, thumb, url, width, height, color, author, authorUrl, sourceUrl, title?, license? }
// so the app never has to know who a picture came from.
//
// Keys live in the environment and stay on the server. Requests only ever go to
// the API hosts an adapter lists in `api`; nothing a browser sends picks a host.
// What comes back is checked before it is passed on: image links must be https
// on the provider's own image hosts, and every string is trimmed and capped.

const PER_PAGE = 24
const MAX_PAGES = 50
const TIMEOUT_MS = 8000
const MAX_BYTES = 2 * 1024 * 1024
const CACHE_MS = 15 * 60 * 1000
const CACHE_ENTRIES = 200
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// A page with nothing usable on it is skipped, but only this many in a row per request.
const MAX_SKIPPED = 2
// Requests to providers in flight at once, across every user; more wait their turn, up to a limit.
const MAX_CONCURRENT = 6
const MAX_QUEUED = 48
// Pictures remembered as offered by this server, and who has already been counted for one.
const REMEMBERED = 5000

export class WallpaperError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// a provider that did not answer properly; `kind` says how, and nothing here ever carries a URL
class Upstream extends Error {
  constructor(kind, status) {
    super(kind)
    this.kind = kind
    this.status = status
  }
}

// ---------- reading what comes back ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const rows = (v) => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const size = (v) => {
  const n = Math.round(Number(v))
  return n > 0 && n < 100000 ? n : 0
}
const plain = (html) =>
  str(typeof html === 'string' ? html.replace(/<[^>]*>/g, '') : '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function parseUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return null
  try {
    const u = new URL(v)
    if (u.protocol === 'http:') u.protocol = 'https:'
    return u.protocol === 'https:' && !u.port && !u.username && !u.password ? u : null
  } catch {
    return null
  }
}
const webUrl = (v) => parseUrl(v)?.href || ''
const imageUrl = (v, hosts) => {
  const u = parseUrl(v)
  return u && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.href : ''
}
function withParams(v, params) {
  const u = parseUrl(v)
  if (!u) return ''
  for (const [k, val] of Object.entries(params)) u.searchParams.set(k, val)
  return u.href
}
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

// One picture in the shared shape, or null when the provider left out something we need.
function make(p, f) {
  const id = typeof f.id === 'number' ? String(f.id) : f.id
  const url = imageUrl(f.url, p.images)
  if (typeof id !== 'string' || !/^[\w.:-]{1,80}$/.test(id) || !url) return null
  const item = {
    id,
    provider: p.id,
    thumb: imageUrl(f.thumb, p.images) || url,
    url,
    width: size(f.width),
    height: size(f.height),
    color: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color.toLowerCase() : '',
    author: str(f.author, 120),
    authorUrl: webUrl(f.authorUrl),
    sourceUrl: webUrl(f.sourceUrl),
  }
  if (f.title) item.title = str(f.title)
  if (f.license) item.license = str(f.license, 60)
  return item
}
const collect = (p, list, fn) => list.map((r) => make(p, fn(r))).filter(Boolean)

// ---------- the providers ----------

const FLICKR_LICENSES = {
  4: 'CC BY 2.0',
  5: 'CC BY-SA 2.0',
  7: 'No known copyright restrictions',
  8: 'US Government Work',
  9: 'CC0 1.0',
  10: 'Public Domain Mark',
}

const unsplash = {
  id: 'unsplash',
  name: 'Unsplash',
  keyEnv: 'UNSPLASH_ACCESS_KEY',
  keyUrl: 'https://unsplash.com/oauth/applications',
  needsKey: true,
  supportsSearch: true,
  featured: 'Popular editorial photos',
  licenseNote: 'Free to use under the Unsplash License. Photographer and Unsplash credit is required and shown here.',
  rate: [50, HOUR], // until Unsplash approves the app for production; UNSPLASH_REQUESTS_PER_HOUR says how many it then allows
  rateEnv: 'UNSPLASH_REQUESTS_PER_HOUR',
  api: ['api.unsplash.com'],
  images: ['images.unsplash.com', 'plus.unsplash.com'],
  async search({ get, key, appName }, { q, page }) {
    const params = q ? { query: q, orientation: 'landscape' } : { order_by: 'popular' }
    const data = await get(`https://api.unsplash.com/${q ? 'search/photos' : 'photos'}?${qs({ ...params, page, per_page: PER_PAGE })}`, { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' })
    const list = rows(q ? data.results : data)
    const utm = (u) => withParams(u, { utm_source: appName, utm_medium: 'referral' })
    return {
      items: collect(unsplash, list, (r) => ({
        id: r.id,
        thumb: r.urls?.small,
        url: withParams(r.urls?.raw, { w: 2560, q: 80, fm: 'jpg', fit: 'max' }),
        width: r.width,
        height: r.height,
        color: r.color,
        author: r.user?.name,
        authorUrl: utm(r.user?.links?.html),
        sourceUrl: utm(r.links?.html),
        title: r.description || r.alt_description,
      })),
      more: q ? page < data.total_pages : list.length === PER_PAGE,
    }
  },
  // Unsplash asks to be told when a photo is used; /photos/:id/download is its download_location endpoint
  async track({ get, key }, id) {
    if (!/^[\w-]{1,40}$/.test(id)) throw new WallpaperError(400, 'Not an Unsplash photo id')
    await get(`https://api.unsplash.com/photos/${id}/download`, { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' })
  },
}

const pexels = {
  id: 'pexels',
  name: 'Pexels',
  keyEnv: 'PEXELS_API_KEY',
  keyUrl: 'https://www.pexels.com/api/new/',
  needsKey: true,
  supportsSearch: true,
  featured: 'Curated photos',
  licenseNote: 'Free to use under the Pexels License. Credit to the photographer and Pexels is shown here.',
  rate: [200, HOUR],
  api: ['api.pexels.com'],
  images: ['images.pexels.com'],
  async search({ get, key }, { q, page }) {
    const params = q ? { query: q, orientation: 'landscape' } : {}
    const data = await get(`https://api.pexels.com/v1/${q ? 'search' : 'curated'}?${qs({ ...params, page, per_page: PER_PAGE })}`, { Authorization: key })
    return {
      items: collect(pexels, rows(data.photos), (r) => ({
        id: r.id,
        thumb: r.src?.medium,
        url: withParams(r.src?.original, { auto: 'compress', cs: 'tinysrgb', w: 2560 }),
        width: r.width,
        height: r.height,
        color: r.avg_color,
        author: r.photographer,
        authorUrl: r.photographer_url,
        sourceUrl: r.url,
        title: r.alt,
      })),
      more: typeof data.next_page === 'string',
    }
  },
}

const pixabay = {
  id: 'pixabay',
  name: 'Pixabay',
  keyEnv: 'PIXABAY_API_KEY',
  keyUrl: 'https://pixabay.com/api/docs/',
  needsKey: true,
  supportsSearch: true,
  featured: "Editor's choice",
  licenseNote: 'Free under the Pixabay Content License. Credit is not required but is shown here.',
  ttl: DAY, // Pixabay asks for results to be cached for 24 hours
  rate: [100, MINUTE],
  api: ['pixabay.com'],
  images: ['pixabay.com'],
  async search({ get, key }, { q, page }) {
    const params = q ? { q, order: 'popular' } : { editors_choice: true, order: 'latest' }
    const data = await get(`https://pixabay.com/api/?${qs({ key, ...params, image_type: 'photo', orientation: 'horizontal', min_width: 1920, safesearch: true, page, per_page: PER_PAGE })}`)
    return {
      items: collect(pixabay, rows(data.hits), (r) => ({
        id: r.id,
        thumb: r.webformatURL,
        url: r.fullHDURL || r.largeImageURL,
        width: r.imageWidth,
        height: r.imageHeight,
        author: r.user,
        authorUrl: r.user && Number.isInteger(r.user_id) ? `https://pixabay.com/users/${encodeURIComponent(r.user)}-${r.user_id}/` : '',
        sourceUrl: r.pageURL,
        title: r.tags,
      })),
      more: page * PER_PAGE < data.totalHits,
    }
  },
}

const wallhaven = {
  id: 'wallhaven',
  name: 'Wallhaven',
  keyEnv: 'WALLHAVEN_API_KEY',
  keyUrl: 'https://wallhaven.cc/settings/account',
  needsKey: false, // the key is optional: safe-for-work search works without one
  supportsSearch: true,
  featured: 'Top this month',
  licenseNote: 'Wallpapers are uploaded by Wallhaven members, who are not named in the API. Only safe-for-work pictures are shown.',
  rate: [45, MINUTE],
  api: ['wallhaven.cc'],
  images: ['w.wallhaven.cc', 'th.wallhaven.cc'],
  async search({ get, key }, { q, page }) {
    const data = await get(
      `https://wallhaven.cc/api/v1/search?${qs({ q, categories: '111', purity: '100', sorting: q ? 'relevance' : 'toplist', topRange: '1M', atleast: '1920x1080', page })}`,
      key ? { 'X-API-Key': key } : {},
    )
    return {
      items: collect(wallhaven, rows(data.data), (r) => ({
        id: r.id,
        thumb: r.thumbs?.large,
        url: r.path,
        width: r.dimension_x,
        height: r.dimension_y,
        color: Array.isArray(r.colors) ? r.colors[0] : '',
        sourceUrl: r.url,
      })),
      more: page < data.meta?.last_page,
    }
  },
}

const nasa = {
  id: 'nasa',
  name: 'NASA APOD',
  keyEnv: 'NASA_API_KEY',
  keyUrl: 'https://api.nasa.gov/',
  needsKey: false, // falls back to NASA's shared DEMO_KEY, which allows very few requests
  defaultKey: 'DEMO_KEY',
  supportsSearch: false,
  featured: 'Astronomy Picture of the Day',
  licenseNote: 'Images from NASA are usually free to use; some belong to their photographers, who are named here.',
  ttl: 6 * HOUR, // DEMO_KEY allows about 30 requests an hour
  rate: [30, HOUR],
  keyedRate: [1000, HOUR],
  api: ['api.nasa.gov'],
  images: ['nasa.gov'],
  async search({ get, key, now }, { page }) {
    // each page is 24 days, newest first; the first one ends "today" in NASA's own time zone
    const ago = (n) => ymd(now() - n * DAY)
    const data = await get(`https://api.nasa.gov/planetary/apod?${qs({ api_key: key, start_date: ago(23 + (page - 1) * 24), end_date: page > 1 ? ago((page - 1) * 24) : '' })}`)
    const list = rows(data).filter((r) => r.media_type === 'image').reverse()
    return {
      items: collect(nasa, list, (r) => ({
        id: r.date,
        thumb: r.url,
        url: r.hdurl || r.url,
        author: str(r.copyright, 120) || 'NASA',
        sourceUrl: typeof r.date === 'string' ? `https://apod.nasa.gov/apod/ap${r.date.slice(2).replaceAll('-', '')}.html` : '',
        title: r.title,
      })),
      more: Array.isArray(data) && data.length > 0,
    }
  },
}

const flickr = {
  id: 'flickr',
  name: 'Flickr',
  keyEnv: 'FLICKR_API_KEY',
  keyUrl: 'https://www.flickr.com/services/apps/create/apply/',
  needsKey: true,
  supportsSearch: true,
  featured: 'Interesting landscapes',
  licenseNote: 'Only Creative Commons and public-domain photos that allow commercial use. The photographer and licence are shown; follow the licence terms when you share a screenshot.',
  rate: [3600, HOUR],
  api: ['www.flickr.com'],
  images: ['staticflickr.com'],
  async search({ get, key }, { q, page }) {
    const data = await get(
      `https://www.flickr.com/services/rest/?${qs({
        method: 'flickr.photos.search',
        api_key: key,
        text: q || 'landscape',
        sort: q ? 'relevance' : 'interestingness-desc',
        license: Object.keys(FLICKR_LICENSES).join(','),
        media: 'photos',
        safe_search: 1,
        extras: 'url_k,url_h,url_l,url_c,url_z,url_m,owner_name,license',
        per_page: PER_PAGE,
        page,
        format: 'json',
        nojsoncallback: 1,
      })}`,
    )
    if (data.stat !== 'ok') throw new Upstream(data.code === 100 ? 'key' : 'shape')
    return {
      items: collect(
        flickr,
        rows(data.photos?.photo).filter((r) => Object.hasOwn(FLICKR_LICENSES, r.license)),
        (r) => {
          const s = ['k', 'h', 'l', 'c', 'z'].find((x) => r[`url_${x}`])
          const owner = encodeURIComponent(str(r.owner, 40))
          return {
            id: r.id,
            thumb: r.url_m || r.url_z,
            url: r[`url_${s}`],
            width: r[`width_${s}`],
            height: r[`height_${s}`],
            author: r.ownername,
            authorUrl: `https://www.flickr.com/people/${owner}/`,
            sourceUrl: `https://www.flickr.com/photos/${owner}/${encodeURIComponent(r.id)}`,
            title: r.title,
            license: FLICKR_LICENSES[r.license],
          }
        },
      ),
      more: data.photos?.page < data.photos?.pages,
    }
  },
}

const bing = {
  id: 'bing',
  name: 'Bing',
  keyEnv: '',
  needsKey: false,
  supportsSearch: false,
  featured: 'Image of the day',
  licenseNote: "Microsoft's daily images are meant for personal use as a wallpaper.",
  rate: [30, MINUTE], // nothing published: kept gentle
  api: ['www.bing.com'],
  images: ['bing.com'],
  async search({ get }, { page }) {
    // the archive only reaches back eight pictures (idx 0-7); asking past that gets nothing or the same ones again
    if (page > 1) return { items: [], more: false }
    const data = await get(`https://www.bing.com/HPImageArchive.aspx?${qs({ format: 'js', idx: 0, n: 8, mkt: 'en-US' })}`)
    return {
      items: collect(
        bing,
        rows(data.images).filter((r) => /^\/th\?id=OHR\.[\w.-]+$/.test(r.urlbase)),
        (r) => ({
          id: r.urlbase.slice(7),
          thumb: `https://www.bing.com${r.urlbase}_800x480.jpg`,
          url: `https://www.bing.com${r.urlbase}_1920x1080.jpg`,
          width: 1920,
          height: 1080,
          // "Matterhorn at dawn (© Jane Doe/Getty Images)"
          author: str(r.copyright).match(/\(©\s*([^)]+)\)/)?.[1],
          sourceUrl: r.copyrightlink,
          title: r.title,
        }),
      ),
      more: false,
    }
  },
}

// Commons only makes thumbnails at a fixed set of widths (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840) and
// refuses any other; this swaps the width in a thumbnail link, so only those are used here
const commonsThumb = (u, w) => (typeof u === 'string' ? u.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`) : u)

const wikimedia = {
  id: 'wikimedia',
  name: 'Wikimedia Commons',
  keyEnv: '',
  needsKey: false,
  supportsSearch: true,
  featured: 'Picture of the day',
  licenseNote: 'Free-licensed or public-domain files. The author and licence shown here are the ones to credit.',
  rate: [200, MINUTE], // "be gentle"
  api: ['en.wikipedia.org', 'commons.wikimedia.org'],
  images: ['upload.wikimedia.org'],
  async search({ get, now }, { q, page }) {
    if (q) {
      // search is limited to Commons' featured pictures, which are the ones fit for a wallpaper
      const data = await get(
        `https://commons.wikimedia.org/w/api.php?${qs({
          action: 'query',
          format: 'json',
          formatversion: 2,
          generator: 'search',
          gsrsearch: `${q} filetype:bitmap incategory:"Featured pictures on Wikimedia Commons"`,
          gsrnamespace: 6,
          gsrlimit: PER_PAGE,
          gsroffset: (page - 1) * PER_PAGE,
          prop: 'imageinfo',
          iiprop: 'url|size|extmetadata',
          iiurlwidth: 1920,
          iiextmetadatafilter: 'Artist|LicenseShortName',
        })}`,
      )
      const pages = rows(data.query?.pages).sort((a, b) => a.index - b.index)
      return {
        items: collect(wikimedia, pages, (r) => {
          const info = rows(r.imageinfo)[0] || {}
          return {
            id: r.pageid,
            thumb: commonsThumb(info.thumburl, 500),
            url: info.thumburl,
            width: info.width,
            height: info.height,
            author: plain(info.extmetadata?.Artist?.value),
            sourceUrl: info.descriptionurl,
            title: str(r.title).replace(/^File:|\.\w+$/g, ''),
            license: plain(info.extmetadata?.LicenseShortName?.value),
          }
        }),
        more: isObj(data.continue),
      }
    }
    // the featured feed carries one picture of the day per date; a page is 8 days
    const days = Array.from({ length: 8 }, (_, i) => ymd(now() - ((page - 1) * 8 + i) * DAY))
    const feeds = await Promise.allSettled(days.map((d) => get(`https://en.wikipedia.org/api/rest_v1/feed/featured/${d.replaceAll('-', '/')}`)))
    if (feeds.every((f) => f.status === 'rejected')) throw feeds[0].reason
    const daily = feeds.flatMap((f, i) => (f.status === 'fulfilled' && isObj(f.value?.image) ? [{ date: days[i], image: f.value.image }] : []))
    return {
      items: collect(wikimedia, daily, ({ date, image: r }) => ({
        id: `potd-${date}`,
        thumb: r.thumbnail?.source,
        url: r.image?.width > 1920 ? commonsThumb(r.thumbnail?.source, 1920) : r.image?.source,
        width: r.image?.width,
        height: r.image?.height,
        author: plain(r.artist?.text),
        sourceUrl: r.file_page,
        title: r.description?.text,
        license: r.license?.type,
      })),
      more: true,
    }
  },
}

const aic = {
  id: 'aic',
  name: 'Art Institute of Chicago',
  keyEnv: '',
  needsKey: false,
  supportsSearch: true,
  featured: 'Public-domain artworks',
  licenseNote: "Public-domain artworks from the museum's open collection (CC0).",
  rate: [60, MINUTE],
  api: ['api.artic.edu'],
  images: ['www.artic.edu'],
  async search({ get }, { q, page }) {
    const data = await get(
      `https://api.artic.edu/api/v1/artworks/search?${qs({ q, 'query[term][is_public_domain]': true, fields: 'id,title,image_id,artist_display,thumbnail', limit: PER_PAGE, page })}`,
    )
    return {
      items: collect(
        aic,
        rows(data.data).filter((r) => /^[\w-]{8,64}$/.test(r.image_id)),
        (r) => ({
          id: r.id,
          thumb: `https://www.artic.edu/iiif/2/${r.image_id}/full/400,/0/default.jpg`,
          // 843px is the width the museum's image API documents for showing a picture
          url: `https://www.artic.edu/iiif/2/${r.image_id}/full/843,/0/default.jpg`,
          width: r.thumbnail?.width,
          height: r.thumbnail?.height,
          author: String(r.artist_display ?? '').split('\n')[0],
          sourceUrl: Number.isInteger(r.id) ? `https://www.artic.edu/artworks/${r.id}` : '',
          title: r.title,
          license: 'CC0',
        }),
      ),
      more: page < data.pagination?.total_pages,
    }
  },
}

const met = {
  id: 'met',
  name: 'The Met',
  keyEnv: '',
  needsKey: false,
  supportsSearch: true,
  featured: 'Highlights, public domain',
  licenseNote: "Public-domain works from The Metropolitan Museum of Art's Open Access collection (CC0).",
  rate: [80, SECOND],
  api: ['collectionapi.metmuseum.org'],
  images: ['images.metmuseum.org'],
  async search({ get }, { q, page }) {
    // the search answers with ids only, so each page costs one request per picture
    const base = 'https://collectionapi.metmuseum.org/public/collection/v1'
    const found = await get(`${base}/search?${qs({ q: q || 'landscape', hasImages: true, isPublicDomain: true, isHighlight: q ? '' : true })}`)
    const ids = Array.isArray(found.objectIDs) ? found.objectIDs.filter(Number.isInteger) : []
    const objects = await Promise.allSettled(ids.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((id) => get(`${base}/objects/${id}`)))
    if (objects.length && objects.every((o) => o.status === 'rejected')) throw objects[0].reason
    return {
      items: collect(
        met,
        objects.flatMap((o) => (o.status === 'fulfilled' && isObj(o.value) && o.value.isPublicDomain ? [o.value] : [])),
        (r) => ({
          id: r.objectID,
          thumb: r.primaryImageSmall,
          url: r.primaryImage,
          author: r.artistDisplayName || r.culture || 'The Metropolitan Museum of Art',
          sourceUrl: r.objectURL,
          title: r.title,
          license: 'CC0',
        }),
      ),
      more: ids.length > page * PER_PAGE,
    }
  },
}

const picsum = {
  id: 'picsum',
  name: 'Lorem Picsum',
  keyEnv: '',
  needsKey: false,
  supportsSearch: false,
  featured: 'Random photos',
  licenseNote: 'Photos from Unsplash, served by Lorem Picsum. The photographer is credited here.',
  rate: [60, MINUTE], // nothing published: kept gentle
  api: ['picsum.photos'],
  images: ['picsum.photos'],
  async search({ get }, { page }) {
    const list = rows(await get(`https://picsum.photos/v2/list?${qs({ page, limit: PER_PAGE })}`)).filter((r) => /^\d{1,6}$/.test(r.id))
    return {
      items: collect(picsum, list, (r) => ({
        id: r.id,
        thumb: `https://picsum.photos/id/${r.id}/480/270`,
        url: `https://picsum.photos/id/${r.id}/2560/1440`,
        width: 2560,
        height: 1440,
        author: r.author,
        sourceUrl: r.url,
      })),
      more: list.length === PER_PAGE,
    }
  },
}

const PROVIDERS = [unsplash, pexels, pixabay, wallhaven, nasa, flickr, bing, wikimedia, aic, met, picsum]

// ---------- talking to them ----------

const SAID = {
  timeout: 'took too long to answer',
  network: "couldn't be reached",
  status: "isn't answering right now",
  limit: 'has reached its request limit — try again later',
}

async function readLimited(res) {
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Upstream('big')
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => {})
      throw new Upstream('big')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function createClient(fetchFn, userAgent) {
  return async function get(url, { headers, hosts }) {
    const u = new URL(url)
    if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) throw new WallpaperError(500, 'Blocked request')
    let res
    try {
      res = await fetchFn(u.href, { headers: { 'user-agent': userAgent, accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      throw new Upstream(e?.name === 'TimeoutError' ? 'timeout' : 'network')
    }
    if (!res.ok) throw new Upstream(res.status === 401 || res.status === 403 ? 'key' : res.status === 429 ? 'limit' : 'status', res.status)
    try {
      const data = JSON.parse(await readLimited(res))
      if (data === null || typeof data !== 'object') throw new Upstream('shape')
      return data
    } catch (e) {
      throw e instanceof Upstream ? e : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? new Upstream('timeout') : new Upstream('shape')
    }
  }
}

// Lets `count` requests through per `per` ms, refilled steadily: a provider's published limit, kept to here
// so that the people using this server cannot spend it, or push past it, between them.
function tokenBucket([count, per], now) {
  let tokens = count
  let at = now()
  return () => {
    const t = now()
    tokens = Math.min(count, tokens + ((t - at) * count) / per)
    at = t
    if (tokens < 1) return false
    tokens--
    return true
  }
}

// Runs jobs with at most `max` going at once; the rest wait their turn, up to `queued` of them.
function gate(max, queued) {
  let active = 0
  const waiting = []
  return async (job) => {
    if (active >= max) {
      if (waiting.length >= queued) throw new Upstream('limit')
      await new Promise((go) => waiting.push(go)) // a finished job hands its place over
    } else active++
    try {
      return await job()
    } finally {
      if (waiting.length) waiting.shift()()
      else active--
    }
  }
}

// The latest `max` keys; the oldest is forgotten first.
function latest(max) {
  const keys = new Set()
  return {
    has: (k) => keys.has(k),
    delete: (k) => keys.delete(k),
    add(k) {
      keys.delete(k)
      keys.add(k)
      if (keys.size > max) keys.delete(keys.values().next().value)
    },
  }
}

export function createWallpapers({ fetch: fetchFn = globalThis.fetch, env = process.env, appName = 'Obi', now = Date.now } = {}) {
  const client = createClient(fetchFn, `${appName}/1.0 (background images; self-hosted)`)
  const cache = new Map()
  const buckets = new Map()
  const inFlight = gate(MAX_CONCURRENT, MAX_QUEUED)
  const offered = latest(REMEMBERED) // `provider:id` of the pictures this server has sent out
  const counted = latest(REMEMBERED) // `user|provider:id` of the pictures already reported to the provider

  const find = (id) => {
    const p = PROVIDERS.find((x) => x.id === id)
    if (!p) throw new WallpaperError(404, 'Unknown background source')
    return p
  }
  // the key an admin set, if any; `defaultKey` is what a provider falls back to
  const own = (p) => (p.keyEnv ? String(env[p.keyEnv] || '').trim() : '')
  const ready = (p) => {
    if (p.needsKey && !own(p)) throw new WallpaperError(503, `${p.name} isn't configured on this server — set ${p.keyEnv}`)
    return p
  }

  // every request to a provider spends from that provider's bucket and takes a turn at the shared limit
  const rateOf = (p) => {
    const perHour = p.rateEnv ? Math.floor(Number(env[p.rateEnv])) : 0
    return perHour > 0 ? [perHour, p.rate[1]] : (own(p) && p.keyedRate) || p.rate
  }
  const upstream = (p, run) => {
    if (!buckets.has(p.id)) buckets.set(p.id, tokenBucket(rateOf(p), now))
    return buckets.get(p.id)() ? inFlight(run) : Promise.reject(new Upstream('limit'))
  }

  async function call(p, fn) {
    try {
      return await fn({ get: (url, headers) => upstream(p, () => client(url, { headers, hosts: p.api })), key: own(p) || p.defaultKey || '', appName, now })
    } catch (e) {
      if (e instanceof WallpaperError) throw e
      const kind = e instanceof Upstream ? e.kind : 'shape'
      console.warn('[wallpapers]', p.id, e.status ? `HTTP ${e.status}` : kind === 'shape' ? e.message : kind)
      if (kind === 'key' && own(p)) throw new WallpaperError(502, `${p.name} rejected the API key set on this server (${p.keyEnv})`)
      throw new WallpaperError(kind === 'limit' ? 429 : 502, `${p.name} ${SAID[kind === 'key' ? 'status' : kind] || 'sent something unexpected'}`)
    }
  }

  async function onePage(p, q, page) {
    const slot = `${p.id}|${q}|${page}`
    const hit = cache.get(slot)
    if (hit && hit.until > now()) return hit.result
    const found = await call(p, (ctx) => p.search(ctx, { q, page }))
    const result = { providerName: p.name, items: found.items, more: !!found.more && page < MAX_PAGES }
    cache.delete(slot)
    cache.set(slot, { result, until: now() + (p.ttl || CACHE_MS) })
    if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value)
    return result
  }

  return {
    providers: () =>
      PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        available: !p.needsKey || !!own(p),
        needsKey: p.needsKey,
        keyEnv: p.keyEnv,
        keyUrl: p.keyUrl || '',
        supportsSearch: p.supportsSearch,
        featured: p.featured,
        licenseNote: p.licenseNote,
      })),

    // `page` in the answer is the page the pictures came from: one with none on it, where more follow, is passed over
    async search(id, q, page) {
      const p = ready(find(id))
      q = p.supportsSearch ? q : ''
      let at = page
      let found = await onePage(p, q, at)
      for (let skipped = 0; !found.items.length && found.more && skipped < MAX_SKIPPED; skipped++) found = await onePage(p, q, ++at)
      if (p.track) for (const item of found.items) offered.add(`${p.id}:${item.id}`)
      return { ...found, page: at }
    },

    // a picture was chosen: providers that want to hear about it are told, once for each person and picture,
    // and only about pictures this server has offered
    async track(id, photoId, who = '') {
      const p = ready(find(id))
      if (!p.track) return
      const key = `${p.id}:${photoId}`
      if (!offered.has(key)) throw new WallpaperError(404, 'That picture was not offered by this server')
      const once = `${who}|${key}`
      if (counted.has(once)) return
      counted.add(once)
      try {
        await call(p, (ctx) => p.track(ctx, photoId))
      } catch (e) {
        counted.delete(once)
        throw e
      }
    },
  }
}
