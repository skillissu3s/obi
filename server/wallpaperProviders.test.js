import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createWallpapers, WallpaperError } from './wallpaperProviders.js'

mock.method(console, 'warn', () => {})

const NOW = Date.UTC(2026, 9, 3, 12)
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// a provider whose answers the test writes; every request is recorded
function setup(answer, env = {}) {
  const calls = []
  const fetch = async (href, init) => {
    const url = new URL(href)
    calls.push({ url, init })
    return answer(url, init)
  }
  let now = NOW
  const w = createWallpapers({ fetch, env, appName: 'Obi', now: () => now })
  return { w, calls, advance: (ms) => (now += ms) }
}

const rejects = (promise, status, message) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof WallpaperError)
    assert.equal(e.status, status)
    if (message) assert.match(e.message, message)
    return true
  })

test('providers: keyed sources stay unavailable until their key is set, and no key is ever listed', async () => {
  const secret = 'sekrit-key-value'
  const { w } = setup(() => json({}), { UNSPLASH_ACCESS_KEY: secret })
  const list = w.providers()
  const byId = Object.fromEntries(list.map((p) => [p.id, p]))
  assert.equal(byId.unsplash.available, true)
  assert.equal(byId.pexels.available, false)
  assert.equal(byId.pexels.needsKey, true)
  assert.equal(byId.pexels.keyEnv, 'PEXELS_API_KEY')
  for (const id of ['bing', 'wikimedia', 'aic', 'met', 'picsum', 'nasa', 'wallhaven']) assert.equal(byId[id].available, true, id)
  for (const id of ['unsplash', 'pexels', 'pixabay', 'flickr']) assert.equal(byId[id].needsKey, true, id)
  assert.ok(!JSON.stringify(list).includes(secret))
})

test('a source without its key says which variable to set', async () => {
  const { w, calls } = setup(() => json({}))
  await rejects(w.search('unsplash', '', 1), 503, /Unsplash isn't configured on this server — set UNSPLASH_ACCESS_KEY/)
  await rejects(w.search('nope', '', 1), 404)
  assert.equal(calls.length, 0)
})

const unsplashPhoto = {
  id: 'Dwu85P9SOIk',
  width: 5472,
  height: 3648,
  color: '#0C2840',
  description: 'A lake at dawn',
  alt_description: null,
  urls: {
    raw: 'https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.0.3',
    full: 'https://images.unsplash.com/photo-1?ixid=abc&q=85&fm=jpg',
    small: 'https://images.unsplash.com/photo-1?ixid=abc&w=400',
  },
  links: { html: 'https://unsplash.com/photos/Dwu85P9SOIk', download_location: 'https://api.unsplash.com/photos/Dwu85P9SOIk/download?ixid=abc' },
  user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } },
}

test('unsplash: editorial list, search, attribution links and the download ping', async () => {
  const { w, calls } = setup((url) => (url.pathname === '/search/photos' ? json({ total: 60, total_pages: 3, results: [unsplashPhoto] }) : url.pathname.endsWith('/download') ? json({ url: 'https://x' }) : json([unsplashPhoto])), { UNSPLASH_ACCESS_KEY: 'k1' })

  const featured = await w.search('unsplash', '', 1)
  assert.equal(calls[0].url.pathname, '/photos')
  assert.equal(calls[0].url.searchParams.get('order_by'), 'popular')
  assert.equal(calls[0].init.headers.Authorization, 'Client-ID k1')
  assert.ok(!calls[0].url.href.includes('k1'), 'the key travels in a header, not the URL')
  assert.equal(calls[0].init.redirect, 'error')
  assert.deepEqual(featured.items[0], {
    id: 'Dwu85P9SOIk',
    provider: 'unsplash',
    thumb: 'https://images.unsplash.com/photo-1?ixid=abc&w=400',
    url: 'https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.0.3&w=2560&q=80&fm=jpg&fit=max',
    width: 5472,
    height: 3648,
    color: '#0c2840',
    author: 'Jane Doe',
    authorUrl: 'https://unsplash.com/@jane?utm_source=Obi&utm_medium=referral',
    sourceUrl: 'https://unsplash.com/photos/Dwu85P9SOIk?utm_source=Obi&utm_medium=referral',
    title: 'A lake at dawn',
  })
  assert.equal(featured.more, false) // a short page: nothing after it

  const found = await w.search('unsplash', 'lake', 2)
  assert.equal(calls[1].url.pathname, '/search/photos')
  assert.equal(calls[1].url.searchParams.get('query'), 'lake')
  assert.equal(calls[1].url.searchParams.get('orientation'), 'landscape')
  assert.equal(found.more, true)

  await w.track('unsplash', 'Dwu85P9SOIk')
  assert.equal(calls.at(-1).url.pathname, '/photos/Dwu85P9SOIk/download')
  await rejects(w.track('unsplash', '../../me'), 404)
})

test('pexels: curated and search, key sent bare in Authorization', async () => {
  const photo = {
    id: 2014422,
    width: 3024,
    height: 3024,
    url: 'https://www.pexels.com/photo/brown-rocks-2014422/',
    photographer: 'Joey Farina',
    photographer_url: 'https://www.pexels.com/@joey',
    avg_color: '#978E82',
    alt: 'Brown rocks',
    src: { original: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg', medium: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&h=350' },
  }
  const { w, calls } = setup(() => json({ page: 1, per_page: 24, photos: [photo], next_page: 'https://api.pexels.com/v1/curated/?page=2' }), { PEXELS_API_KEY: 'pk' })
  const r = await w.search('pexels', '', 1)
  assert.equal(calls[0].url.pathname, '/v1/curated')
  assert.equal(calls[0].init.headers.Authorization, 'pk')
  assert.equal(r.more, true)
  assert.equal(r.items[0].id, '2014422')
  assert.equal(r.items[0].url, 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&w=2560')
  assert.equal(r.items[0].author, 'Joey Farina')
  assert.equal(r.items[0].color, '#978e82')
  await w.search('pexels', 'rocks', 1)
  assert.equal(calls[1].url.pathname, '/v1/search')
  assert.equal(calls[1].url.searchParams.get('query'), 'rocks')
})

test('pixabay: key in the query, full-HD link when offered, paging from totalHits', async () => {
  const hit = {
    id: 195893,
    pageURL: 'https://pixabay.com/photos/blossom-bloom-flower-195893/',
    tags: 'blossom, bloom, flower',
    webformatURL: 'https://pixabay.com/get/g1_640.jpg',
    largeImageURL: 'https://pixabay.com/get/g1_1280.jpg',
    imageWidth: 4000,
    imageHeight: 2250,
    user: 'Josch13',
    user_id: 1664300,
  }
  const { w, calls } = setup(() => json({ total: 500, totalHits: 100, hits: [hit] }), { PIXABAY_API_KEY: 'px' })
  const r = await w.search('pixabay', '', 1)
  assert.equal(calls[0].url.searchParams.get('key'), 'px')
  assert.equal(calls[0].url.searchParams.get('editors_choice'), 'true')
  assert.equal(calls[0].url.searchParams.get('safesearch'), 'true')
  assert.equal(r.items[0].url, 'https://pixabay.com/get/g1_1280.jpg')
  assert.equal(r.items[0].authorUrl, 'https://pixabay.com/users/Josch13-1664300/')
  assert.equal(r.items[0].title, 'blossom, bloom, flower')
  assert.equal(r.more, true)
  assert.equal((await w.search('pixabay', 'flower', 5)).more, false) // 5 × 24 ≥ 100
})

test('wallhaven: always safe for work, key optional', async () => {
  const body = {
    data: [{ id: '94x38z', url: 'https://wallhaven.cc/w/94x38z', path: 'https://w.wallhaven.cc/full/94/wallhaven-94x38z.jpg', dimension_x: 6742, dimension_y: 3534, colors: ['#000000', '#abbcda'], thumbs: { large: 'https://th.wallhaven.cc/lg/94/94x38z.jpg' } }],
    meta: { current_page: 1, last_page: 3 },
  }
  const { w, calls } = setup(() => json(body))
  const r = await w.search('wallhaven', 'city', 1)
  assert.equal(calls[0].url.searchParams.get('purity'), '100')
  assert.equal(calls[0].init.headers['X-API-Key'], undefined)
  assert.equal(r.items[0].url, 'https://w.wallhaven.cc/full/94/wallhaven-94x38z.jpg')
  assert.equal(r.items[0].author, '')
  assert.equal(r.more, true)
  const keyed = setup(() => json(body), { WALLHAVEN_API_KEY: 'wk' })
  await keyed.w.search('wallhaven', '', 1)
  assert.equal(keyed.calls[0].init.headers['X-API-Key'], 'wk')
  assert.equal(keyed.calls[0].url.searchParams.get('purity'), '100')
  assert.ok(!keyed.calls[0].url.href.includes('wk'))
})

test('nasa: DEMO_KEY by default, images only, newest first, 24-day pages', async () => {
  const day = (date, extra) => ({ date, title: `APOD ${date}`, url: `https://apod.nasa.gov/apod/image/${date}.jpg`, media_type: 'image', ...extra })
  const { w, calls } = setup(() => json([day('2026-09-10'), day('2026-09-11', { media_type: 'video', url: 'https://www.youtube.com/embed/x' }), day('2026-09-12', { hdurl: 'https://apod.nasa.gov/apod/image/hd.jpg', copyright: '\nAnn  Lee\n' })]))
  const r = await w.search('nasa', 'ignored', 1)
  assert.equal(calls[0].url.searchParams.get('api_key'), 'DEMO_KEY')
  assert.equal(calls[0].url.searchParams.get('start_date'), '2026-09-10')
  assert.equal(calls[0].url.searchParams.get('end_date'), null)
  assert.equal(calls[0].url.searchParams.get('q'), null)
  assert.deepEqual(r.items.map((i) => i.id), ['2026-09-12', '2026-09-10'])
  assert.equal(r.items[0].url, 'https://apod.nasa.gov/apod/image/hd.jpg')
  assert.equal(r.items[0].author, 'Ann Lee')
  assert.equal(r.items[1].author, 'NASA')
  assert.equal(r.items[1].sourceUrl, 'https://apod.nasa.gov/apod/ap260910.html')
  await w.search('nasa', '', 2)
  assert.equal(calls[1].url.searchParams.get('start_date'), '2026-08-17')
  assert.equal(calls[1].url.searchParams.get('end_date'), '2026-09-09')
})

test('flickr: only commercial-use licences, and a rejected key is named', async () => {
  const photo = (id, license) => ({ id, owner: '12345678@N00', ownername: 'Sam', title: `Photo ${id}`, license, url_m: `https://live.staticflickr.com/1/${id}_m.jpg`, url_k: `https://live.staticflickr.com/1/${id}_k.jpg`, width_k: 2048, height_k: 1365 })
  const { w, calls } = setup(() => json({ stat: 'ok', photos: { page: 1, pages: 4, photo: [photo('1', '4'), photo('2', '0'), photo('3', '9'), photo('4', 'constructor')] } }), { FLICKR_API_KEY: 'fk' })
  const r = await w.search('flickr', 'alps', 1)
  assert.equal(calls[0].url.searchParams.get('license'), '4,5,7,8,9,10')
  assert.equal(calls[0].url.searchParams.get('api_key'), 'fk')
  assert.deepEqual(r.items.map((i) => [i.id, i.license]), [['1', 'CC BY 2.0'], ['3', 'CC0 1.0']])
  assert.equal(r.items[0].authorUrl, 'https://www.flickr.com/people/12345678%40N00/')
  assert.equal(r.items[0].width, 2048)
  assert.equal(r.more, true)
  const bad = setup(() => json({ stat: 'fail', code: 100, message: 'Invalid API Key (Key has invalid format)' }), { FLICKR_API_KEY: 'fk' })
  await rejects(bad.w.search('flickr', '', 1), 502, /rejected the API key set on this server \(FLICKR_API_KEY\)/)
})

test('bing: image of the day; the archive holds one page of eight', async () => {
  const { w, calls } = setup(() =>
    json({ images: [{ urlbase: '/th?id=OHR.Matterhorn_EN-US1234', title: 'Dawn', copyright: 'Matterhorn at dawn, Zermatt (© Jane Doe/Getty Images)', copyrightlink: 'https://www.bing.com/search?q=matterhorn', startdate: '20261003' }, { urlbase: 'https://evil.example/x' }] }),
  )
  const r = await w.search('bing', '', 1)
  assert.equal(calls[0].url.searchParams.get('n'), '8')
  assert.equal(calls[0].url.searchParams.get('idx'), '0')
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].id, 'OHR.Matterhorn_EN-US1234')
  assert.equal(r.items[0].url, 'https://www.bing.com/th?id=OHR.Matterhorn_EN-US1234_1920x1080.jpg')
  assert.equal(r.items[0].author, 'Jane Doe/Getty Images')
  assert.equal(r.more, false) // idx 8 and up would return nothing, or the same pictures again
  const later = await w.search('bing', '', 2)
  assert.deepEqual(later, { providerName: 'Bing', items: [], more: false, page: 2 })
  assert.equal(calls.length, 1)
})

test('wikimedia: picture of the day per date, search limited to featured pictures', async () => {
  const feed = (date) => ({
    image: {
      title: `File:${date}.jpg`,
      thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${date}.jpg/640px-${date}.jpg`, width: 640, height: 427 },
      image: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${date}.jpg`, width: 6000, height: 4000 },
      file_page: `https://commons.wikimedia.org/wiki/File:${date}.jpg`,
      artist: { text: 'Some Author' },
      license: { type: 'CC BY-SA 4.0' },
      description: { text: 'A fine view' },
    },
  })
  const { w, calls } = setup((url) => {
    if (url.hostname === 'en.wikipedia.org') return url.pathname.endsWith('/2026/10/02') ? json({}, 404) : json(feed(url.pathname.slice(-10).replaceAll('/', '-')))
    return json({
      query: { pages: [{ pageid: 9, index: 2, title: 'File:Second.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1/Second.jpg/1920px-Second.jpg', width: 4000, height: 3000, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Second.jpg', extmetadata: { Artist: { value: '<a href="//x">Ann &amp; Bo</a>' }, LicenseShortName: { value: 'CC0' } } }] }, { pageid: 8, index: 1, title: 'File:First.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2/First.jpg/1920px-First.jpg', width: 4000, height: 3000 }] }] },
      continue: { gsroffset: 24 },
    })
  })
  const daily = await w.search('wikimedia', '', 1)
  assert.equal(calls.length, 8)
  assert.equal(calls[0].url.pathname, '/api/rest_v1/feed/featured/2026/10/03')
  assert.equal(daily.items.length, 7) // the day that failed is skipped
  assert.equal(daily.items[0].id, 'potd-2026-10-03')
  assert.equal(daily.items[0].url, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/2026-10-03.jpg/1920px-2026-10-03.jpg')
  assert.equal(daily.items[0].license, 'CC BY-SA 4.0')

  const found = await w.search('wikimedia', 'alps', 1)
  const search = calls.at(-1).url.searchParams
  assert.equal(search.get('gsrsearch'), 'alps filetype:bitmap incategory:"Featured pictures on Wikimedia Commons"')
  assert.deepEqual(found.items.map((i) => i.title), ['First', 'Second'])
  assert.equal(found.items[1].author, 'Ann & Bo')
  assert.equal(found.items[1].thumb, 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1/Second.jpg/500px-Second.jpg')
  assert.equal(found.more, true)
})

test('art institute: public domain only, IIIF links, artworks without an image skipped', async () => {
  const { w, calls } = setup(() =>
    json({
      pagination: { current_page: 1, total_pages: 2 },
      data: [
        { id: 27992, title: 'A Sunday on La Grande Jatte', image_id: '2d484387-2509-5e8e-2c43-22f9981972eb', artist_display: 'Georges Seurat\nFrench, 1859-1891', thumbnail: { width: 5026, height: 3394 } },
        { id: 1, title: 'No picture', image_id: null },
      ],
    }),
  )
  const r = await w.search('aic', 'seurat', 1)
  assert.equal(calls[0].url.searchParams.get('query[term][is_public_domain]'), 'true')
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].url, 'https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg')
  assert.equal(r.items[0].author, 'Georges Seurat')
  assert.equal(r.items[0].sourceUrl, 'https://www.artic.edu/artworks/27992')
  assert.equal(r.more, true)
})

test('the met: ids first, then each public-domain object', async () => {
  const object = (id, extra) => ({ objectID: id, isPublicDomain: true, primaryImage: `https://images.metmuseum.org/CRDImages/ep/original/${id}.jpg`, primaryImageSmall: `https://images.metmuseum.org/CRDImages/ep/web-large/${id}.jpg`, title: `Work ${id}`, artistDisplayName: 'Vincent van Gogh', objectURL: `https://www.metmuseum.org/art/collection/search/${id}`, ...extra })
  const { w, calls } = setup((url) => (url.pathname.endsWith('/search') ? json({ total: 3, objectIDs: [11, 12, 13] }) : json(object(Number(url.pathname.split('/').pop()), url.pathname.endsWith('/12') ? { isPublicDomain: false } : {}))))
  const r = await w.search('met', '', 1)
  assert.equal(calls[0].url.searchParams.get('isHighlight'), 'true')
  assert.equal(calls[0].url.searchParams.get('isPublicDomain'), 'true')
  assert.deepEqual(r.items.map((i) => i.id), ['11', '13'])
  assert.equal(r.items[0].author, 'Vincent van Gogh')
  assert.equal(r.more, false)
})

test('picsum: no key, no search', async () => {
  const { w, calls } = setup(() => json([{ id: '10', author: 'Paul Jarvis', width: 2500, height: 1667, url: 'https://unsplash.com/photos/6J--NXulQCs', download_url: 'https://picsum.photos/id/10/2500/1667' }]))
  const r = await w.search('picsum', 'ignored', 1)
  assert.equal(calls[0].url.searchParams.get('q'), null)
  assert.equal(r.items[0].url, 'https://picsum.photos/id/10/2560/1440')
  assert.equal(r.items[0].author, 'Paul Jarvis')
})

test('anything a provider sends is checked before it is passed on', async () => {
  const odd = [
    { ...unsplashPhoto, id: 'bad id!' },
    { ...unsplashPhoto, id: 'offsite', urls: { ...unsplashPhoto.urls, raw: 'https://evil.example/pixel.png' } },
    { ...unsplashPhoto, id: 'script', user: { name: 'x'.repeat(500), links: { html: 'javascript:alert(1)' } }, links: { html: 'http://unsplash.com/photos/x' } },
    { ...unsplashPhoto, id: 'port', urls: { ...unsplashPhoto.urls, raw: 'https://images.unsplash.com:8443/photo' } },
    null,
    'text',
  ]
  const { w } = setup(() => json(odd), { UNSPLASH_ACCESS_KEY: 'k' })
  const r = await w.search('unsplash', '', 1)
  assert.deepEqual(r.items.map((i) => i.id), ['script'])
  assert.equal(r.items[0].author.length, 120)
  assert.equal(r.items[0].authorUrl, '')
  assert.equal(r.items[0].sourceUrl, 'https://unsplash.com/photos/x?utm_source=Obi&utm_medium=referral') // http is upgraded
})

test('failures become plain messages that never carry the key', async () => {
  const key = 'topsecretkeyvalue'
  const env = { PEXELS_API_KEY: key }
  const messages = []
  const attempt = async (answer, ...expected) => {
    const { w } = setup(answer, env)
    await rejects(w.search('pexels', '', 1), ...expected)
    await w.search('pexels', '', 1).catch((e) => messages.push(e.message))
  }
  await attempt(() => json({}, 401), 502, /rejected the API key set on this server \(PEXELS_API_KEY\)/)
  await attempt(() => json({}, 429), 429, /request limit/)
  await attempt(() => json({}, 500), 502, /isn't answering/)
  await attempt(() => new Response('<html>nope</html>', { status: 200 }), 502, /sent something unexpected/)
  await attempt(() => json(null), 502, /sent something unexpected/)
  await attempt(() => json('a string'), 502, /sent something unexpected/)
  await attempt(() => new Response('x'.repeat(3 * 1024 * 1024), { status: 200 }), 502, /sent something unexpected/)
  await attempt(() => Promise.reject(Object.assign(new Error(`aborted ${key}`), { name: 'TimeoutError' })), 502, /took too long/)
  await attempt(() => Promise.reject(new TypeError(`fetch failed for ${key}`)), 502, /couldn't be reached/)
  for (const m of messages) assert.ok(!m.includes(key), m)
})

test('results are cached for a while, then fetched again', async () => {
  const { w, calls, advance } = setup(() => json([{ id: '1', author: 'A', url: 'https://x' }]))
  await w.search('picsum', '', 1)
  await w.search('picsum', '', 1)
  assert.equal(calls.length, 1)
  await w.search('picsum', '', 2)
  assert.equal(calls.length, 2)
  advance(16 * 60 * 1000)
  await w.search('picsum', '', 1)
  assert.equal(calls.length, 3)
})

// ---------- an empty page does not stall the grid ----------

// a Met whose first pages hold only objects that are not usable (not public domain, or gone)
const metWith = (usable) => {
  const ids = Array.from({ length: 24 * 6 }, (_, i) => 1000 + i)
  return setup((url) => {
    if (url.pathname.endsWith('/search')) return json({ total: ids.length, objectIDs: ids })
    const id = Number(url.pathname.split('/').pop())
    return json({ objectID: id, isPublicDomain: usable(id), primaryImage: `https://images.metmuseum.org/CRDImages/ep/original/${id}.jpg`, primaryImageSmall: `https://images.metmuseum.org/CRDImages/ep/web-large/${id}.jpg`, title: `Work ${id}` })
  })
}

test('a page with nothing usable on it, where more follow, is skipped and the answer says which page it came from', async () => {
  const { w } = metWith((id) => id >= 1000 + 24) // everything on page 1 is unusable
  const r = await w.search('met', '', 1)
  assert.equal(r.page, 2)
  assert.equal(r.items.length, 24)
  assert.equal(r.more, true)
  // asking for the page after the one it reported goes on from there, without repeating
  const next = await w.search('met', '', r.page + 1)
  assert.equal(next.page, 3)
  assert.ok(!next.items.some((i) => r.items.some((j) => j.id === i.id)))
})

test('skipping empty pages is capped: a long run of them is handed back as an empty page with more to come', async () => {
  const { w, calls } = metWith(() => false)
  const r = await w.search('met', '', 1)
  assert.deepEqual([r.items.length, r.page, r.more], [0, 3, true]) // the page asked for and two more
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/search')).length, 3)
  const last = await w.search('met', '', 6) // the last page: nothing follows, so nothing more is looked at
  assert.deepEqual([last.items.length, last.page, last.more], [0, 6, false])
})

test('a page that does have pictures is passed on as asked for', async () => {
  const { w } = metWith(() => true)
  const r = await w.search('met', '', 2)
  assert.equal(r.page, 2)
  assert.equal(r.items.length, 24)
})

// ---------- what this server spends of a provider's limits ----------

test('each source is held to its own published limit, however many people ask, and recovers with time', async () => {
  const { w, calls, advance } = setup(() => json({ hits: [], totalHits: 0 }), { PIXABAY_API_KEY: 'px' })
  for (let i = 0; i < 100; i++) await w.search('pixabay', `word${i}`, 1) // 100 requests a minute
  assert.equal(calls.length, 100)
  await rejects(w.search('pixabay', 'one more', 1), 429, /request limit/)
  assert.equal(calls.length, 100, 'the provider is not asked at all')
  // other sources are not affected
  await w.search('picsum', '', 1)
  advance(30 * 1000) // half a minute earns half the limit back
  for (let i = 0; i < 50; i++) await w.search('pixabay', `later${i}`, 1)
  await rejects(w.search('pixabay', 'again', 1), 429)
  assert.equal(calls.filter((c) => c.url.hostname === 'pixabay.com').length, 150)
})

test('a limit that depends on the key: NASA with its own key, Unsplash once approved', async () => {
  const none = () => json([])
  const demo = setup(none)
  for (let i = 1; i <= 30; i++) await demo.w.search('nasa', '', i)
  await rejects(demo.w.search('nasa', '', 31), 429)
  const keyed = setup(none, { NASA_API_KEY: 'k' })
  for (let i = 1; i <= 50; i++) await keyed.w.search('nasa', '', i) // a free key allows 1,000 an hour
  assert.equal(keyed.calls.length, 50)

  const few = setup(none, { UNSPLASH_ACCESS_KEY: 'k' })
  for (let i = 1; i <= 50; i++) await few.w.search('unsplash', '', i)
  await rejects(few.w.search('unsplash', 'x', 1), 429)
  const approved = setup(none, { UNSPLASH_ACCESS_KEY: 'k', UNSPLASH_REQUESTS_PER_HOUR: '5000' })
  for (let i = 1; i <= 50; i++) await approved.w.search('unsplash', '', i)
  await approved.w.search('unsplash', 'x', 1)
  assert.equal(approved.calls.length, 51)
})

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

test('only a few requests go to providers at once, the rest wait their turn and all are answered', async () => {
  let active = 0
  let peak = 0
  const releases = []
  const { w, calls } = setup(
    () =>
      new Promise((resolve) => {
        active++
        peak = Math.max(peak, active)
        releases.push(() => {
          active--
          resolve(json([{ id: '1', author: 'A', url: 'https://x' }]))
        })
      }),
  )
  const searches = Array.from({ length: 20 }, (_, i) => w.search('picsum', '', i + 1))
  await tick()
  assert.equal(calls.length, 6, 'six in flight, fourteen waiting')
  while (releases.length) {
    releases.shift()()
    await tick(1)
  }
  const answers = await Promise.all(searches)
  assert.equal(answers.length, 20)
  assert.ok(peak <= 6, `at most six at once, saw ${peak}`)
  assert.equal(calls.length, 20)
})

test('so many waiting that the queue is full is answered with "slow down" rather than piling up', async () => {
  const releases = []
  const { w } = setup(() => new Promise((resolve) => releases.push(() => resolve(json([])))))
  // picsum is held to 60 requests a minute: 55 distinct pages of it stay under that, and over 6 + 48 at once
  const searches = Array.from({ length: 6 + 48 + 1 }, (_, i) => w.search('picsum', '', i + 1).catch((e) => e))
  await tick()
  const last = await Promise.race([searches[54], tick(50).then(() => 'still waiting')])
  assert.ok(last instanceof WallpaperError && last.status === 429, String(last))
  while (releases.length) {
    releases.shift()()
    await tick(1)
  }
  await Promise.all(searches)
})

// ---------- telling Unsplash about a picture ----------

test('a picture is only reported if this server offered it, and once for each person', async () => {
  const { w, calls } = setup((url) => (url.pathname.endsWith('/download') ? json({ url: 'https://x' }) : json([unsplashPhoto])), { UNSPLASH_ACCESS_KEY: 'k1' })
  const pings = () => calls.filter((c) => c.url.pathname.endsWith('/download')).length

  await rejects(w.track('unsplash', 'Dwu85P9SOIk', 'ann'), 404) // nothing was offered yet
  await rejects(w.track('unsplash', 'never-seen', 'ann'), 404)
  assert.equal(pings(), 0)

  await w.search('unsplash', '', 1)
  await w.track('unsplash', 'Dwu85P9SOIk', 'ann')
  await w.track('unsplash', 'Dwu85P9SOIk', 'ann') // choosing it again does not count again
  assert.equal(pings(), 1)
  await w.track('unsplash', 'Dwu85P9SOIk', 'bob') // someone else using it is another use
  assert.equal(pings(), 2)
  await rejects(w.track('unsplash', 'never-seen', 'bob'), 404)
  assert.equal(pings(), 2)
})

test('a report that failed can be sent again, and a source that does not ask is left alone', async () => {
  let fail = true
  const { w, calls } = setup((url) => (url.pathname.endsWith('/download') ? (fail ? json({}, 500) : json({ url: 'https://x' })) : json([unsplashPhoto])), { UNSPLASH_ACCESS_KEY: 'k1' })
  await w.search('unsplash', '', 1)
  await rejects(w.track('unsplash', 'Dwu85P9SOIk', 'ann'), 502)
  fail = false
  await w.track('unsplash', 'Dwu85P9SOIk', 'ann')
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/download')).length, 2)
  await rejects(w.track('pexels', 'whatever', 'ann'), 503) // not configured: refused, and no request made
  assert.equal(calls.filter((c) => c.url.hostname === 'api.pexels.com').length, 0)
  await w.track('picsum', '10', 'ann') // nothing to report for this source
})
