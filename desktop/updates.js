// Updates for the desktop app, from the project's GitHub releases.
//
// Shortly after launch, and every few hours, the app asks whether a newer
// release exists. On Windows (and a Linux AppImage) it downloads it quietly and
// the page shows "Obi x.y.z is ready — Restart"; anything not installed on the
// spot is installed when the app next quits. A Mac build can't replace itself
// until it is signed by Apple, and a .deb belongs to the system's package
// manager, so there the page offers the download instead.
//
// The page sees one state object (see `state` below) and can ask to check now or
// to restart into the update.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import updaterPkg from 'electron-updater'

const { autoUpdater } = updaterPkg

const REPO = 'skillissu3s/obi'
const RELEASES = `https://github.com/${REPO}/releases`
const FIRST_CHECK_MS = 10 * 1000
const EVERY_MS = 6 * 60 * 60 * 1000

// Installs by itself: the Windows installer, or an AppImage (which knows where it lives)
const canInstall = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

/**
 * What the page is told:
 *   status   idle | checking | none | available | downloading | ready | error
 *   version  the newer version, when there is one
 *   progress 0–100 while downloading
 *   install  whether this build installs updates itself (else: `url` to download)
 *   current  the version running now
 */
let state = { status: 'idle', current: app.getVersion(), install: canInstall, url: `${RELEASES}/latest` }
let manual = false // the last check was asked for: report "up to date" and errors too

const DEV = process.env.OBI_UPDATE_DEV // development: a dev-app-update.yml to check against, from an unpackaged run

function set(patch) {
  state = { ...state, ...patch }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('obi:update', state)
  if (DEV) {
    console.log('[update]', JSON.stringify(state))
    // a picture of what the page shows once the update is in
    if (patch.status === 'ready')
      setTimeout(async () => {
        const w = BrowserWindow.getAllWindows()[0]
        if (w) (await import('node:fs')).writeFileSync(`${DEV}.png`, (await w.webContents.capturePage()).toPNG())
      }, 2000)
  }
}

const notesUrl = (version) => `${RELEASES}/tag/v${version}`

async function check(asked = false) {
  if (state.status === 'checking' || state.status === 'downloading') return state
  if (state.status === 'ready') return state // already waiting for a restart
  manual = asked
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ status: asked ? 'error' : 'idle', error: asked ? String(e?.message || e).split('\n')[0] : undefined })
  }
  return state
}

/** `beforeInstall`: saves open notes and stops the server, before the installer takes over */
export function setupUpdates({ beforeInstall = async () => {} } = {}) {
  ipcMain.handle('obi:update-state', () => state)
  ipcMain.handle('obi:update-check', () => (app.isPackaged || DEV ? check(true) : { ...state, status: 'error', error: 'Updates are only checked in the installed app.' }))
  ipcMain.handle('obi:update-install', async () => {
    if (state.status !== 'ready') return false
    set({ status: 'installing' })
    // (a test run stops here: it must not install anything into the real app)
    if (DEV) return true
    // the installer may close the app as soon as it starts: everything is saved first
    await beforeInstall().catch(() => {})
    // a silent install that opens the app again when it is done
    autoUpdater.quitAndInstall(true, true)
    return true
  })
  ipcMain.handle('obi:update-download', () => shell.openExternal(state.version ? notesUrl(state.version) : `${RELEASES}/latest`))

  // a development run has no release to compare with (unless pointed at one, for testing)
  if (!app.isPackaged && !DEV) return
  if (DEV) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.updateConfigPath = DEV
  }

  autoUpdater.autoDownload = canInstall
  // (a test run never installs anything into the real app on its way out)
  autoUpdater.autoInstallOnAppQuit = canInstall && !DEV
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ status: manual ? 'none' : 'idle', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) =>
    set({ status: canInstall ? 'downloading' : 'available', version: info.version, progress: 0, notes: notesUrl(info.version), url: notesUrl(info.version), checkedAt: Date.now() }),
  )
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent || 0) }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100, notes: notesUrl(info.version) }))
  autoUpdater.on('error', (e) => {
    // a quiet check that failed (offline, GitHub unreachable) says nothing; one that was asked for says why
    if (state.status === 'ready') return
    set({ status: manual ? 'error' : 'idle', error: manual ? String(e?.message || e).split('\n')[0] : undefined })
  })

  setTimeout(() => check(false), FIRST_CHECK_MS)
  setInterval(() => check(false), EVERY_MS)
}
