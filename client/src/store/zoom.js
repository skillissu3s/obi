import { create } from 'zustand'

// How far a note is zoomed on this device. 100% is the size its column and
// canvas are laid out at — what a published page matches — so zooming only
// changes how large that layout is shown, never where anything sits in it.
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

const KEY = 'obi:noteZoom'
const clamp = (z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100

function load() {
  try {
    const z = Number(localStorage.getItem(KEY))
    return z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1
  } catch {
    return 1
  }
}

export const useNoteZoom = create((set, get) => ({
  zoom: load(),
  // the height on screen (from the top of the note's scroll area) to hold
  // still while zooming — under the pointer for the wheel; null = the middle
  anchorY: null,

  setZoom(z, anchorY = null) {
    const zoom = clamp(z)
    if (zoom === get().zoom) return
    set({ zoom, anchorY })
    try {
      localStorage.setItem(KEY, String(zoom))
    } catch {}
  },

  // one notch along ZOOM_STEPS
  step(dir, anchorY = null) {
    const z = get().zoom
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001)
    if (next) get().setZoom(next, anchorY)
  },

  reset: () => get().setZoom(1),
}))

export const zoomLabel = (z) => `${Math.round(z * 100)}%`
