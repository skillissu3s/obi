// New versions of Obi, told inside the app.
//
// Desktop: desktop/updates.js checks the GitHub releases, downloads a new one
// where the app can install it itself, and reports each step here; the notice
// then offers to restart into it (or, on a Mac, to download it).
// Web: the server says which build it hands out (/api/version); when that is not
// the build this tab is running, the server has been updated and a reload brings
// the new one.
import { create } from 'zustand'
import { desktop } from './desktop.js'

/**
 * status: idle | checking | none | available | downloading | ready | installing | error | reload
 * (`reload`: web only). See desktop/updates.js for the rest of the fields.
 */
// eslint-disable-next-line no-undef
const BUILT = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null // vite.config.js
export const useUpdates = create(() => ({ status: 'idle', kind: desktop?.updates ? 'desktop' : 'web', current: BUILT }))

let started = false
export function startUpdates() {
  if (started) return
  started = true
  if (desktop?.updates) {
    desktop.updates.state().then((s) => s && useUpdates.setState(s), () => {})
    desktop.updates.onChange((s) => useUpdates.setState(s))
    return
  }
  // a development server runs the source, not a build: nothing to compare
  if (import.meta.env.DEV) return
  const mine = document.querySelector('script[type="module"][src*="/assets/main-"]')?.getAttribute('src') || null
  const look = async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      const { version, entry } = await res.json()
      if (mine && entry && entry !== mine) useUpdates.setState({ status: 'reload', version, key: entry })
    } catch {}
  }
  look()
  setInterval(look, 10 * 60 * 1000)
  // coming back to a tab left open overnight is when it is most likely behind
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && look())
}

/** Check now (desktop), for Settings' button */
export async function checkForUpdates() {
  if (!desktop?.updates) return
  const s = await desktop.updates.check().catch((e) => ({ status: 'error', error: String(e?.message || e) }))
  if (s) useUpdates.setState(s)
}

export const installUpdate = () => desktop?.updates?.install()
export const downloadUpdate = () => desktop?.updates?.openDownload()
export const reloadForUpdate = () => window.location.reload()
