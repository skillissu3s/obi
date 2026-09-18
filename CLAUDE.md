# Obi — notes for agents working in this repo

## ⚠ Layout-critical code: read before editing

Canvas drawings on a note are pinned to **lines of text**, and the same note is
laid out in two places — the editor and the published page (`/p/<slug>`). If
the two stop setting lines identically, drawings land in the wrong place, and
if editor widgets get vertical margins, clicks land on the wrong line.

**Read `client/src/publish/README.md` before changing any of these**, and
change the matching rule on the other side in the same commit:

- `client/src/styles/editor.css` — `.obi-editor`, the live preview `.cm-lp-*`
  rules, and spacing on editor widgets (never vertical margins)
- `client/src/publish/publish.css`, `client/src/publish/main.js`
- `shared/markdown.js` — the `sourceLines` parts
- `server/public.js` — the published page and its routes
- `client/src/canvas/layout.js`, `anchors.js`, `NoteCanvas.jsx` (`env`,
  `anchorFor`), `ElementView.jsx` (`textStyle`)
- `shared/boardsvg.js` — `textBlock`, `boardToSvg`
- `client/src/lib/themesnapshot.js`

Code in these files that must not change casually is marked
`⚠ LAYOUT CONTRACT`. Don't "tidy" spacing, margins, font sizes or line-heights
there as a drive-by; a refactor that looks harmless can move every drawing on
every published note.

## Notes stay plain markdown

A note's text is the user's markdown file, in their repository. Canvas data
lives beside it in `.obi/layers/<note path>.json`; never write canvas or app
state into the markdown itself.
