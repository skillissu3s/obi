// Changing the background, and the picture from this device. What is chosen goes
// into the preferences (see lib/wallpaper.js); the picture itself does not, it
// stays in this browser's IndexedDB.
import { usePrefs, applyPrefs } from '../store/prefs.js'
import { confirmDialog } from '../store/ui.js'
import { normalizeWallpaper, setOwnImage, getOwnImage } from './wallpaper.js'
import { readDevicePicture, writeDevicePicture, deleteDevicePicture } from './wallpaperDevice.js'

// The one way the background is changed: merged with what is there and checked.
// The picture from this device stays on it when another background is chosen, so
// it can be gone back to; only Remove (or signing out) lets go of it.
export function setWallpaper(patch) {
  const next = normalizeWallpaper({ ...usePrefs.getState().wallpaper, ...patch })
  usePrefs.getState().set({ wallpaper: next })
}

// ---------- a picture from this device ----------

const OWN_SIDE = 2560

const hex = (data) => `#${[...data.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
// a picture's average colour: what the first paint shows until the picture itself is read
function averageOf(source) {
  const one = new OffscreenCanvas(1, 1).getContext('2d')
  one.drawImage(source, 0, 0, 1, 1)
  return hex(one.getImageData(0, 0, 1, 1).data)
}

// Reads the picture kept on this device, if there is one, so it can be shown (or offered again).
export async function loadOwnWallpaper() {
  if (getOwnImage()) return
  try {
    const blob = await readDevicePicture()
    if (!blob) return
    const bitmap = await createImageBitmap(blob)
    const color = averageOf(bitmap)
    bitmap.close()
    setOwnImage({ url: URL.createObjectURL(blob), color })
  } catch {}
  applyPrefs()
}

// Keeps a picture from this device: scaled down to something a screen can use,
// and remembered by its average colour so the next load can paint it at once.
export async function saveOwnWallpaper(file) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('That file is not a picture.')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file could not be read as a picture.')
  })
  const scale = Math.min(1, OWN_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  const paint = canvas.getContext('2d')
  paint.fillStyle = '#fff' // JPEG has no transparency: what a picture leaves clear would turn black
  paint.fillRect(0, 0, canvas.width, canvas.height)
  paint.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const color = averageOf(canvas)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
  await writeDevicePicture(blob)
  if (getOwnImage()) URL.revokeObjectURL(getOwnImage().url)
  setOwnImage({ url: URL.createObjectURL(blob), color })
  setWallpaper({ kind: 'own', value: color })
}

// Back to the picture this device already has.
export function backToOwnPicture() {
  const own = getOwnImage()
  if (own) setWallpaper({ kind: 'own', value: own.color })
}

// Forgets the picture; if it was the background, there is none.
export async function removeOwnWallpaper() {
  await deleteDevicePicture().catch(() => {})
  if (getOwnImage()) URL.revokeObjectURL(getOwnImage().url)
  setOwnImage(null)
  if (usePrefs.getState().wallpaper.kind === 'own') setWallpaper({ kind: 'none' })
}
