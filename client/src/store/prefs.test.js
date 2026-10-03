import { test } from 'node:test'
import assert from 'node:assert/strict'

// prefs.js reads localStorage and the page when it loads, so give it just enough of both
const stored = new Map()
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) }
const setVars = {}
globalThis.window = { dispatchEvent() {} }
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
