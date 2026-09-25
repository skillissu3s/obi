// What the page may ask of the desktop app: native folder pickers and the like.
// The page itself is the ordinary web app; `window.obiDesktop` is how it knows
// it is running on the desktop.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('obiDesktop', {
  platform: process.platform,
  // the page draws the title bar (Windows); the system buttons are laid over its right end
  titleBar: process.platform === 'win32',
  setTitleBarColors: (colors) => ipcRenderer.send('obi:titlebar', colors),
  pickFolder: (opts) => ipcRenderer.invoke('obi:pick-folder', opts),
  reveal: (dir) => ipcRenderer.invoke('obi:reveal', dir),
  documentsFolder: () => ipcRenderer.invoke('obi:documents'),
  reauth: () => ipcRenderer.invoke('obi:reauth'),
})
