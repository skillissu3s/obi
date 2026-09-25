// Obi desktop: the same app, running on this computer.
//
// The main process starts Obi's server in-process on 127.0.0.1 (a free port),
// with its database in the app's user-data folder, signs the window in as the
// one local user and loads the app. Notes live in vault folders the user picks;
// syncing them with an Obi cloud account or GitHub is optional.
import { app, BrowserWindow, dialog, ipcMain, shell, session, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!app.requestSingleInstanceLock()) app.quit()

const TITLEBAR = process.platform === 'win32'
const TITLEBAR_H = 34 // matches --titlebar-h in client/src/styles/layout.css
const overlayColors = (dark) => (dark ? { color: '#161513', symbolColor: '#a49e93' } : { color: '#f6f4ed', symbolColor: '#5d5749' })

let win = null
let base = null
let server = null
let stopped = false

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 420,
    minHeight: 480,
    show: false,
    title: 'Obi',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161615' : '#fbfaf8',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    // Windows: the page draws the title bar and the system buttons sit on it at
    // a steady height. The native caption shrinks when the window is maximized,
    // which squeezed the buttons.
    ...(TITLEBAR
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { height: TITLEBAR_H, ...overlayColors(nativeTheme.shouldUseDarkColors) },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  })
  win.once('ready-to-show', () => win.show())

  // links to the outside world open in the browser
  const inside = (url) => url === base || url.startsWith(base + '/')
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inside(url)) return { action: 'allow' }
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (inside(url)) return
    e.preventDefault()
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
  })
  win.loadURL(base + '/')
  win.on('closed', () => (win = null))
  // development: OBI_SCREENSHOT=file.png saves what the window shows once loaded
  if (process.env.OBI_SCREENSHOT) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        const fs = await import('node:fs')
        fs.writeFileSync(process.env.OBI_SCREENSHOT, img.toPNG())
      }, 2500),
    )
  }
}

/** The first of Obi's usual ports that nothing else is listening on */
async function freePort(from = 7717, tries = 12) {
  const net = await import('node:net')
  for (let port = from; port < from + tries; port++) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(port, '127.0.0.1')
    })
    if (free) return port
  }
  return 0 // everything taken: let the system choose
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

ipcMain.handle('obi:pick-folder', async (e, opts = {}) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: opts.title || 'Choose a folder',
    buttonLabel: opts.buttonLabel || 'Choose',
    defaultPath: opts.defaultPath || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  })
  return r.canceled ? null : r.filePaths[0] || null
})
ipcMain.handle('obi:reveal', (e, dir) => (typeof dir === 'string' && dir ? shell.openPath(dir) : null))
ipcMain.handle('obi:documents', () => app.getPath('documents'))
// the page's theme changed: the system buttons take its colours
const HEX = /^#[0-9a-f]{6}$/i
ipcMain.on('obi:titlebar', (e, c) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!TITLEBAR || !w || !HEX.test(c?.color) || !HEX.test(c?.symbolColor)) return
  w.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: TITLEBAR_H })
})
// the page lost its session (expired, or signed out elsewhere): a fresh one
ipcMain.handle('obi:reauth', () => signIn().then(() => true))

// the window is signed in as the one local user, with a cookie only it holds
async function signIn() {
  const { desktopSessionToken } = await import('../server/desktop.js')
  await session.defaultSession.cookies.set({
    url: base,
    name: 'obi_session',
    value: await desktopSessionToken(),
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400,
  })
}

app.whenReady().then(async () => {
  process.env.OBI_DESKTOP = '1'
  process.env.NODE_ENV = 'production'
  process.env.DATA_DIR = process.env.OBI_DATA_DIR || path.join(app.getPath('userData'), 'data')
  process.env.HOST = '127.0.0.1'
  // A steady port matters: the page's own storage (open tabs, panel widths,
  // the last workspace) belongs to the origin, so a new port every launch
  // would forget all of it. Take the first free one from a small range.
  process.env.PORT = process.env.OBI_PORT || String(await freePort())
  try {
    server = await import('../server/index.js')
    const port = await server.listening
    base = `http://127.0.0.1:${port}`
    await signIn()
  } catch (e) {
    dialog.showErrorBox('Obi could not start', String(e?.stack || e))
    app.exit(1)
    return
  }
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// save open notes and finish syncing before the process goes
app.on('before-quit', (e) => {
  if (stopped || !server) return
  e.preventDefault()
  stopped = true
  Promise.race([server.stopServer(), new Promise((r) => setTimeout(r, 10000))])
    .catch(() => {})
    .finally(() => app.quit())
})
