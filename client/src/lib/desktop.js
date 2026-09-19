// Running inside the desktop app? It exposes `window.obiDesktop` (see
// desktop/preload.cjs) and serves /api/desktop for vaults and syncing.
import { create } from 'zustand'
import { request } from './api.js'

export const desktop = typeof window !== 'undefined' ? window.obiDesktop || null : null
export const isDesktop = !!desktop

const D = '/api/desktop'

export const dapi = {
  info: () => request('GET', `${D}/info`),
  createVault: (body) => request('POST', `${D}/vaults`, body),
  forgetVault: (id) => request('DELETE', `${D}/vaults/${id}`),

  cloudOptions: (url) => request('POST', `${D}/cloud/options`, { url }),
  cloudLogin: (url, identifier, password) => request('POST', `${D}/cloud/login`, { url, identifier, password }),
  cloudLoginCode: (url, identifier) => request('POST', `${D}/cloud/login/code`, { url, identifier }),
  cloudLoginVerify: (url, ticket, code) => request('POST', `${D}/cloud/login/verify`, { url, ticket, code }),
  cloudRegister: (url, body) => request('POST', `${D}/cloud/register`, { url, ...body }),
  cloudRegisterVerify: (url, ticket, code) => request('POST', `${D}/cloud/register/verify`, { url, ticket, code }),
  cloudResend: (url, ticket) => request('POST', `${D}/cloud/resend`, { url, ticket }),
  cloudSignOut: (id) => request('DELETE', `${D}/cloud/${id}`),
  cloudWorkspaces: (id) => request('GET', `${D}/cloud/${id}/workspaces`),
  importCloud: (id, remoteId, dir, name) => request('POST', `${D}/cloud/${id}/import`, { remoteId, dir, name }),

  linkCloud: (wsId, body) => request('POST', `${D}/vaults/${wsId}/cloud`, body),
  unlinkCloud: (wsId) => request('DELETE', `${D}/vaults/${wsId}/cloud`),
  cloudSyncNow: (wsId) => request('POST', `${D}/vaults/${wsId}/cloud/sync`, {}),
  online: () => request('POST', `${D}/online`, {}),

  githubConnect: (wsId, body) => request('POST', `${D}/vaults/${wsId}/github`, body),
  githubDisconnect: (wsId) => request('DELETE', `${D}/vaults/${wsId}/github`),
  githubPull: (wsId) => request('POST', `${D}/vaults/${wsId}/github/pull`, {}),
}

/** Desktop facts: vaults, signed-in cloud accounts, whether git is installed */
export const useDesktop = create((set) => ({
  info: null,
  async refresh() {
    if (!isDesktop) return null
    const info = await dapi.info()
    set({ info })
    return info
  },
}))

/** Asks for a folder; null when cancelled */
export function pickFolder(opts) {
  return desktop ? desktop.pickFolder(opts) : Promise.resolve(null)
}

export const folderName = (dir) => String(dir || '').split(/[\\/]/).filter(Boolean).pop() || dir

if (isDesktop) {
  document.documentElement.classList.add('is-desktop')
  // the network is back: sync now instead of waiting for the next retry
  window.addEventListener('online', () => dapi.online().catch(() => {}))
}

/** A few words on where a workspace lives, for switchers and headers */
export function wsWhere(w) {
  if (!w) return ''
  if (w.dir) {
    const parts = []
    if (w.cloud) parts.push('Cloud sync')
    if (w.type === 'github') parts.push(`GitHub · ${w.github?.label}`)
    return parts.length ? parts.join(' · ') : 'On this computer'
  }
  if (w.type === 'github') return `GitHub · ${w.github?.label}`
  return `Online${w.memberCount > 1 ? ` · ${w.memberCount} members` : ''}`
}
