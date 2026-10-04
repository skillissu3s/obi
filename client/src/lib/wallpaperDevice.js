// The picture kept on this device, and whose background this browser is holding.
// The picture lives in this browser's IndexedDB under the id of the person who chose it, so nobody else's
// sign-in can show it. It goes, with the cache the first paint reads (lib/wallpaper.js), when that person
// signs out or somebody else signs in.
import { getOwnImage, setOwnImage, clearWallpaperCache } from './wallpaper.js'

const OWNER = 'obi:wp-owner' // the person the background held in this browser was chosen by
let owner = ''

const store = (mode, run) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('obi-wallpaper', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const req = run(db.transaction('files', mode).objectStore('files'))
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
    }
  })

const file = () => `own:${owner}`
export const readDevicePicture = () => store('readonly', (s) => s.get(file()))
export const writeDevicePicture = (blob) => store('readwrite', (s) => s.put(blob, file()))
export const deleteDevicePicture = () => store('readwrite', (s) => s.delete(file()))

// Lets go of every picture kept here and of the cache the first paint uses; whoever signs in next starts clean.
export function forgetWallpaper() {
  if (getOwnImage()) URL.revokeObjectURL(getOwnImage().url)
  setOwnImage(null)
  owner = ''
  clearWallpaperCache()
  try {
    localStorage.removeItem(OWNER)
  } catch {}
  return store('readwrite', (s) => s.clear()).catch(() => {})
}

// Called when somebody signs in. True when what this browser held was somebody else's (or nobody's that we
// know of), which is then forgotten: the caller starts that person from the background they have saved.
export function claimWallpaper(userId) {
  let last = ''
  try {
    last = localStorage.getItem(OWNER) || ''
  } catch {}
  const id = String(userId)
  const other = last !== id
  if (other) forgetWallpaper()
  owner = id
  try {
    localStorage.setItem(OWNER, id)
  } catch {}
  return other
}
