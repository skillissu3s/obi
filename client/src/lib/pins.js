import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from './api.js'
import { conn } from './socket.js'
import { useApp } from '../store/app.js'
import { toast } from '../store/ui.js'

// The workspace's calendar pins, fetched when a calendar first shows and again
// whenever they change (here, on another device, or from a sync).
export const usePinStore = create(() => ({ wsId: null, pins: [], loaded: false }))

let loading = null
async function load(wsId) {
  if (!wsId) return
  const mine = (loading = api.calendar(wsId))
  try {
    const { pins } = await mine
    if (loading === mine && useApp.getState().wsId === wsId) usePinStore.setState({ wsId, pins, loaded: true })
  } catch {
    if (loading === mine) usePinStore.setState({ wsId, pins: [], loaded: true })
  }
}

conn.on('calendar', (m) => {
  if (m.ws === usePinStore.getState().wsId) load(m.ws)
})

/** The pins of the workspace in view */
export function usePins() {
  const wsId = useApp((s) => s.wsId)
  const st = usePinStore()
  useEffect(() => {
    if (wsId && st.wsId !== wsId) {
      usePinStore.setState({ wsId, pins: [], loaded: false })
      load(wsId)
    }
  }, [wsId, st.wsId])
  return st.wsId === wsId ? st.pins : []
}

const run = async (fn, ok) => {
  const wsId = useApp.getState().wsId
  try {
    const { pins } = await fn(wsId)
    usePinStore.setState({ wsId, pins })
    if (ok) toast.success(ok)
    return true
  } catch (e) {
    toast.error(e)
    return false
  }
}

export const addPin = (pin) => run((ws) => api.addPin(ws, pin), `Pinned “${pin.title}”`)
export const updatePin = (id, patch) => run((ws) => api.updatePin(ws, id, patch))
export const removePin = (pin) => run((ws) => api.removePin(ws, pin.id), `Took down “${pin.title}”`)
