// Getting a background: photos from the server's sources, a picture from this
// device, and changing it automatically. What is chosen goes into the
// preferences (see lib/wallpaper.js); the picture from the device does not, it
// stays in this browser's IndexedDB.
import { api } from './api.js'
import { usePrefs, applyPrefs } from '../store/prefs.js'
import { normalizeWallpaper, dayKey, pickNext, setOwnImage, getOwnImage } from './wallpaper.js'

// ---------- photos ----------

export const wallpaperProviders = () => api.get('/api/wallpapers/providers').then((r) => r.providers)

export const searchWallpapers = (provider, q, page, signal) => api.get(`/api/wallpapers/search?${new URLSearchParams({ provider, q, page })}`, { signal })

const preload = (url) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })

// The one way the background is changed: merged with what is there and checked.
// Leaving a picture from this device lets go of it.
export function setWallpaper(patch) {
  const before = usePrefs.getState().wallpaper
  const next = normalizeWallpaper({ ...before, ...patch })
  if (before.kind === 'own' && next.kind !== 'own') removeOwnWallpaper()
  usePrefs.getState().set({ wallpaper: next })
}

// Makes a found photo the background. The picture is fetched first so the
// current one stays up until the new one can replace it.
export async function chooseWallpaper(item, { q, providerName }) {
  if (!(await preload(item.url))) throw new Error('That picture would not load. Try another.')
  setWallpaper({
    kind: 'image',
    image: { providerName, ...item },
    pool: { provider: item.provider, q },
    rotatedOn: dayKey(),
  })
  // some sources (Unsplash) ask to be told when a picture is used
  api.post('/api/wallpapers/track', { provider: item.provider, id: item.id }).catch(() => {})
}

// The next picture from where the current one came from; with nothing chosen
// yet, from the first source this server can reach.
export async function shuffleWallpaper(mode = 'launch') {
  const { image, pool: chosen } = usePrefs.getState().wallpaper
  let pool = chosen
  if (!pool) {
    const first = (await wallpaperProviders()).find((p) => p.available)
    if (!first) throw new Error('No background source is available on this server.')
    pool = { provider: first.id, q: '' }
  }
  const found = await searchWallpapers(pool.provider, pool.q, 1)
  const next = pickNext(found.items, image, mode)
  if (!next) throw new Error('There is nothing else to show from that source.')
  await chooseWallpaper(next, { q: pool.q, providerName: found.providerName })
}

// At start-up: change the picture if it is due. Quiet about trouble, and it
// leaves a data-saving or offline device alone.
export function rotateWallpaperOnStart() {
  const w = usePrefs.getState().wallpaper
  if (w.rotate === 'off' || w.kind !== 'image' || !w.pool) return
  if (navigator.onLine === false || navigator.connection?.saveData || matchMedia('(prefers-reduced-data: reduce)').matches) return
  if (w.rotate === 'daily' ? w.rotatedOn === dayKey() : sessionStorage.getItem('obi:wp-rotated')) return
  try {
    sessionStorage.setItem('obi:wp-rotated', '1')
  } catch {}
  shuffleWallpaper(w.rotate).catch(() => {})
}

// ---------- a picture from this device ----------

const OWN_SIDE = 2560
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

// Reads the picture kept on this device, if any, and shows it.
export async function loadOwnWallpaper() {
  if (usePrefs.getState().wallpaper.kind !== 'own' || getOwnImage()) return
  try {
    const blob = await store('readonly', (s) => s.get('own'))
    if (blob) setOwnImage({ url: URL.createObjectURL(blob) })
  } catch {}
  applyPrefs()
}

// Keeps a picture from this device: scaled down to something a screen can use,
// and remembered by its average colour so the next load can paint it at once.
export async function saveOwnWallpaper(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file could not be read as a picture.')
  })
  const scale = Math.min(1, OWN_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const average = new OffscreenCanvas(1, 1).getContext('2d')
  average.drawImage(canvas, 0, 0, 1, 1)
  const color = `#${[...average.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
  await store('readwrite', (s) => s.put(blob, 'own'))
  if (getOwnImage()) URL.revokeObjectURL(getOwnImage().url)
  setOwnImage({ url: URL.createObjectURL(blob) })
  setWallpaper({ kind: 'own', value: color })
}

async function removeOwnWallpaper() {
  await store('readwrite', (s) => s.delete('own')).catch(() => {})
  if (getOwnImage()) URL.revokeObjectURL(getOwnImage().url)
  setOwnImage(null)
}
