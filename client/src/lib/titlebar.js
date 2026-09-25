// The desktop app's title bar on Windows. The window has no native caption;
// the system buttons are laid over the top-right corner at a fixed height (see
// desktop/main.js), and this strip is what sits under them: draggable, with the
// app's name, in the theme's colours.
import { desktop } from './desktop.js'

const hex = (rgb) => {
  const m = rgb.match(/\d+(\.\d+)?/g)
  if (!m || m.length < 3) return null
  return '#' + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('')
}

export function mountTitleBar() {
  if (!desktop?.titleBar) return
  const root = document.documentElement
  root.classList.add('has-titlebar')

  const bar = document.createElement('div')
  bar.className = 'titlebar'
  const icon = document.createElement('img')
  icon.src = '/favicon.svg'
  icon.alt = ''
  const title = document.createElement('span')
  title.className = 'titlebar-title'
  bar.append(icon, title)
  document.body.prepend(bar)

  // the window's title (note name and all) shows here, as it did in the caption
  const showTitle = () => (title.textContent = document.title || 'Obi')
  showTitle()
  new MutationObserver(showTitle).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true })

  // the system buttons follow the theme
  let last = ''
  const paint = () => {
    const cs = getComputedStyle(bar)
    const colors = { color: hex(cs.backgroundColor), symbolColor: hex(cs.color) }
    const key = colors.color + colors.symbolColor
    if (!colors.color || !colors.symbolColor || key === last) return
    last = key
    desktop.setTitleBarColors?.(colors)
  }
  paint()
  new MutationObserver(() => requestAnimationFrame(paint)).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] })
}
