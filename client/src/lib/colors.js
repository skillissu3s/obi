// The colours a project, a list, a label or a card can be given (PROJECT_COLORS
// in shared/kanban.js), as CSS colours. projects.css has the same ones under
// [data-color].
export const COLOR_HEX = {
  gray: '#8a8f98',
  red: '#d8586a',
  orange: '#d97d3f',
  yellow: '#c9a227',
  green: '#3fa87f',
  teal: '#2a9fb0',
  blue: '#4f86d6',
  purple: '#8e6bd1',
  pink: '#c9668f',
}

export const colorHex = (name) => COLOR_HEX[name] || null
export const colorLabel = (name) => (name ? name[0].toUpperCase() + name.slice(1) : 'No colour')
