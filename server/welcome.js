export const WELCOME_NOTES = {
  'Welcome.md': `---
tags: [start-here]
---
# Welcome to Obi 👋

Obi is your calm, fast home for notes — in the cloud, shared with others, or synced with a **GitHub repository** (perfect for an Obsidian vault).

> [!tip] Try it now
> Press **Ctrl/⌘ + K** to open the command palette, or **Ctrl/⌘ + O** to jump to any note.

## Things to explore
- [[Shortcuts]] — every keyboard shortcut in one place
- [[Markdown cheatsheet]] — callouts, tasks, math, diagrams & more
- [[Project board]] — a Kanban board that is just a markdown file
- Press **Canvas** at the bottom of any note to draw, add sticky notes and images around it — select text to highlight it or attach a note
- Type \`/whiteboard\` to sketch a diagram right inside a note
- Open the **graph view** from the sidebar to see how notes connect

## Quick wins
- [ ] Create your first note with **Ctrl/⌘ + N**
- [ ] Type \`[[\` to link to another note
- [ ] Type \`/\` at the start of a line for the block menu
- [ ] Open today's daily note with **Ctrl/⌘ + D**
- [x] Open Obi

#getting-started
`,
  'Getting started/Shortcuts.md': `# Shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | Ctrl/⌘ K or Ctrl/⌘ P |
| Quick switcher | Ctrl/⌘ O |
| New note | Ctrl/⌘ N |
| Daily note | Ctrl/⌘ D |
| Search everything | Ctrl/⌘ Shift F |
| Toggle reading view | Ctrl/⌘ E |
| Graph view | Ctrl/⌘ G |
| Toggle sidebar | Ctrl/⌘ \\ |
| Focus mode | Ctrl/⌘ Shift Enter |
| Bold / Italic / Link | Ctrl/⌘ B / I / L |
| Toggle checkbox | Ctrl/⌘ Enter |
| Close tab | Ctrl/⌘ W (Alt W in browsers that reserve it) |
| New whiteboard | Alt B |
| Canvas tools on a note | Alt C |
| Pan a canvas | Space + drag, middle mouse, or H |

Back to [[Welcome]]. #getting-started
`,
  'Getting started/Markdown cheatsheet.md': `# Markdown cheatsheet

**Bold**, *italic*, ~~strike~~, ==highlight==, \`inline code\` and [[Welcome|links to notes]].

## Callouts
> [!note] A note
> Callouts support **markdown** too.

> [!warning] Careful
> Types: note, tip, info, success, question, warning, danger, bug, example, quote.

## Tasks
- [ ] Open task 📅 2026-12-31
- [x] Finished task

## Math
Inline $e^{i\\pi} + 1 = 0$ and blocks:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Diagrams
\`\`\`mermaid
graph LR
  Idea --> Note --> Project
  Note --> Graph
\`\`\`

## Code
\`\`\`js
const hello = (name) => \`Hello, \${name}!\`
\`\`\`

#getting-started #reference
`,
  'Planning/Project board.md': `---
kanban-plugin: basic
---

## Ideas

- [ ] Write a blog post about [[Welcome|note-taking]]
- [ ] Try the graph view

## In progress

- [ ] Organise notes into folders

## Done

- [x] Set up Obi

`,
}
