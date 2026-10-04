import { test } from 'node:test'
import assert from 'node:assert/strict'

// prefs.js reads localStorage and the page when it loads, so give it just enough of both
const stored = new Map()
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) }
const setVars = {}
const listeners = {}
globalThis.window = { dispatchEvent() {}, addEventListener: (type, fn) => (listeners[type] = fn) }
const idb = new Map() // IndexedDB, as far as the background needs it
const answer = (result) => {
  const req = { result }
  setTimeout(() => req.onsuccess?.())
  return req
}
globalThis.indexedDB = {
  open() {
    const req = {}
    setTimeout(() => {
      req.result = { createObjectStore() {}, close() {}, transaction: () => ({ objectStore: () => ({ get: (k) => answer(idb.get(k)), put: (v, k) => answer(idb.set(k, v) && k), delete: (k) => answer(idb.delete(k)), clear: () => answer(idb.clear()) }) }) }
      req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  },
}
globalThis.document = {
  documentElement: { dataset: {}, style: { length: 0, setProperty: (k, v) => (setVars[k] = v), removeProperty() {} } },
  querySelector: () => null,
}

const photo = {
  provider: 'pexels',
  providerName: 'Pexels',
  id: '2014422',
  url: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?w=2560',
  thumb: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?w=350',
  author: 'Joey Farina',
  authorUrl: 'https://www.pexels.com/@joey',
  sourceUrl: 'https://www.pexels.com/photo/2014422/',
}

// what an older version left behind: no background at all, and a hand-damaged one for the other test
stored.set('obi:prefs', JSON.stringify({ prefsVersion: 2, theme: 'light', palette: 'sand', wallpaper: { kind: 'image', image: { url: 'javascript:alert(1)' }, blur: 500, dim: 'lots' } }))
const { usePrefs, DEFAULT_PREFS } = await import('./prefs.js')
const { DEFAULT_WALLPAPER } = await import('../lib/wallpaper.js')

test('a damaged stored background is repaired on the way in, the rest of the preferences untouched', () => {
  const s = usePrefs.getState()
  assert.equal(s.theme, 'light')
  assert.equal(s.palette, 'sand')
  // no usable picture means no background; the numbers are kept, brought into range
  assert.deepEqual(s.wallpaper, { ...DEFAULT_WALLPAPER, blur: 40 })
})

test('the background is one of the preferences that sync', () => {
  assert.ok('wallpaper' in DEFAULT_PREFS)
  usePrefs.getState().set({ wallpaper: { ...DEFAULT_WALLPAPER, kind: 'colour', value: '#112233' } }, { remote: false })
  assert.equal(JSON.parse(stored.get('obi:prefs')).wallpaper.value, '#112233')
  assert.equal(setVars['--wp-color'], '#112233', 'and it reaches the page')
})

test('preferences synced from a version without backgrounds leave the local one alone', () => {
  usePrefs.getState().hydrate({ prefsVersion: 2, theme: 'dark', fontSize: 18 })
  const s = usePrefs.getState()
  assert.equal(s.fontSize, 18)
  assert.equal(s.wallpaper.kind, 'colour')
  assert.equal(s.wallpaper.value, '#112233')
})

test('a synced background replaces the local one, checked like any stored one', () => {
  usePrefs.getState().hydrate({ prefsVersion: 2, wallpaper: { kind: 'image', image: photo, blur: 12, dim: 120, panelOpacity: 20 } })
  const w = usePrefs.getState().wallpaper
  assert.equal(w.kind, 'image')
  assert.equal(w.image.author, 'Joey Farina')
  assert.equal(w.blur, 12)
  assert.equal(w.dim, 80)
  assert.equal(w.panelOpacity, 35)
  assert.equal(setVars['--wp-image'], `url("${photo.url}")`)

  usePrefs.getState().hydrate({ prefsVersion: 2, wallpaper: 'garbage' })
  assert.equal(usePrefs.getState().wallpaper.kind, 'none')
})

const settle = () => new Promise((r) => setTimeout(r, 30))

test("a background kept in the browser is its person's: somebody else signing in starts from their own, or none", async () => {
  const { hydrate } = usePrefs.getState()
  const mine = { prefsVersion: 2, wallpaper: { kind: 'colour', value: '#445566' } }
  hydrate(mine, 'alice')
  assert.equal(usePrefs.getState().wallpaper.value, '#445566')
  assert.equal(setVars['--wp-color'], '#445566')
  assert.ok(stored.get('obi:wp'), 'the first-paint cache is written')
  await settle() // this browser did not know whose it was held: that clearing is done now
  idb.set('own:alice', 'alice-picture')
  idb.set('own', 'an older, unkeyed one')

  // she signs in again: nothing changes, even when the server has nothing for her yet
  hydrate({ prefsVersion: 2, fontSize: 17 }, 'alice')
  assert.equal(usePrefs.getState().wallpaper.value, '#445566')
  hydrate(undefined, 'alice')
  assert.equal(usePrefs.getState().wallpaper.value, '#445566')
  await settle()
  assert.equal(idb.size, 2)

  // bob has saved no preferences at all: no background, and not alice's
  hydrate(undefined, 'bob')
  await settle()
  assert.equal(usePrefs.getState().wallpaper.kind, 'none')
  assert.equal(JSON.parse(stored.get('obi:prefs')).wallpaper.kind, 'none')
  assert.equal(stored.get('obi:wp'), undefined, 'nor is hers left for the next first paint')
  assert.equal(idb.size, 0, 'her device picture is deleted')
  assert.equal(stored.get('obi:wp-owner'), 'bob')

  // carol has preferences but chose no background
  hydrate({ prefsVersion: 2, wallpaper: { kind: 'colour', value: '#445566' } }, 'bob')
  assert.equal(usePrefs.getState().wallpaper.value, '#445566')
  await settle()
  idb.set('own:bob', 'bob-picture')
  hydrate({ prefsVersion: 2, fontSize: 15 }, 'carol')
  await settle()
  assert.equal(usePrefs.getState().fontSize, 15)
  assert.equal(usePrefs.getState().wallpaper.kind, 'none')
  assert.equal(idb.size, 0)

  // dave has one of his own
  hydrate({ prefsVersion: 2, wallpaper: { kind: 'colour', value: '#778899' } }, 'dave')
  assert.equal(usePrefs.getState().wallpaper.value, '#778899')
  assert.equal(setVars['--wp-color'], '#778899')
})

test('signing out takes the background out of the browser, and leaves what was saved on the server alone', async () => {
  const sent = []
  const { api } = await import('../lib/api.js')
  const patch = api.updateMe
  api.updateMe = (b) => (sent.push(b), Promise.resolve({}))
  usePrefs.getState().hydrate({ prefsVersion: 2, wallpaper: { kind: 'own', value: '#778899' } }, 'erin')
  await settle()
  idb.set('own:erin', 'erin-picture')
  assert.ok(stored.get('obi:wp'))
  listeners['obi:signout']()
  await settle()
  assert.equal(usePrefs.getState().wallpaper.kind, 'none')
  assert.equal(stored.get('obi:wp'), undefined)
  assert.equal(stored.get('obi:wp-owner'), undefined)
  assert.equal(idb.size, 0)
  assert.equal(JSON.parse(stored.get('obi:prefs')).wallpaper.kind, 'none')
  await new Promise((r) => setTimeout(r, 1400)) // the preferences are saved a moment after a change
  assert.deepEqual(sent, [], 'signing out does not overwrite her saved background with none')
  api.updateMe = patch
})
