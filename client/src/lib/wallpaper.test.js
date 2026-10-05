import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WALLPAPER, GRADIENTS, plateFloor, normalizeWallpaper, wallpaperVars } from './wallpaper.js'

test('anything that is not a description becomes "no background"', () => {
  for (const junk of [undefined, null, 'dark', 42, [], {}, { kind: 'banana' }]) assert.deepEqual(normalizeWallpaper(junk), DEFAULT_WALLPAPER, String(junk))
})

test('numbers are brought into range, words into one of the choices', () => {
  const w = normalizeWallpaper({ kind: 'colour', value: '#ABCDEF', blur: 999, dim: -5, panelOpacity: 10, fit: 'stretch', position: 'left', rotate: 'hourly' })
  assert.deepEqual(w, { ...DEFAULT_WALLPAPER, kind: 'colour', value: '#abcdef', blur: 40, dim: 0, panelOpacity: 35 })
  const odd = normalizeWallpaper({ blur: '12', dim: NaN, panelOpacity: Infinity })
  assert.equal(odd.blur, DEFAULT_WALLPAPER.blur)
  assert.equal(odd.dim, DEFAULT_WALLPAPER.dim)
  assert.equal(odd.panelOpacity, DEFAULT_WALLPAPER.panelOpacity)
})

test('a kind without what it needs falls back to none', () => {
  // photos from online sources are no longer offered: one stored by an older version is no background
  assert.equal(normalizeWallpaper({ kind: 'image', image: { provider: 'unsplash', id: 'a', url: 'https://images.unsplash.com/a.jpg' } }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'colour', value: 'red' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'gradient', value: 'no-such-gradient' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'own' }).kind, 'none')
  assert.equal(normalizeWallpaper({ kind: 'own', value: '#112233' }).kind, 'own')
  assert.equal(normalizeWallpaper({ kind: 'gradient', value: GRADIENTS[0].id }).kind, 'gradient')
})

test('wallpaperVars: nothing for none, a layer for everything else', () => {
  assert.equal(wallpaperVars(DEFAULT_WALLPAPER), null)
  const colour = wallpaperVars({ ...DEFAULT_WALLPAPER, kind: 'colour', value: '#112233', blur: 20 })
  assert.equal(colour['--wp-color'], '#112233')
  assert.equal(colour['--wp-image'], 'none')
  assert.equal(colour['--wp-blur'], '0px', 'a flat colour has nothing to blur')

  const image = wallpaperVars(normalizeWallpaper({ kind: 'own', value: '#336699', blur: 12, fit: 'tile', position: 'top' }), { url: 'blob:http://localhost/abc' })
  assert.equal(image['--wp-image'], 'url("blob:http://localhost/abc")')
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

