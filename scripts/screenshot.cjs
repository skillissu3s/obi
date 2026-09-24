// Screenshots a running Obi (with a session cookie) into a PNG — how the
// pictures on the intro page (client/landing/) are made. Development helper.
//
//   npx electron scripts/screenshot.cjs shot.json
//
// The config is a file rather than arguments because Electron's launcher on
// Windows swallows any argument containing a colon — including URLs.
//   { "url": "...", "out": "...", "width": 1340, "height": 860,
//     "token": "<obi_session>", "waitMs": 6000, "js": "optional script" }
const { app, BrowserWindow, session, nativeTheme } = require('electron')
const fs = require('node:fs')

app.disableHardwareAcceleration()
process.on('unhandledRejection', (e) => {
  console.error('failed:', e)
  process.exit(3)
})

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))

app.whenReady().then(async () => {
  if (cfg.theme) nativeTheme.themeSource = cfg.theme
  if (cfg.token) {
    await session.defaultSession.cookies.set({ url: new URL(cfg.url).origin, name: 'obi_session', value: cfg.token, path: '/' })
  }
  const win = new BrowserWindow({
    width: cfg.width || 1340,
    height: cfg.height || 860,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  await win.loadURL(cfg.url).catch((e) => console.error('load:', e.message))
  await new Promise((r) => setTimeout(r, cfg.waitMs || 5000))
  if (cfg.js) {
    try {
      await win.webContents.executeJavaScript(cfg.js)
      await new Promise((r) => setTimeout(r, cfg.afterJsMs || 1500))
    } catch (e) {
      console.error('script:', e.message)
    }
  }
  const img = await win.webContents.capturePage()
  fs.writeFileSync(cfg.out, img.toPNG())
  console.log('wrote', cfg.out, `${cfg.width}x${cfg.height}`)
  win.destroy()
  app.quit()
})
