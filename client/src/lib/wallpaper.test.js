import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WALLPAPER, GRADIENTS, paneFloor, normalizeWallpaper, wallpaperVars, pickNext } from './wallpaper.js'

const photo = {
  provider: 'unsplash',
  providerName: 'Unsplash',
  id: 'Dwu85P9SOIk',
  url: 'https://images.unsplash.com/photo-1?w=2560',
  thumb: 'https://images.unsplash.com/photo-1?w=400',
  author: 'Jane Doe',
  authorUrl: 'https://unsplash.com/@jane',
  sourceUrl: 'https://unsplash.com/photos/Dwu85P9SOIk',
}

test('anything that is not a description becomes "no background"', () => {
  for (const junk of [undefined, null, 'dark', 42, [], {}, { kind: 'banana' }]) assert.deepEqual(normalizeWallpaper(junk), DEFAULT_WALLPAPER, String(junk))
})

test('numbers are brought into range, words into one of the choices', () => {
  const w = normalizeWallpaper({ kind: 'colour', value: '#ABCDEF', blur: 999, dim: -5, panelOpacity: 10, fit: 'stretch', position: 'left', rotate: 'hourly', rotatedOn: 'yesterday' })
  assert.deepEqual(w, { ...DEFAULT_WALLPAPER, kind: 'colour', value: '#abcdef', blur: 40, dim: 0, panelOpacity: 35 })
  const odd = normalizeWallpaper({ blur: '12', dim: NaN, panelOpacity: Infinity })
  assert.equal(odd.blur, DEFAULT_WALLPAPER.blur)
  assert.equal(odd.dim, DEFAULT_WALLPAPER.dim)
  assert.equal(odd.panelOpacity, DEFAULT_WALLPAPER.panelOpacity)
})

test('a kind without what it needs falls back to none', () => {
  assert.equal(normalizeWallpaper({ kind: 'image' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'image', image: { ...photo, url: 'http://images.unsplash.com/a.jpg' } }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'image', image: { ...photo, url: 'javascript:alert(1)' } }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'image', image: { ...photo, id: undefined } }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'colour', value: 'red' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'gradient', value: 'no-such-gradient' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'own' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'own', value: '#112233' }).kind, 'own')
  assert.equal(normalizeWallpaper({ kind: 'gradient', value: GRADIENTS[0].id }).kind, 'gradient')
})

test('a stored picture keeps only what it needs', () => {
  const w = normalizeWallpaper({ kind: 'image', image: { ...photo, thumb: 'nope', author: 'x'.repeat(500), authorUrl: 'javascript:alert(1)', extra: 'dropped', width: 4000 } })
  assert.equal(w.kind, 'image')
  assert.equal(w.image.thumb, photo.url) // an unusable thumbnail falls back to the picture
  assert.equal(w.image.author.length, 120)
  assert.equal(w.image.authorUrl, '')
  assert.ok(!('extra' in w.image) && !('width' in w.image))
  assert.deepEqual(normalizeWallpaper(w), w, 'normalising twice changes nothing')
})

test('where the next picture comes from is only kept when it makes sense', () => {
  assert.deepEqual(normalizeWallpaper({ pool: { provider: 'unsplash', q: 'forest' } }).pool, { provider: 'unsplash', q: 'forest' })
  assert.deepEqual(normalizeWallpaper({ pool: { provider: 'unsplash' } }).pool, { provider: 'unsplash', q: '' })
  assert.equal(normalizeWallpaper({ pool: { provider: '../etc' } }).pool, null)
  assert.equal(normalizeWallpaper({ pool: {} }).pool, null)
  assert.equal(normalizeWallpaper({ pool: 'unsplash' }).pool, null)
})

test('wallpaperVars: nothing for none, a layer for everything else', () => {
  assert.equal(wallpaperVars(DEFAULT_WALLPAPER), null)
  const colour = wallpaperVars({ ...DEFAULT_WALLPAPER, kind: 'colour', value: '#112233', blur: 20 })
  assert.equal(colour['--wp-color'], '#112233')
  assert.equal(colour['--wp-image'], 'none')
  assert.equal(colour['--wp-blur'], '0px', 'a flat colour has nothing to blur')

  const image = wallpaperVars(normalizeWallpaper({ kind: 'image', image: photo, blur: 12, fit: 'tile', position: 'top' }))
  assert.equal(image['--wp-image'], `url("${photo.url}")`)
  assert.equal(image['--wp-blur'], '12px')
  assert.equal(image['--wp-size'], 'auto')
  assert.equal(image['--wp-repeat'], 'repeat')
  assert.equal(image['--wp-pos'], 'center top')

  const g = wallpaperVars(normalizeWallpaper({ kind: 'gradient', value: 'ocean' }))
  assert.match(g['--wp-image'], /^linear-gradient\(/)

  const own = normalizeWallpaper({ kind: 'own', value: '#336699' })
  assert.equal(wallpaperVars(own)['--wp-image'], 'none', 'on a device without the picture: its average colour')
  assert.equal(wallpaperVars(own)['--wp-color'], '#336699')
  assert.equal(wallpaperVars(own, { url: 'blob:http://localhost/abc' })['--wp-image'], 'url("blob:http://localhost/abc")')
})

test('a picture URL cannot break out of the CSS it is written into', () => {
  const w = normalizeWallpaper({ kind: 'image', image: { ...photo, url: 'https://images.unsplash.com/a"); background: red; ("b.jpg' } })
  const css = wallpaperVars(w)['--wp-image']
  assert.match(css, /^url\("[^"\\]*"\)$/)
})

test('however see-through the panels and however little the dim, the notes keep the theme background over at least 72% of the picture', () => {
  for (const dim of [0, 20, 35, 50, 72, 80]) {
    for (const panelOpacity of [35, 60, 100]) {
      const v = wallpaperVars(normalizeWallpaper({ kind: 'colour', value: '#ffffff', dim, panelOpacity }))
      assert.equal(v['--wp-panel'], `${panelOpacity}%`)
      const pane = parseFloat(v['--wp-pane']) / 100
      // what the picture lets through: the dim first, then the pane over it
      assert.ok(1 - (1 - dim / 100) * (1 - pane) >= 0.715, `dim ${dim}, panels ${panelOpacity}: pane ${pane}`)
      assert.ok(pane >= panelOpacity / 100, 'and never less solid than the panels were asked to be')
    }
  }
  assert.equal(paneFloor(0), 72)
  assert.equal(paneFloor(80), 0, 'a heavy dim needs no extra cover')
})

test('pickNext: never the picture already showing; daily holds still all day', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ provider: 'p', id }))
  assert.equal(pickNext([], null, 'launch'), null)
  assert.equal(pickNext([items[0]], items[0], 'launch'), null)
  for (let i = 0; i < 20; i++) assert.notEqual(pickNext(items, items[1], 'launch').id, 'b')
  assert.equal(pickNext(items, null, 'launch', '2026-10-03', () => 0).id, 'a')
  assert.equal(pickNext(items, null, 'launch', '2026-10-03', () => 0.99).id, 'd')
  const today = pickNext(items, null, 'daily', '2026-10-03')
  assert.equal(pickNext(items, null, 'daily', '2026-10-03').id, today.id)
  assert.notEqual(pickNext(items, null, 'daily', '2026-10-04').id, today.id)
  // the same id from another source is another picture
  assert.equal(pickNext([{ provider: 'q', id: 'a' }], { provider: 'p', id: 'a' }, 'launch').id, 'a')
})
