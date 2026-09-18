// The colours a published page needs to look like the workspace it came from.
// Resolved values are read off the live document, so whatever theme and palette
// the author has on — including ones added later — travel with the link.
const TOKENS = [
  'bg',
  'bg-elev',
  'bg-code',
  'bg-hover',
  'text',
  'text-2',
  'text-3',
  'text-faint',
  'border',
  'border-strong',
  'accent',
  'accent-text',
  'accent-soft',
  'mark-bg',
  'danger',
  'warning',
  'success',
  'font-ui',
  'font-editor',
  'font-mono',
  'font-serif',
  'tint',
  // text highlights on the canvas layer
  'cv-hl-yellow',
  'cv-hl-green',
  'cv-hl-blue',
  'cv-hl-pink',
  'cv-hl-violet',
  'cv-hl-orange',
  // canvas ink, fills and sticky colours, so drawings match too
  'cv-ink',
  'cv-gray',
  'cv-red',
  'cv-orange',
  'cv-yellow',
  'cv-green',
  'cv-teal',
  'cv-blue',
  'cv-violet',
  'cv-pink',
  'cv-gray-fill',
  'cv-red-fill',
  'cv-orange-fill',
  'cv-yellow-fill',
  'cv-green-fill',
  'cv-teal-fill',
  'cv-blue-fill',
  'cv-violet-fill',
  'cv-pink-fill',
  'cv-ink-fill',
  'cv-sticky-yellow',
  'cv-sticky-orange',
  'cv-sticky-pink',
  'cv-sticky-violet',
  'cv-sticky-blue',
  'cv-sticky-teal',
  'cv-sticky-green',
  'cv-sticky-gray',
  'cv-card',
  'cv-card-border',
  'cv-frame',
]

export function themeSnapshot() {
  try {
    const root = document.documentElement
    const cs = getComputedStyle(root)
    const vars = {}
    for (const t of TOKENS) {
      const v = cs.getPropertyValue(`--${t}`).trim()
      if (v) vars[t] = v
    }
    // ⚠ LAYOUT CONTRACT: the published page wraps text at exactly this width,
    // so it is measured from the note's own text column, not assumed
    // other open tabs keep their editors mounted but hidden (0 wide), so take
    // the one actually on screen
    const col = Math.max(0, ...[...document.querySelectorAll('.obi-editor .cm-content')].map((el) => el.getBoundingClientRect().width))
    return {
      columnWidth: col && col > 120 ? Math.round(col) : null,
      theme: root.dataset.theme || 'dark',
      palette: root.dataset.palette || '',
      noteWidth: cs.getPropertyValue('--note-width').trim() || '620px',
      fontSize: cs.getPropertyValue('--editor-font-size').trim() || '16px',
      lineHeight: cs.getPropertyValue('--editor-line-height').trim() || '1.75',
      vars,
    }
  } catch {
    return null
  }
}
