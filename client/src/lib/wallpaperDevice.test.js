import { test } from 'node:test'
import assert from 'node:assert/strict'

// a browser with just enough of localStorage and IndexedDB: one object store, answers a tick later like the real thing
const local = new Map()
globalThis.localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) }
const files = new Map()
const answer = (result) => {
  const req = { result }
  setTimeout(() => req.onsuccess?.())
  return req
}
globalThis.indexedDB = {
  open() {
    const req = {}
    setTimeout(() => {
      req.result = {
        createObjectStore() {},
        close() {},
        transaction: () => ({
          objectStore: () => ({
            get: (k) => answer(files.get(k)),
            put: (v, k) => answer(files.set(k, v) && k),
            delete: (k) => answer(files.delete(k)),
            clear: () => answer(files.clear()),
          }),
        }),
      }
      req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  },
}

const { claimWallpaper, forgetWallpaper, readDevicePicture, writeDevicePicture } = await import('./wallpaperDevice.js')
const { setOwnImage, getOwnImage } = await import('./wallpaper.js')
const settle = () => new Promise((r) => setTimeout(r, 30))

test('a picture kept on the device is only ever read back for the person who saved it', async () => {
  claimWallpaper('alice')
  await writeDevicePicture('alice-picture')
  assert.equal(await readDevicePicture(), 'alice-picture')
  assert.deepEqual([...files.keys()], ['own:alice'])

  // another person signs in without anything having cleared it (a copy still on disk, say)
  const keep = new Map(files)
  assert.equal(claimWallpaper('bob'), true)
  await settle()
  for (const [k, v] of keep) files.set(k, v) // as if the clearing had not happened
  assert.equal(await readDevicePicture(), undefined, "bob never gets alice's picture")
})

test('somebody else signing in forgets the device picture, the first-paint cache and the in-memory picture', async () => {
  claimWallpaper('alice')
  await writeDevicePicture('alice-picture')
  files.set('own', 'a picture kept the way an older version did')
  local.set('obi:wp', '{"--wp-color":"#123456"}')
  setOwnImage({ url: 'blob:http://localhost/alice' })

  assert.equal(claimWallpaper('alice'), false, 'the same person signing in again changes nothing')
  await settle()
  assert.equal(files.size, 2)
  assert.ok(local.get('obi:wp'))
  assert.ok(getOwnImage())

  assert.equal(claimWallpaper('bob'), true)
  await settle()
  assert.equal(files.size, 0, 'every picture kept here is gone')
  assert.equal(local.get('obi:wp'), undefined)
  assert.equal(getOwnImage(), null)
  assert.equal(local.get('obi:wp-owner'), 'bob')
})

test('a browser that does not know whose background it holds treats the next person as a newcomer', async () => {
  forgetWallpaper()
  await settle()
  files.set('own', 'somebody')
  assert.equal(local.get('obi:wp-owner'), undefined)
  assert.equal(claimWallpaper('carol'), true)
  await settle()
  assert.equal(files.size, 0)
})

test('signing out forgets everything and the next person to sign in, even the same one, is a newcomer', async () => {
  claimWallpaper('alice')
  await writeDevicePicture('alice-picture')
  local.set('obi:wp', '{"--wp-color":"#123456"}')
  setOwnImage({ url: 'blob:http://localhost/alice' })
  await forgetWallpaper()
  assert.equal(files.size, 0)
  assert.equal(local.get('obi:wp'), undefined)
  assert.equal(local.get('obi:wp-owner'), undefined)
  assert.equal(getOwnImage(), null)
  assert.equal(claimWallpaper('alice'), true)
})

test('a browser without IndexedDB still signs people out', async () => {
  const idb = globalThis.indexedDB
  delete globalThis.indexedDB
  local.set('obi:wp', '{}')
  await forgetWallpaper()
  assert.equal(local.get('obi:wp'), undefined)
  globalThis.indexedDB = idb
})
