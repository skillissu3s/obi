import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WALLPAPER, GRADIENTS, plateFloor, normalizeWallpaper, wallpaperVars, pickNext, rotationDue } from './wallpaper.js'

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

test('however see-through the panels and however little the dim, everything that carries text keeps the theme background over at least 80% of the picture', () => {
  for (const dim of [0, 20, 35, 50, 72, 80]) {
    for (const panelOpacity of [35, 60, 100]) {
      const v = wallpaperVars(normalizeWallpaper({ kind: 'colour', value: '#ffffff', dim, panelOpacity }))
      // what the picture lets through: the dim first, then the panel over it
      for (const plate of ['--wp-panel', '--wp-pane']) {
        const solid = parseFloat(v[plate]) / 100
        assert.ok(1 - (1 - dim / 100) * (1 - solid) >= 0.795, `dim ${dim}, panels ${panelOpacity}: ${plate} ${solid}`)
        assert.ok(solid >= panelOpacity / 100, 'and never less solid than the panels were asked to be')
      }
    }
  }
  assert.equal(plateFloor(0), 80)
  assert.equal(plateFloor(35), 69)
  assert.equal(plateFloor(80), 0, 'a heavy dim needs no extra cover')
  // at the defaults the floor already applies, to the sidebar and bars as well as the notes
  const v = wallpaperVars({ ...DEFAULT_WALLPAPER, kind: 'colour', value: '#ffffff' })
  assert.deepEqual([v['--wp-panel'], v['--wp-pane']], ['69%', '69%'])
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

test("the provider's average colour holds the place until the picture is there, and only a real colour is kept", () => {
  const w = normalizeWallpaper({ kind: 'image', image: { ...photo, color: '#0C2840' } })
  assert.equal(w.image.color, '#0c2840')
  assert.equal(wallpaperVars(w)['--wp-color'], '#0c2840')
  assert.equal(wallpaperVars(normalizeWallpaper({ kind: 'image', image: photo }))['--wp-color'], 'transparent')
  for (const bad of ['red', 'url(x)', '#12', 7, null]) assert.ok(!('color' in normalizeWallpaper({ kind: 'image', image: { ...photo, color: bad } }).image), String(bad))
  assert.deepEqual(normalizeWallpaper(w), w)
})

test('rotationDue: daily only moves forward, and "each launch" once a session', () => {
  const pool = { provider: 'unsplash', q: '' }
  const daily = (rotatedOn) => ({ ...DEFAULT_WALLPAPER, kind: 'image', image: photo, pool, rotate: 'daily', rotatedOn })
  assert.equal(rotationDue(daily('2026-10-03'), '2026-10-04'), true, 'the next day')
  assert.equal(rotationDue(daily('2026-10-04'), '2026-10-04'), false, 'the same day')
  assert.equal(rotationDue(daily(''), '2026-10-04'), true, 'never changed yet')
  assert.equal(rotationDue(daily('2026-12-31'), '2027-01-01'), true, 'across a year')
  // a day that is not after the one it last changed on: another time zone, or a clock set back
  assert.equal(rotationDue(daily('2026-10-05'), '2026-10-04'), false)
  assert.equal(rotationDue(daily('2026-10-04'), '2026-10-03'), false)
  // two devices a day apart do not take turns: the one that is behind waits for the other
  const ahead = daily('2026-10-04')
  assert.equal(rotationDue(ahead, '2026-10-03'), false)
  assert.equal(rotationDue(ahead, '2026-10-04'), false)
  assert.equal(rotationDue(ahead, '2026-10-05'), true)
  // a date years ahead was a wrong clock: it is not waited for
  assert.equal(rotationDue(daily('2030-01-01'), '2026-10-04'), true)

  const launch = { ...daily(''), rotate: 'launch' }
  assert.equal(rotationDue(launch, '2026-10-04', false), true)
  assert.equal(rotationDue(launch, '2026-10-04', true), false)
  assert.equal(rotationDue({ ...launch, rotate: 'off' }, '2026-10-04'), false)
  assert.equal(rotationDue({ ...launch, pool: null }, '2026-10-04'), false)
  assert.equal(rotationDue({ ...DEFAULT_WALLPAPER, kind: 'colour', value: '#112233', rotate: 'daily', pool }, '2026-10-04'), false)
})
