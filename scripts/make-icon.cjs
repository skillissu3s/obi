// Renders client/public/favicon.svg to desktop/icon.png (1024px) for the app
// and its installers. Run with Electron: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 1024
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../client/public/favicon.svg'), 'utf8')
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setZoomFactor(1)
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${SIZE}" height="${SIZE}"></body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  fs.writeFileSync(path.join(__dirname, '../desktop/icon.png'), img.resize({ width: SIZE, height: SIZE }).toPNG())
  app.quit()
})
