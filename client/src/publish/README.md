# ⚠ Layout contract — published notes and the canvas

A note's canvas (sticky notes, shapes, arrows, pen strokes, highlights,
markdown blocks) is **pinned to lines of text**, not to pixels. Every element
stores an *anchor* (a quote of its line, with a little context) and an offset
`dy` from that line's top. Wherever the note is shown, the element is placed at
"the top of its line + dy".

That only works if **every place that shows the note puts each line in the same
spot**. Today there are two such places, and they must stay in lock-step:

| | Where the lines come from | Where the canvas is laid out |
|---|---|---|
| **Editor** (the app) | CodeMirror live preview — `client/src/styles/editor.css` (`.obi-editor`, `.cm-lp-*`) | `client/src/canvas/NoteCanvas.jsx` → `resolveLayout` |
| **Published page** (`/p/<slug>`) | `shared/markdown.js` with `sourceLines`, styled by `client/src/publish/publish.css` | `client/src/publish/main.js` → the same `resolveLayout` |

The published page does not approximate the editor: it runs the **same**
`resolveLayout` (`client/src/canvas/layout.js`) and the **same**
`resolveAnchor` (`client/src/canvas/anchors.js`), and answers their two
questions — *where is this line?* and *where is this text?* — from its own DOM.
So the layout logic cannot drift. What *can* drift is the typography, and that
is what this contract guards.

## The rules

1. **One source line = one line box.** Font, size, line-height and the width of
   the text column must match the author's editor. They travel with the link as
   a theme snapshot (`client/src/lib/themesnapshot.js`), including the
   *measured* column width.
2. **A blank source line = one line of space.** The editor gives every blank
   line a full line-height. The renderer marks each block with `data-gap` (the
   number of blank lines above it) and `publish.css` turns that into
   `margin-top: N × line`. Blocks have **no other vertical margins** — a margin
   would collapse into the gap and move every line below it.
3. **Every source line is findable.** Blocks carry `data-line` (their first
   source line); lines inside a paragraph get an `<span class="obi-ln">` marker
   after each line break; fences carry `data-line`/`data-line-end` on the
   `<pre>`. Nothing else may use `data-line` inside `#content`.
4. **Headings, code blocks, quotes, lists, rules and tables mirror live
   preview.** Heading `padding-top`/size/line-height, the code block's padding,
   the quote's border and indent, the bullet/number widths, the hairline rule —
   each rule in `publish.css` names the `.cm-lp-*` class it copies.
5. **x = 0 is the left edge of the text column**, y is measured from the
   column's top. The editor's `.cm-line` has 2px of horizontal padding; so
   does `#content`.
6. **Markdown text blocks use the editor font** — never the hand-drawn font's
   1.25× size boost or its line-height. `ElementView.textStyle`,
   `layout.measureMarkdown` and `boardsvg.textBlock` all follow this.

## Also: no vertical margins on editor widgets

CodeMirror measures lines and block widgets by their border box. A vertical
`margin` on a widget (properties, tables, images, embeds…) sits outside that
box, so the editor's height map comes up short and **clicks land on the line
below**. Put spacing inside the box (padding, or a transparent border with
`background-clip: padding-box`). See the comments in `editor.css`.

## Before changing any of these files

`client/src/styles/editor.css` (`.obi-editor`, `.cm-lp-*`, widget spacing) ·
`client/src/publish/publish.css` · `client/src/publish/main.js` ·
`shared/markdown.js` (the `sourceLines` parts) · `server/public.js` (page and
routes) · `client/src/canvas/layout.js` (`resolveLayout`, `measureMarkdown`) ·
`client/src/canvas/anchors.js` · `client/src/canvas/NoteCanvas.jsx` (`env`,
`anchorFor`) · `client/src/canvas/ElementView.jsx` (`textStyle`) ·
`shared/boardsvg.js` (`textBlock`, `boardToSvg`) ·
`client/src/lib/themesnapshot.js`

1. Change the matching rule on the **other** side in the same commit.
2. Verify by eye: publish a note with a sticky next to a line, an arrow to a
   phrase, a highlight, and a shape beside a heading. Open the note and its
   `/p/<slug>` page side by side — every element must sit at the same offset
   from its line, and the text must wrap at the same words.
3. Run the integration suite.
