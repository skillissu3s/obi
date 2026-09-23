// Renders client/public/favicon.svg into the icon files that can't be SVG:
//
//   desktop/icon.png                   1024, transparent — the desktop app and its installers
//   client/public/apple-touch-icon.png  180, filled      — iPhone "Add to Home Screen"
//   client/public/icon-maskable.png     512, filled      — Android, which crops to its own shape
//
// The filled ones keep the app's dark tile behind the mark, because a phone
// home screen would otherwise put the transparent mark on whatever it likes.
// Run with Electron: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const TILE = '#161513'
// inset: how much of the canvas stays empty around the mark. Android crops a
// maskable icon to a circle roughly 80% across, so that one needs the most.
const OUTPUTS = [
  { file: 'desktop/icon.png', size: 1024, bg: 'transparent', inset: 0.04 },
  { file: 'client/public/apple-touch-icon.png', size: 180, bg: TILE, inset: 0.16 },
  { file: 'client/public/icon-maskable.png', size: 512, bg: TILE, inset: 0.26 },
]

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'client/public/favicon.svg'), 'utf8')
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  // one window for all of them: an offscreen window that is destroyed and made
  // again mid-loop tends to abort the next navigation
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  try {
    for (const out of OUTPUTS) {
      win.setContentSize(out.size, out.size)
      const mark = Math.round(out.size * (1 - 2 * out.inset))
      const html = `<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${out.bg}">
<img src="${src}" width="${mark}" height="${mark}"></body></html>`
      await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64')).catch(() => {})
      await new Promise((r) => setTimeout(r, 700))
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(root, out.file), img.toPNG())
      console.log('wrote', out.file, `${out.size}px`)
    }
  } catch (e) {
    console.error('icon render failed:', e)
    process.exitCode = 1
  }
  win.destroy()
  app.quit()
})
